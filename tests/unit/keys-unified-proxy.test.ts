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
  authType: "user_key" as "user_key" | "admin",
};

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
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
    authType: "user_key",
  };
  mockFetch();
});

// -----------------------------------------------------------------------
// POST /v1/keys
// -----------------------------------------------------------------------

describe("POST /v1/keys — org keys only", () => {
  it("should forward org keys without orgId in body (no keySource)", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys")
      .send({ provider: "stripe", apiKey: "sk_live_test" });

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.method === "POST");
    expect(call!.body).toEqual({
      provider: "stripe",
      apiKey: "sk_live_test",
    });
  });

  it("should reject when no org context", async () => {
    mockAuth.orgId = "";
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys")
      .send({ provider: "stripe", apiKey: "sk_live_test" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Organization context required");
    expect(fetchCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// GET /v1/keys
// -----------------------------------------------------------------------

describe("GET /v1/keys — org keys only", () => {
  it("should list org keys without orgId in query (no keySource)", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/keys");

    expect(res.status).toBe(200);
    const call = fetchCalls[0];
    expect(call.url).not.toContain("keySource");
    expect(call.url).not.toContain("orgId");
    expect(call.url).toContain("/keys");
  });

  it("should reject when no org context", async () => {
    mockAuth.orgId = "";
    const app = createApp();
    const res = await request(app).get("/v1/keys");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Organization context required");
    expect(fetchCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// DELETE /v1/keys/:provider
// -----------------------------------------------------------------------

describe("DELETE /v1/keys/:provider — org keys only", () => {
  it("should delete org key without orgId in query (no keySource)", async () => {
    const app = createApp();
    const res = await request(app).delete("/v1/keys/stripe");

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.method === "DELETE");
    expect(call!.url).not.toContain("keySource");
    expect(call!.url).not.toContain("orgId");
    expect(call!.url).toContain("/keys/stripe");
  });

  it("should reject when no org context", async () => {
    mockAuth.orgId = "";
    const app = createApp();
    const res = await request(app).delete("/v1/keys/stripe");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Organization context required");
    expect(fetchCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// GET /v1/keys/sources
// -----------------------------------------------------------------------

describe("GET /v1/keys/sources — key source preferences", () => {
  it("should proxy to key-service /keys/sources", async () => {
    (global.fetch as any).mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve({ sources: [{ provider: "anthropic", keySource: "org" }] }),
    }));
    const app = createApp();
    const res = await request(app).get("/v1/keys/sources");

    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([{ provider: "anthropic", keySource: "org" }]);
  });

  it("should reject when no org context", async () => {
    mockAuth.orgId = "";
    const app = createApp();
    const res = await request(app).get("/v1/keys/sources");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Organization context required");
  });
});

// -----------------------------------------------------------------------
// GET /v1/keys/:provider/source
// -----------------------------------------------------------------------

describe("GET /v1/keys/:provider/source — get key source", () => {
  it("should proxy to key-service /keys/:provider/source", async () => {
    (global.fetch as any).mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve({ provider: "anthropic", orgId: "org_test456", keySource: "org", isDefault: false }),
    }));
    const app = createApp();
    const res = await request(app).get("/v1/keys/anthropic/source");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ provider: "anthropic", orgId: "org_test456", keySource: "org", isDefault: false });
  });

  it("should reject when no org context", async () => {
    mockAuth.orgId = "";
    const app = createApp();
    const res = await request(app).get("/v1/keys/anthropic/source");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Organization context required");
  });
});

// -----------------------------------------------------------------------
// PUT /v1/keys/:provider/source
// -----------------------------------------------------------------------

describe("PUT /v1/keys/:provider/source — set key source", () => {
  it("should proxy to key-service with validated body", async () => {
    (global.fetch as any).mockImplementation(async (_url: string, init?: RequestInit) => {
      fetchCalls.push({ url: _url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return {
        ok: true,
        json: () => Promise.resolve({ provider: "anthropic", orgId: "org_test456", keySource: "org", message: "updated" }),
      };
    });
    const app = createApp();
    const res = await request(app)
      .put("/v1/keys/anthropic/source")
      .send({ keySource: "org" });

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.method === "PUT");
    expect(call!.url).toContain("/keys/anthropic/source");
    expect(call!.body).toEqual({ keySource: "org" });
  });

  it("should reject invalid keySource value", async () => {
    const app = createApp();
    const res = await request(app)
      .put("/v1/keys/anthropic/source")
      .send({ keySource: "invalid" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should reject when no org context", async () => {
    mockAuth.orgId = "";
    const app = createApp();
    const res = await request(app)
      .put("/v1/keys/anthropic/source")
      .send({ keySource: "org" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Organization context required");
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
