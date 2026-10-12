import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/email-sequences — pass-through to instantly-service GET /orgs/email-sequences,
 * behind a brand-ownership gate (brand-service GET /orgs/brands). Driven through the real
 * router with a stubbed fetch: asserts the wire (path, query, identity headers), the
 * byte-identical body, and that a brand of another org reads NOTHING.
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

const BODY = JSON.stringify({
  brandId: BRAND,
  count: 1,
  sequences: [
    {
      leadId: "lead-1",
      leadEmail: "jane@acme.com",
      campaignId: "camp-1",
      steps: [
        { step: 1, kind: "first_email", status: "sent", sentAt: "2026-10-09T10:45:37.185Z" },
        { step: 2, kind: "follow_up", status: "queued", sentAt: null },
      ],
    },
  ],
  nextCursor: null,
  unknownDownstreamField: 7,
});

let calls: Array<{ url: string; options: any }>;

function upstream(opts: { orgBrands?: string[]; status?: number; body?: string } = {}) {
  const { orgBrands = [BRAND], status = 200, body = BODY } = opts;
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    const json = { "content-type": "application/json; charset=utf-8" };
    if (url.startsWith(`${BRAND_BASE}/orgs/brands`)) {
      return new Response(JSON.stringify({ brands: orgBrands.map((id) => ({ id })) }), { status: 200, headers: json });
    }
    return new Response(body, { status, headers: json });
  });
}

beforeEach(() => {
  calls = [];
});

describe("GET /v1/email-sequences", () => {
  it("own brand: checks ownership, then forwards the query verbatim with identity headers, body byte-for-byte", async () => {
    upstream();
    const res = await request(buildApp()).get(`/v1/email-sequences?brandId=${BRAND}&limit=200&cursor=abc`);

    expect(res.status).toBe(200);
    expect(res.text).toBe(BODY);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[1].url).toBe(`${INSTANTLY_BASE}/orgs/email-sequences?brandId=${BRAND}&limit=200&cursor=abc`);
    expect(calls[1].options.headers["X-API-Key"]).toBe("instantly-test-key");
    expect(calls[1].options.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[1].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[1].options.headers["x-brand-id"]).toBe(BRAND);
  });

  it("a brand of another org: 404 brand_not_in_org, and instantly-service is never read", async () => {
    upstream({ orgBrands: [BRAND] });
    const res = await request(buildApp()).get(`/v1/email-sequences?brandId=${FOREIGN_BRAND}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("brand_not_in_org");
    expect(calls.some((c) => c.url.startsWith(INSTANTLY_BASE))).toBe(false);
  });

  it("400 without brandId, no downstream call", async () => {
    upstream();
    const res = await request(buildApp()).get("/v1/email-sequences");
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("forwards a downstream error body field-for-field under its status", async () => {
    const err = JSON.stringify({ error: "invalid cursor: nope" });
    upstream({ status: 400, body: err });
    const res = await request(buildApp()).get(`/v1/email-sequences?brandId=${BRAND}&cursor=nope`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid cursor: nope" });
  });
});
