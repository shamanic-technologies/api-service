import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

interface FetchCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

let fetchCalls: FetchCall[] = [];
let mockFetchResponse: { ok: boolean; status: number; body: unknown } = {
  ok: true,
  status: 200,
  body: { events: [] },
};

let mockAuth: { userId?: string; orgId?: string; authType?: "user_key" | "admin"; allowAuth?: boolean } = {
  userId: "user_test123",
  orgId: "org_test456",
  authType: "user_key",
  allowAuth: true,
};

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!mockAuth.allowAuth) return res.status(401).json({ error: "Missing authentication" });
    req.userId = mockAuth.userId;
    req.orgId = mockAuth.orgId;
    req.authType = mockAuth.authType;
    next();
  },
  requireOrg: (req: any, res: any, next: any) => {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    next();
  },
  requireUser: (req: any, res: any, next: any) => {
    if (!req.userId) return res.status(401).json({ error: "User identity required" });
    next();
  },
  authenticatePlatform: (req: any, res: any, next: any) => {
    req.authType = "admin";
    next();
  },
  AuthenticatedRequest: {},
}));

import runsRoutes from "../../src/routes/runs.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", runsRoutes);
  return app;
}

beforeEach(() => {
  vi.restoreAllMocks();
  fetchCalls = [];
  mockFetchResponse = { ok: true, status: 200, body: { events: [] } };
  mockAuth = { userId: "user_test123", orgId: "org_test456", authType: "user_key", allowAuth: true };
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    fetchCalls.push({
      url,
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
    });
    return {
      ok: mockFetchResponse.ok,
      status: mockFetchResponse.status,
      json: () => Promise.resolve(mockFetchResponse.body),
      text: () => Promise.resolve(JSON.stringify(mockFetchResponse.body)),
    };
  });
});

describe("GET /v1/events", () => {
  it("proxies to runs-service /v1/events with orgId from auth (not client query)", async () => {
    mockFetchResponse = {
      ok: true,
      status: 200,
      body: { events: [{ id: "evt-1", level: "info" }] },
    };
    const app = createApp();

    const res = await request(app)
      .get("/v1/events?campaignId=96c89229-f5d2-4659-a8dc-0d5b45639cae")
      .set("Authorization", "Bearer distrib.usr_xxx");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [{ id: "evt-1", level: "info" }] });

    const call = fetchCalls.find((c) => c.url.includes("/v1/events"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("/v1/events");
    expect(call!.url).toContain("campaignId=96c89229-f5d2-4659-a8dc-0d5b45639cae");
    expect(call!.url).toContain("orgId=org_test456");
  });

  it("forwards whitelisted query params: campaignId, brandId, level, limit, offset, service, workflowSlug, featureSlug, event", async () => {
    const app = createApp();

    await request(app)
      .get("/v1/events")
      .query({
        campaignId: "c-1",
        brandId: "b-1",
        level: "error",
        limit: "50",
        offset: "10",
        service: "workflow-service",
        workflowSlug: "pr-outreach",
        featureSlug: "lead-serve",
        event: "send-start",
      })
      .set("Authorization", "Bearer distrib.usr_xxx");

    const call = fetchCalls.find((c) => c.url.includes("/v1/events"));
    expect(call).toBeDefined();
    const url = call!.url;
    expect(url).toContain("campaignId=c-1");
    expect(url).toContain("brandId=b-1");
    expect(url).toContain("level=error");
    expect(url).toContain("limit=50");
    expect(url).toContain("offset=10");
    expect(url).toContain("service=workflow-service");
    expect(url).toContain("workflowSlug=pr-outreach");
    expect(url).toContain("featureSlug=lead-serve");
    expect(url).toContain("event=send-start");
    expect(url).toContain("orgId=org_test456");
  });

  it("forwards comma-separated event slugs intact", async () => {
    const app = createApp();

    await request(app)
      .get("/v1/events")
      .query({ campaignId: "c-1", event: "send-start,generate-start" })
      .set("Authorization", "Bearer distrib.usr_xxx");

    const call = fetchCalls.find((c) => c.url.includes("/v1/events"));
    expect(call).toBeDefined();
    expect(decodeURIComponent(call!.url)).toContain("event=send-start,generate-start");
    expect(call!.url).toContain("campaignId=c-1");
    expect(call!.url).toContain("orgId=org_test456");
  });

  it("omits event from the forwarded URL when not supplied", async () => {
    const app = createApp();

    await request(app)
      .get("/v1/events?campaignId=c-1")
      .set("Authorization", "Bearer distrib.usr_xxx");

    const call = fetchCalls.find((c) => c.url.includes("/v1/events"));
    expect(call).toBeDefined();
    expect(call!.url).not.toContain("event=");
  });

  it("ignores client-supplied orgId — auth orgId wins", async () => {
    const app = createApp();

    await request(app)
      .get("/v1/events?orgId=attacker-org")
      .set("Authorization", "Bearer distrib.usr_xxx");

    const call = fetchCalls.find((c) => c.url.includes("/v1/events"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("orgId=org_test456");
    expect(call!.url).not.toContain("orgId=attacker-org");
  });

  it("returns 401 when no auth", async () => {
    mockAuth.allowAuth = false;
    const app = createApp();

    const res = await request(app).get("/v1/events");
    expect(res.status).toBe(401);
    expect(fetchCalls.length).toBe(0);
  });

  it("returns 400 when authenticated but no orgId resolved", async () => {
    mockAuth = { userId: "user_test123", orgId: undefined, authType: "user_key", allowAuth: true };
    const app = createApp();

    const res = await request(app)
      .get("/v1/events")
      .set("Authorization", "Bearer distrib.usr_xxx");

    expect(res.status).toBe(400);
    expect(fetchCalls.length).toBe(0);
  });

  it("propagates non-2xx from runs-service — no silent empty fallback", async () => {
    mockFetchResponse = {
      ok: false,
      status: 503,
      body: { error: "runs-service down" },
    };
    const app = createApp();

    const res = await request(app)
      .get("/v1/events?campaignId=c-1")
      .set("Authorization", "Bearer distrib.usr_xxx");

    expect(res.status).toBe(503);
    expect(res.body).not.toEqual({ events: [] });
  });
});

describe("OpenAPI spec", () => {
  it("has GET /v1/events registered", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const openapiPath = path.join(__dirname, "../../openapi.json");
    const spec = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

    expect(spec.paths).toHaveProperty("/v1/events");
    expect(spec.paths["/v1/events"]).toHaveProperty("get");
    const op = spec.paths["/v1/events"].get;
    expect(op.security).toBeDefined();
    expect(op.security.length).toBeGreaterThan(0);
    const paramNames = (op.parameters ?? []).map((p: { name: string }) => p.name);
    expect(paramNames).toContain("event");
  });
});
