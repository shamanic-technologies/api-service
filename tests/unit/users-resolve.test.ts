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

import usersRoutes from "../../src/routes/users.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", usersRoutes);
  return app;
}

function mockFetchOk(responseData: any = {}) {
  fetchCalls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    fetchCalls.push({ url, method: init?.method, body });
    return { ok: true, json: () => Promise.resolve(responseData) };
  });
}

// ---------------------------------------------------------------------------
// POST /v1/users/resolve
// ---------------------------------------------------------------------------

describe("POST /v1/users/resolve", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchOk({
      orgId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      orgCreated: false,
      userCreated: true,
    });
    app = createApp();
  });

  it("should proxy to client-service /resolve with appId injected", async () => {
    const res = await request(app)
      .post("/v1/users/resolve")
      .send({
        externalOrgId: "clerk_org_abc",
        externalUserId: "anon_user_123",
        email: "user@polarity.com",
        firstName: "Kevin",
      });

    expect(res.status).toBe(200);
    expect(res.body.userId).toBeDefined();
    expect(res.body.userCreated).toBe(true);

    const call = fetchCalls.find((c) => c.url.includes("/resolve"));
    expect(call).toBeDefined();
    expect(call!.method).toBe("POST");
    expect(call!.body).toMatchObject({
      appId: "distribute-frontend",
      externalOrgId: "clerk_org_abc",
      externalUserId: "anon_user_123",
      email: "user@polarity.com",
      firstName: "Kevin",
    });
  });

  it("should pass through optional contact fields", async () => {
    const res = await request(app)
      .post("/v1/users/resolve")
      .send({
        externalOrgId: "clerk_org_abc",
        externalUserId: "anon_user_456",
        email: "jane@example.com",
        firstName: "Jane",
        lastName: "Doe",
        imageUrl: "https://example.com/avatar.png",
      });

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/resolve"));
    expect(call!.body).toMatchObject({
      appId: "distribute-frontend",
      externalOrgId: "clerk_org_abc",
      externalUserId: "anon_user_456",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      imageUrl: "https://example.com/avatar.png",
    });
  });

  it("should work with only required fields (no contact info)", async () => {
    const res = await request(app)
      .post("/v1/users/resolve")
      .send({
        externalOrgId: "clerk_org_abc",
        externalUserId: "anon_user_789",
      });

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/resolve"));
    expect(call!.body).toMatchObject({
      appId: "distribute-frontend",
      externalOrgId: "clerk_org_abc",
      externalUserId: "anon_user_789",
    });
    // No optional fields sent
    expect(call!.body.email).toBeUndefined();
    expect(call!.body.firstName).toBeUndefined();
  });

  it("should return 400 when externalOrgId is missing", async () => {
    const res = await request(app)
      .post("/v1/users/resolve")
      .send({ externalUserId: "anon_user_123" });
    expect(res.status).toBe(400);
  });

  it("should return 400 when externalUserId is missing", async () => {
    const res = await request(app)
      .post("/v1/users/resolve")
      .send({ externalOrgId: "clerk_org_abc" });
    expect(res.status).toBe(400);
  });

  it("should return 400 when body is empty", async () => {
    const res = await request(app)
      .post("/v1/users/resolve")
      .send({});
    expect(res.status).toBe(400);
  });

  it("should return 400 when email is invalid", async () => {
    const res = await request(app)
      .post("/v1/users/resolve")
      .send({
        externalOrgId: "clerk_org_abc",
        externalUserId: "anon_user_123",
        email: "not-an-email",
      });
    expect(res.status).toBe(400);
  });

  it("should return 500 when client-service fails", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Internal error" }),
      text: () => Promise.resolve('{"error":"Internal error"}'),
    }));
    app = createApp();

    const res = await request(app)
      .post("/v1/users/resolve")
      .send({
        externalOrgId: "clerk_org_abc",
        externalUserId: "anon_user_123",
      });
    expect(res.status).toBe(500);
  });
});
