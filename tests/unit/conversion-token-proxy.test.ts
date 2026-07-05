import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.brandId = "brand_testabc";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import brandRouter from "../../src/routes/brand.js";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const tokenResponse = { token: "cvt_abc123", ingestUrl: "https://api.distribute.you/public/conversions" };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

describe("Brand conversion-token proxies (authed → lead-service)", () => {
  let app: express.Express;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    capturedUrl = undefined;
    capturedInit = undefined;

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200, json: () => Promise.resolve(tokenResponse) };
    });
  });

  // AC1
  it("GET forwards to lead-service /orgs/brands/:id/conversion-token and returns {token, ingestUrl}", async () => {
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/conversion-token`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(tokenResponse);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/conversion-token`);
    expect(capturedInit?.method ?? "GET").toBe("GET");
  });

  it("GET forwards identity headers", async () => {
    await request(app).get(`/v1/brands/${BRAND_ID}/conversion-token`);
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  // AC2
  it("POST /rotate forwards to lead-service /orgs/brands/:id/conversion-token/rotate and returns a new {token, ingestUrl}", async () => {
    const res = await request(app).post(`/v1/brands/${BRAND_ID}/conversion-token/rotate`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(tokenResponse);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/conversion-token/rotate`);
    expect(capturedInit?.method).toBe("POST");
  });

  it("propagates an upstream 404 verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"Brand not found"}'),
    }));
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/conversion-token`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Brand not found");
  });
});

// Public ingest — no Clerk auth, token travels in header
import conversionsRouter from "../../src/routes/conversions.js";

function buildPublicApp() {
  const app = express();
  app.use(express.json());
  app.use(conversionsRouter);
  return app;
}

describe("POST /public/conversions (public ingest → lead-service)", () => {
  let app: express.Express;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildPublicApp();
    capturedUrl = undefined;
    capturedInit = undefined;

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200, json: () => Promise.resolve({ received: true }) };
    });
  });

  const body = { event: "Signup", email: "lead@acme.com", url: "https://acme.com/thanks" };

  // AC3 — reaches lead-service without a Clerk session, forwards token header + body
  it("reaches lead-service (no Clerk auth) and forwards the token header + raw body", async () => {
    const res = await request(app)
      .post("/public/conversions")
      .set("x-conversion-token", "cvt_abc123")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(capturedUrl).toContain("/public/conversions");
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-conversion-token"]).toBe("cvt_abc123");
  });

  it("forwards an Authorization: Bearer header when present", async () => {
    await request(app)
      .post("/public/conversions")
      .set("Authorization", "Bearer cvt_abc123")
      .send(body);
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer cvt_abc123");
  });

  // AC4 — bad token: gateway forwards, returns lead-service's 401 (does not gate itself)
  it("propagates lead-service's 401 on a bad token (gateway does not gate)", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"error":"Invalid conversion token"}'),
    }));
    const res = await request(app)
      .post("/public/conversions")
      .set("x-conversion-token", "bad")
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid conversion token");
  });
});
