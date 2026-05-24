import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock auth middleware — full identity present by default.
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.authType = "user_key";
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
  AuthenticatedRequest: {},
}));

interface FetchCall {
  url: string;
  method?: string;
  body?: any;
  headers?: Record<string, string>;
}

let fetchCalls: FetchCall[] = [];

import emailsRoutes from "../../src/routes/emails.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", emailsRoutes);
  return app;
}

const QUALIFICATION_FIXTURE = {
  id: "00000000-0000-0000-0000-000000000001",
  orgId: "org_test456",
  campaignId: "c1a2b3c4-0000-0000-0000-000000000001",
  instantlyCampaignId: "instantly-camp-1",
  email: "alice@media.com",
  status: "lead_interested",
  qualifiedBy: "user_test123",
  notes: "Reply received on Gmail — Instantly missed it",
  qualifiedAt: "2026-05-24T10:00:00.000Z",
};

function mockFetchOk(payload: any) {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const headers = init?.headers ? Object.fromEntries(Object.entries(init.headers)) : undefined;
    fetchCalls.push({ url, method: init?.method, body, headers });
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    };
  });
}

function mockFetchError(status: number, errorBody: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const headers = init?.headers ? Object.fromEntries(Object.entries(init.headers)) : undefined;
    fetchCalls.push({ url, method: init?.method, body, headers });
    return {
      ok: false,
      status,
      text: () => Promise.resolve(errorBody),
      json: () => Promise.resolve(JSON.parse(errorBody)),
    };
  });
}

describe("POST /v1/emails/manual-qualifications", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    mockFetchOk({ idempotent: false, qualification: QUALIFICATION_FIXTURE });
    app = createApp();
  });

  it("forwards body byte-identical to email-gateway with identity headers", async () => {
    const body = {
      campaign_id: "c1a2b3c4-0000-0000-0000-000000000001",
      email: "alice@media.com",
      status: "lead_interested",
      notes: "Reply received on Gmail — Instantly missed it",
    };
    const res = await request(app).post("/v1/emails/manual-qualifications").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ idempotent: false, qualification: QUALIFICATION_FIXTURE });

    const call = fetchCalls.find((c) => c.url.includes("/orgs/manual-qualifications"));
    expect(call).toBeDefined();
    expect(call!.method).toBe("POST");
    // AC#7 — URL contract: downstream call path must be /orgs/manual-qualifications byte-equal.
    expect(call!.url.endsWith("/orgs/manual-qualifications")).toBe(true);
    // AC — body byte-identical, no field injection.
    expect(call!.body).toEqual(body);
    expect(call!.body.orgId).toBeUndefined();
    expect(call!.body.userId).toBeUndefined();
    // Identity headers injected.
    expect(call!.headers!["x-org-id"]).toBe("org_test456");
    expect(call!.headers!["x-user-id"]).toBe("user_test123");
    expect(call!.headers!["x-run-id"]).toBe("run_test789");
  });

  it("round-trips idempotent: true from upstream unchanged", async () => {
    mockFetchOk({ idempotent: true, qualification: QUALIFICATION_FIXTURE });
    app = createApp();

    const res = await request(app)
      .post("/v1/emails/manual-qualifications")
      .send({
        campaign_id: "c1a2b3c4-0000-0000-0000-000000000001",
        email: "alice@media.com",
        status: "lead_interested",
      });

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(res.body.qualification).toEqual(QUALIFICATION_FIXTURE);
  });

  it("propagates upstream 400 (bad status enum) with body verbatim", async () => {
    mockFetchError(400, '{"error":"Invalid request body","details":{"fieldErrors":{"status":["Invalid enum value"]}}}');
    app = createApp();

    const res = await request(app)
      .post("/v1/emails/manual-qualifications")
      .send({
        campaign_id: "c1a2b3c4-0000-0000-0000-000000000001",
        email: "alice@media.com",
        status: "not_a_valid_status",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid request body");
  });

  it("propagates upstream 404 (campaign/email not in org)", async () => {
    mockFetchError(404, '{"error":"Lead not found in campaign"}');
    app = createApp();

    const res = await request(app)
      .post("/v1/emails/manual-qualifications")
      .send({
        campaign_id: "c1a2b3c4-0000-0000-0000-000000000001",
        email: "ghost@nowhere.com",
        status: "lead_interested",
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Lead not found");
  });

  it("returns 401 when userId is missing (requireUser)", async () => {
    // Re-mount with a stripped auth that does NOT set userId.
    vi.doMock("../../src/middleware/auth.js", () => ({
      authenticate: (req: any, _res: any, next: any) => {
        req.orgId = "org_test456";
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
      AuthenticatedRequest: {},
    }));
    vi.resetModules();
    const stripped = (await import("../../src/routes/emails.js")).default;
    const noUserApp = express();
    noUserApp.use(express.json());
    noUserApp.use("/v1", stripped);

    const res = await request(noUserApp)
      .post("/v1/emails/manual-qualifications")
      .send({
        campaign_id: "c1a2b3c4-0000-0000-0000-000000000001",
        email: "alice@media.com",
        status: "lead_interested",
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("User identity required");

    vi.doUnmock("../../src/middleware/auth.js");
    vi.resetModules();
  });
});

describe("GET /v1/emails/manual-qualifications", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    mockFetchOk({ qualifications: [QUALIFICATION_FIXTURE] });
    app = createApp();
  });

  it("forwards all query params and identity headers to email-gateway", async () => {
    const res = await request(app).get(
      "/v1/emails/manual-qualifications?campaign_id=c1a2b3c4-0000-0000-0000-000000000001&email=alice@media.com&limit=50",
    );

    expect(res.status).toBe(200);
    expect(res.body.qualifications).toEqual([QUALIFICATION_FIXTURE]);

    const call = fetchCalls.find((c) => c.url.includes("/orgs/manual-qualifications"));
    expect(call).toBeDefined();
    expect(call!.method).toBe("GET");
    expect(call!.url).toContain("campaign_id=c1a2b3c4-0000-0000-0000-000000000001");
    expect(call!.url).toContain("email=alice%40media.com");
    expect(call!.url).toContain("limit=50");
    expect(call!.headers!["x-org-id"]).toBe("org_test456");
    expect(call!.headers!["x-user-id"]).toBe("user_test123");
    expect(call!.headers!["x-run-id"]).toBe("run_test789");
  });

  it("forwards with no query string when no filters given", async () => {
    const res = await request(app).get("/v1/emails/manual-qualifications");

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.url.includes("/orgs/manual-qualifications"));
    expect(call).toBeDefined();
    // No query string appended.
    expect(call!.url.endsWith("/orgs/manual-qualifications")).toBe(true);
  });

  it("propagates upstream error status", async () => {
    mockFetchError(400, '{"error":"limit must be <= 500"}');
    app = createApp();

    const res = await request(app).get("/v1/emails/manual-qualifications?limit=9999");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("limit must be <= 500");
  });
});
