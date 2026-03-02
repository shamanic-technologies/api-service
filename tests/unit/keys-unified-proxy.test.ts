import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

interface FetchCall {
  url: string;
  method?: string;
  body?: any;
}

let fetchCalls: FetchCall[] = [];

// Configurable auth state per test
let mockAuth = {
  userId: "user_test123",
  orgId: "org_test456",
  appId: "distribute-frontend",
  authType: "user_key" as "user_key" | "app_key",
};

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = mockAuth.userId;
    req.orgId = mockAuth.orgId;
    req.appId = mockAuth.appId;
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
  AuthenticatedRequest: {},
}));

import keysRoutes from "../../src/routes/keys.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", keysRoutes);
  return app;
}

function mockFetch() {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    fetchCalls.push({ url, method: init?.method, body });
    return {
      ok: true,
      json: () => Promise.resolve({ provider: "stripe", maskedKey: "sk_l...abc", message: "key saved" }),
    };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  fetchCalls = [];
  mockAuth = {
    userId: "user_test123",
    orgId: "org_test456",
    appId: "distribute-frontend",
    authType: "user_key",
  };
  mockFetch();
});

// -----------------------------------------------------------------------
// POST /v1/keys
// -----------------------------------------------------------------------

describe("POST /v1/keys — user_key auth", () => {
  it("should forward org keys with orgId", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "org", provider: "stripe", apiKey: "sk_live_test" });

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.method === "POST");
    expect(call!.body).toEqual({
      keySource: "org",
      provider: "stripe",
      apiKey: "sk_live_test",
      orgId: "org_test456",
    });
  });

  it("should reject keySource 'app' from user_key auth", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "app", provider: "anthropic", apiKey: "sk-ant-test" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("app key authentication");
    expect(fetchCalls).toHaveLength(0);
  });

  it("should reject keySource 'platform' — Zod validation rejects it", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "platform", provider: "gemini", apiKey: "gemini-key" });

    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("POST /v1/keys — app_key auth", () => {
  beforeEach(() => {
    mockAuth.authType = "app_key";
    mockAuth.orgId = "";
    mockAuth.userId = "";
  });

  it("should forward app keys with appId", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "app", provider: "anthropic", apiKey: "sk-ant-test" });

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.method === "POST");
    expect(call!.body).toEqual({
      keySource: "app",
      provider: "anthropic",
      apiKey: "sk-ant-test",
      appId: "distribute-frontend",
    });
  });

  it("should forward org keys when app_key has org context", async () => {
    mockAuth.orgId = "org_test456";
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "org", provider: "stripe", apiKey: "sk_live_test" });

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.method === "POST");
    expect(call!.body.keySource).toBe("org");
    expect(call!.body.orgId).toBe("org_test456");
  });

  it("should reject org keys when app_key has no org context", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "org", provider: "stripe", apiKey: "sk_live_test" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Organization context required");
    expect(fetchCalls).toHaveLength(0);
  });

  it("should reject keySource 'platform'", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "platform", provider: "gemini", apiKey: "gemini-key" });

    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// GET /v1/keys
// -----------------------------------------------------------------------

describe("GET /v1/keys — authorization", () => {
  it("should default to org and include orgId (user_key)", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/keys");

    expect(res.status).toBe(200);
    const call = fetchCalls[0];
    expect(call.url).toContain("keySource=org");
    expect(call.url).toContain("orgId=org_test456");
  });

  it("should reject keySource=app from user_key", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/keys?keySource=app");

    expect(res.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it("should reject keySource=platform", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/keys?keySource=platform");

    expect(res.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it("should allow keySource=app from app_key", async () => {
    mockAuth.authType = "app_key";
    const app = createApp();
    const res = await request(app).get("/v1/keys?keySource=app");

    expect(res.status).toBe(200);
    const call = fetchCalls[0];
    expect(call.url).toContain("keySource=app");
    expect(call.url).toContain("appId=distribute-frontend");
  });
});

// -----------------------------------------------------------------------
// DELETE /v1/keys/:provider
// -----------------------------------------------------------------------

describe("DELETE /v1/keys/:provider — authorization", () => {
  it("should default to org and include orgId", async () => {
    const app = createApp();
    const res = await request(app).delete("/v1/keys/stripe");

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.method === "DELETE");
    expect(call!.url).toContain("keySource=org");
    expect(call!.url).toContain("orgId=org_test456");
  });

  it("should reject keySource=app from user_key", async () => {
    const app = createApp();
    const res = await request(app).delete("/v1/keys/stripe?keySource=app");

    expect(res.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it("should reject keySource=platform", async () => {
    const app = createApp();
    const res = await request(app).delete("/v1/keys/stripe?keySource=platform");

    expect(res.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it("should allow keySource=app from app_key", async () => {
    mockAuth.authType = "app_key";
    const app = createApp();
    const res = await request(app).delete("/v1/keys/anthropic?keySource=app");

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.method === "DELETE");
    expect(call!.url).toContain("keySource=app");
    expect(call!.url).toContain("appId=distribute-frontend");
  });
});

// -----------------------------------------------------------------------
// Decrypt proxy removal
// -----------------------------------------------------------------------

describe("Decrypt proxy removal", () => {
  it("should not expose /internal/keys/:provider/decrypt", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/internal/keys/stripe/decrypt?orgId=org_test456");
    expect(res.status).toBe(404);
  });
});
