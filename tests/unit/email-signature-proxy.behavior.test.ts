import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET|PUT|DELETE /v1/email-signature — pass-through to instantly-service /orgs/email-signature,
 * behind a brand-ownership gate (brand-service GET /orgs/brands). Driven through the real
 * router with a stubbed fetch: asserts the wire (method, path, query, body, identity headers)
 * and that a brand of another org reads and writes NOTHING.
 */

const { INSTANTLY_BASE, BRAND_BASE } = vi.hoisted(() => {
  const INSTANTLY_BASE = "http://instantly.test.local";
  const BRAND_BASE = "http://brand.test.local";
  process.env.INSTANTLY_SERVICE_URL = INSTANTLY_BASE;
  process.env.INSTANTLY_SERVICE_API_KEY = "instantly-test-key";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { INSTANTLY_BASE, BRAND_BASE };
});

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "admin";
    if (req.headers["x-brand-id"]) req.brandId = req.headers["x-brand-id"];
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import conversationsRouter from "../../src/routes/conversations.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", conversationsRouter);
  return app;
}

const BRAND = "44444444-4444-4444-4444-444444444444";
const FOREIGN_BRAND = "55555555-5555-4555-8555-555555555555";

let calls: Array<{ url: string; options: any }>;

function upstream(opts: { status?: number; body?: unknown } = {}) {
  const { status = 200, body = { brandId: BRAND, signature: null, updatedAt: null } } = opts;
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    const json = { "content-type": "application/json" };
    if (url.startsWith(`${BRAND_BASE}/orgs/brands`)) {
      return new Response(JSON.stringify({ brands: [{ id: BRAND }] }), { status: 200, headers: json });
    }
    return new Response(JSON.stringify(body), { status, headers: json });
  });
}

const instantlyCalls = () => calls.filter((c) => c.url.startsWith(INSTANTLY_BASE));

beforeEach(() => {
  calls = [];
});

describe("/v1/email-signature", () => {
  it("GET forwards the query verbatim with identity headers after the ownership check", async () => {
    upstream();
    const res = await request(buildApp()).get(`/v1/email-signature?brandId=${BRAND}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ brandId: BRAND, signature: null, updatedAt: null });
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands`);
    const [call] = instantlyCalls();
    expect(call.url).toBe(`${INSTANTLY_BASE}/orgs/email-signature?brandId=${BRAND}`);
    expect(call.options.method).toBe("GET");
    expect(call.options.headers["x-org-id"]).toBe("org_authenticated");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("PUT forwards the body as-is to /orgs/email-signature", async () => {
    const saved = { brandId: BRAND, signature: "Jane Doe\nAcme", updatedAt: "2026-10-14T10:00:00.000Z" };
    upstream({ body: saved });
    const sent = { brandId: BRAND, signature: "Jane Doe\nAcme", extra: 1 };
    const res = await request(buildApp()).put("/v1/email-signature").send(sent);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(saved);
    const [call] = instantlyCalls();
    expect(call.url).toBe(`${INSTANTLY_BASE}/orgs/email-signature`);
    expect(call.options.method).toBe("PUT");
    expect(JSON.parse(call.options.body)).toEqual(sent);
    expect(call.options.headers["x-org-id"]).toBe("org_authenticated");
  });

  it("DELETE forwards the query verbatim", async () => {
    upstream();
    const res = await request(buildApp()).delete(`/v1/email-signature?brandId=${BRAND}`);

    expect(res.status).toBe(200);
    const [call] = instantlyCalls();
    expect(call.url).toBe(`${INSTANTLY_BASE}/orgs/email-signature?brandId=${BRAND}`);
    expect(call.options.method).toBe("DELETE");
  });

  it("a brand of another org: 404 brand_not_in_org on every method, instantly-service never called", async () => {
    upstream();
    const app = buildApp();
    const responses = [
      await request(app).get(`/v1/email-signature?brandId=${FOREIGN_BRAND}`),
      await request(app).put("/v1/email-signature").send({ brandId: FOREIGN_BRAND, signature: "x" }),
      await request(app).delete(`/v1/email-signature?brandId=${FOREIGN_BRAND}`),
    ];
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("brand_not_in_org");
    }
    expect(instantlyCalls()).toHaveLength(0);
  });

  it("400 without brandId, no downstream call", async () => {
    upstream();
    const app = buildApp();
    expect((await request(app).get("/v1/email-signature")).status).toBe(400);
    expect((await request(app).put("/v1/email-signature").send({ signature: "x" })).status).toBe(400);
    expect((await request(app).delete("/v1/email-signature")).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("forwards a downstream 400 body field-for-field under its status", async () => {
    upstream({ status: 400, body: { error: "Signature has 13 lines; at most 12" } });
    const res = await request(buildApp()).put("/v1/email-signature").send({ brandId: BRAND, signature: "x" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Signature has 13 lines; at most 12" });
  });
});
