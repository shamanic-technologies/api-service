import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

interface FetchCall {
  url: string;
  method?: string;
  body?: any;
}

let fetchCalls: FetchCall[] = [];

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

function mockFetchWith(response: any) {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    fetchCalls.push({ url, method: init?.method, body });
    return { ok: true, json: () => Promise.resolve(response) };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  fetchCalls = [];
  mockAuth = { userId: "user_test123", orgId: "org_test456", authType: "user_key" };
  mockFetchWith({});
});

// -----------------------------------------------------------------------
// GET /v1/keys/sources
// -----------------------------------------------------------------------

describe("GET /v1/keys/sources", () => {
  it("should proxy to key-service /keys/sources", async () => {
    mockFetchWith({ sources: [{ provider: "openai", keySource: "org" }] });
    const app = createApp();
    const res = await request(app).get("/v1/keys/sources");

    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([{ provider: "openai", keySource: "org" }]);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/keys/sources");
  });

  it("should reject when no org context", async () => {
    mockAuth.orgId = "";
    const app = createApp();
    const res = await request(app).get("/v1/keys/sources");

    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// GET /v1/keys/:provider/source
// -----------------------------------------------------------------------

describe("GET /v1/keys/:provider/source", () => {
  it("should proxy to key-service /keys/:provider/source", async () => {
    mockFetchWith({ provider: "openai", orgId: "org_test456", keySource: "platform", isDefault: true });
    const app = createApp();
    const res = await request(app).get("/v1/keys/openai/source");

    expect(res.status).toBe(200);
    expect(res.body.keySource).toBe("platform");
    expect(fetchCalls[0].url).toContain("/keys/openai/source");
  });

  it("should reject when no org context", async () => {
    mockAuth.orgId = "";
    const app = createApp();
    const res = await request(app).get("/v1/keys/openai/source");

    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// PUT /v1/keys/:provider/source
// -----------------------------------------------------------------------

describe("PUT /v1/keys/:provider/source", () => {
  it("should proxy to key-service with keySource in body", async () => {
    mockFetchWith({ provider: "openai", orgId: "org_test456", keySource: "org", message: "saved" });
    const app = createApp();
    const res = await request(app)
      .put("/v1/keys/openai/source")
      .send({ keySource: "org" });

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.method === "PUT");
    expect(call!.url).toContain("/keys/openai/source");
    expect(call!.body).toEqual({ keySource: "org" });
  });

  it("should reject invalid keySource value", async () => {
    const app = createApp();
    const res = await request(app)
      .put("/v1/keys/openai/source")
      .send({ keySource: "invalid" });

    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it("should reject missing keySource", async () => {
    const app = createApp();
    const res = await request(app)
      .put("/v1/keys/openai/source")
      .send({});

    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it("should reject when no org context", async () => {
    mockAuth.orgId = "";
    const app = createApp();
    const res = await request(app)
      .put("/v1/keys/openai/source")
      .send({ keySource: "org" });

    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// POST /v1/keys/provider-requirements
// -----------------------------------------------------------------------

describe("POST /v1/keys/provider-requirements", () => {
  it("should proxy to key-service /provider-requirements", async () => {
    const reqBody = {
      endpoints: [{ service: "email-gateway", method: "POST", path: "/send" }],
    };
    mockFetchWith({
      requirements: [{ service: "email-gateway", method: "POST", path: "/send", provider: "postmark" }],
      providers: ["postmark"],
    });
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys/provider-requirements")
      .send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual(["postmark"]);
    const call = fetchCalls.find((c) => c.method === "POST");
    expect(call!.url).toContain("/provider-requirements");
    expect(call!.body).toEqual(reqBody);
  });

  it("should reject empty endpoints array", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys/provider-requirements")
      .send({ endpoints: [] });

    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it("should reject missing endpoints field", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/keys/provider-requirements")
      .send({});

    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });
});
