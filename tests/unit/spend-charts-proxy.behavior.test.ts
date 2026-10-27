import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/** SPEND-CHARTS-1019: campaign + offer spend charts → features-service, pass-through. */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "user_key";
    next();
  },
  authenticatePlatform: (_req: any, _res: any, next: any) => next(),
  requireStaff: (_req: any, _res: any, next: any) => next(),
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import featuresRouter from "../../src/routes/features.js";
import { buildDocument } from "../../src/openapi/document.js";

const BRAND = "933d4abb-9695-4fcb-b3aa-354d61565798";
const SFC = "7fcf42ab-fe7a-46a5-9375-90fbdd260f18";
const OFFER = "0b6c1e1c-5f0e-4b63-9a6b-2f6a1c2d3e4f";
const BODY = { days: [{ day: "2026-10-18", costPerOutcome: 12.5, learning: true }], pipes: [{ days: [] }], brandNew: 1 };

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", featuresRouter);
  return a;
}

describe("spend-charts proxies", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(BODY), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  it("campaign: forwards to the exact features-service path, query verbatim, authenticated identity, body byte-equal", async () => {
    const q = "?pricing=net&x=1&x=2";
    const res = await request(app()).get(`/v1/features/brands/${BRAND}/sales-funnel-campaigns/${SFC}/spend-charts${q}`).set("x-org-id", "org_other");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.pathname + u.search).toBe(`/brands/${BRAND}/sales-funnel-campaigns/${SFC}/spend-charts${q}`);
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[0].init.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].init.headers["x-run-id"]).toBe("run_test789");
  });

  it("offer: forwards to the exact features-service path, query verbatim, authenticated identity, body byte-equal", async () => {
    const q = `?brandId=${BRAND}&pricing=net`;
    const res = await request(app()).get(`/v1/offers/${OFFER}/spend-charts${q}`).set("x-org-id", "org_other");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.pathname + u.search).toBe(`/offers/${OFFER}/spend-charts${q}`);
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[0].init.headers["x-user-id"]).toBe("user_test123");
  });

  it("offer outcome-cost-series: forwards to the exact features-service path, query verbatim, authenticated identity, body byte-equal", async () => {
    const q = `?brandId=${BRAND}&pricing=net`;
    const res = await request(app()).get(`/v1/offers/${OFFER}/outcome-cost-series${q}`).set("x-org-id", "org_other");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.pathname + u.search).toBe(`/offers/${OFFER}/outcome-cost-series${q}`);
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[0].init.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].init.headers["x-run-id"]).toBe("run_test789");
  });

  it("relays refusals field-for-field with their status", async () => {
    global.fetch = vi.fn().mockImplementation(async () => new Response('{"error":"no","reason":"sales_funnel_campaign_not_found"}', { status: 404, headers: { "content-type": "application/json" } }));
    const c = await request(app()).get(`/v1/features/brands/${BRAND}/sales-funnel-campaigns/${SFC}/spend-charts`);
    expect(c.status).toBe(404);
    expect(c.body).toEqual({ error: "no", reason: "sales_funnel_campaign_not_found" });

    global.fetch = vi.fn().mockImplementation(async () => new Response('{"error":"brandId required","reason":"brand_id_required"}', { status: 400, headers: { "content-type": "application/json" } }));
    const o = await request(app()).get(`/v1/offers/${OFFER}/spend-charts`);
    expect(o.status).toBe(400);
    expect(o.body).toEqual({ error: "brandId required", reason: "brand_id_required" });
  });

  it("both paths are in the published customer document", () => {
    const doc: any = buildDocument();
    expect(doc.paths["/v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/spend-charts"]?.get).toBeDefined();
    expect(doc.paths["/v1/offers/{offerId}/spend-charts"]?.get).toBeDefined();
    expect(doc.paths["/v1/offers/{offerId}/outcome-cost-series"]?.get).toBeDefined();
  });
});
