import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/** GET /v1/features/brands/:brandId/sales-funnel-campaigns/:id/activity → features-service, pass-through. */

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
const SFC = "7fcf42ab-fe7a-46a5-9375-90fbdd260f18";
const BODY = { steps: [{ key: "contacted", people: 42 }], pipes: [{ daily: [] }], brandNew: 1 };

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", featuresRouter);
  return a;
}

describe("GET /v1/features/brands/:brandId/sales-funnel-campaigns/:salesFunnelCampaignId/activity", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(BODY), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  it("forwards to the exact features-service path with the query verbatim and the authenticated org, body byte-equal", async () => {
    const q = "?a=1&a=2";
    const res = await request(app()).get(`/v1/features/brands/${BRAND}/sales-funnel-campaigns/${SFC}/activity${q}`).set("x-org-id", "org_other");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.pathname + u.search).toBe(`/brands/${BRAND}/sales-funnel-campaigns/${SFC}/activity${q}`);
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
  });

  it("does not disturb the sibling rows route", async () => {
    await request(app()).get(`/v1/features/brands/${BRAND}/sales-funnel-campaigns`);
    expect(new URL(calls[0].url).pathname).toBe(`/brands/${BRAND}/sales-funnel-campaigns`);
  });

  it("relays a 404 refusal field-for-field", async () => {
    global.fetch = vi.fn().mockImplementation(async () => new Response('{"error":"no","reason":"sales_funnel_campaign_not_found"}', { status: 404, headers: { "content-type": "application/json" } }));
    const res = await request(app()).get(`/v1/features/brands/${BRAND}/sales-funnel-campaigns/${SFC}/activity`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "no", reason: "sales_funnel_campaign_not_found" });
  });
});
