import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock auth middleware
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.appId = "distribute-frontend";
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
}

let fetchCalls: FetchCall[] = [];

import keysRoutes from "../../src/routes/keys.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", keysRoutes);
  return app;
}

describe("POST /v1/keys — unified proxy", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });
      return {
        ok: true,
        json: () => Promise.resolve({ provider: "stripe", maskedKey: "sk_l...abc", message: "stripe key saved successfully" }),
      };
    });
    app = createApp();
  });

  it("should forward org keys to POST /keys with orgId", async () => {
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "org", provider: "stripe", apiKey: "sk_live_test" });

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/keys") && c.method === "POST");
    expect(call).toBeDefined();
    expect(call!.body).toEqual({
      keySource: "org",
      provider: "stripe",
      apiKey: "sk_live_test",
      orgId: "org_test456",
    });
  });

  it("should forward app keys to POST /keys with appId", async () => {
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "app", provider: "anthropic", apiKey: "sk-ant-test" });

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/keys") && c.method === "POST");
    expect(call).toBeDefined();
    expect(call!.body).toEqual({
      keySource: "app",
      provider: "anthropic",
      apiKey: "sk-ant-test",
      appId: "distribute-frontend",
    });
  });

  it("should forward platform keys to POST /keys without orgId/appId", async () => {
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "platform", provider: "gemini", apiKey: "gemini-key" });

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/keys") && c.method === "POST");
    expect(call).toBeDefined();
    expect(call!.body).toEqual({
      keySource: "platform",
      provider: "gemini",
      apiKey: "gemini-key",
    });
  });

  it("should reject invalid keySource", async () => {
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "bogus", provider: "stripe", apiKey: "sk_live_test" });

    expect(res.status).toBe(400);
  });

  it("should reject missing provider", async () => {
    const res = await request(app)
      .post("/v1/keys")
      .send({ keySource: "org", apiKey: "sk_live_test" });

    expect(res.status).toBe(400);
  });
});

describe("GET /v1/keys — unified proxy", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method });
      return {
        ok: true,
        json: () => Promise.resolve({ keys: [{ provider: "stripe", maskedKey: "sk_l...abc" }] }),
      };
    });
    app = createApp();
  });

  it("should default keySource to org and include orgId", async () => {
    const res = await request(app).get("/v1/keys");

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/keys"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("keySource=org");
    expect(call!.url).toContain("orgId=org_test456");
  });

  it("should forward keySource=app with appId", async () => {
    const res = await request(app).get("/v1/keys?keySource=app");

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/keys"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("keySource=app");
    expect(call!.url).toContain("appId=distribute-frontend");
  });

  it("should forward keySource=platform without orgId/appId", async () => {
    const res = await request(app).get("/v1/keys?keySource=platform");

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/keys"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("keySource=platform");
    expect(call!.url).not.toContain("orgId");
    expect(call!.url).not.toContain("appId");
  });
});

describe("DELETE /v1/keys/:provider — unified proxy", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method });
      return {
        ok: true,
        json: () => Promise.resolve({ message: "Key deleted" }),
      };
    });
    app = createApp();
  });

  it("should default keySource to org and include orgId", async () => {
    const res = await request(app).delete("/v1/keys/stripe");

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/keys/stripe") && c.method === "DELETE");
    expect(call).toBeDefined();
    expect(call!.url).toContain("keySource=org");
    expect(call!.url).toContain("orgId=org_test456");
  });

  it("should forward keySource=app with appId", async () => {
    const res = await request(app).delete("/v1/keys/anthropic?keySource=app");

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/keys/anthropic") && c.method === "DELETE");
    expect(call).toBeDefined();
    expect(call!.url).toContain("keySource=app");
    expect(call!.url).toContain("appId=distribute-frontend");
  });
});

describe("Decrypt proxy removal", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve({}),
    }));
    app = createApp();
  });

  it("should not expose /internal/keys/:provider/decrypt", async () => {
    const res = await request(app).get("/v1/internal/keys/stripe/decrypt?orgId=org_test456");
    expect(res.status).toBe(404);
  });
});
