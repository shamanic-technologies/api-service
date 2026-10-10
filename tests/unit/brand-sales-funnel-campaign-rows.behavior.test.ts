import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/** GET /v1/features/brands/:brandId/sales-funnel-campaigns → features-service, pass-through. */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  },
  authenticatePlatform: (_req: any, _res: any, next: any) => next(),
  requireStaff: (_req: any, _res: any, next: any) => next(),
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import featuresRouter from "../../src/routes/features.js";

const BRAND = "933d4abb-9695-4fcb-b3aa-354d61565798";
const OFFER = "e59646e4-e351-462d-a8a7-618098e7e5c1";
const BODY = { salesFunnelCampaigns: [{ id: "x", name: "Bliss", typeLabel: "Daily", path: { items: [] }, investedUsd: 12.5, brandNew: 1 }] };

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", featuresRouter);
  return a;
}

describe("GET /v1/features/brands/:brandId/sales-funnel-campaigns", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(BODY), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  it("forwards to features-service with the query verbatim and the authenticated org, body byte-equal", async () => {
    const q = `?offerId=${OFFER}&pricing=net&extra=1`;
    const res = await request(app()).get(`/v1/features/brands/${BRAND}/sales-funnel-campaigns${q}`).set("x-org-id", "org_other");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.pathname + u.search).toBe(`/brands/${BRAND}/sales-funnel-campaigns${q}`);
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
  });

  it("relays a 404 refusal field-for-field", async () => {
    global.fetch = vi.fn().mockImplementation(async () => new Response('{"error":"no","reason":"brand_not_found"}', { status: 404, headers: { "content-type": "application/json" } }));
    const res = await request(app()).get(`/v1/features/brands/${BRAND}/sales-funnel-campaigns`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "no", reason: "brand_not_found" });
  });
});
