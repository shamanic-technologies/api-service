import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Sales funnel campaigns (campaign-service) + their caps (billing-service): pass-through proxies.
 *
 * Driven through the real routers with a stubbed `fetch`: asserts the full downstream path, the
 * authenticated org header, the verbatim query / body and the relayed status + body.
 */

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

import campaignsRouter from "../../src/routes/campaigns.js";
import billingRouter from "../../src/routes/billing.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignsRouter);
  app.use("/v1", billingRouter);
  return app;
}

const BRAND = "d0965c2c-a58f-4497-addd-6a19e556b068";
const OFFER = "70051e12-bf19-4639-a54e-cf4f9c1df8dd";
const FUNNEL = "lead_found_to_website_visit@sales-cold-email-outreach+website_visit_to_purchase";
const FUNNEL_ENCODED = encodeURIComponent(FUNNEL);
const SFC = "5b1d7d7e-1111-4222-8333-444455556666";

const BODY = JSON.stringify({ salesFunnelCampaigns: [{ id: SFC, salesFunnelName: "Epiphany", status: "stopped", brandNew: 1 }] });

function respond(status: number, body: string) {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("sales funnel campaigns + caps — pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return respond(200, BODY);
    });
  });

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("GET list: forwards to /sales-funnel-campaigns with the query verbatim and the authenticated org", async () => {
    const query = `?brandId=${BRAND}&offerId=${OFFER}&status=stopped&extra=a&extra=b`;
    const res = await request(buildApp()).get(`/v1/sales-funnel-campaigns${query}`).set("x-org-id", "org_someone_else");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(BODY));
    const { url, init } = upstream();
    expect(new URL(url).pathname + new URL(url).search).toBe(`/sales-funnel-campaigns${query}`);
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
  });

  it("POST: forwards the body untouched and relays the 201", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return respond(201, '{"salesFunnelCampaign":{"id":"x"},"created":true,"started":false}');
    });
    const body = { brandId: BRAND, offerId: OFFER, salesFunnelId: FUNNEL, status: "stopped", future: true };
    const res = await request(buildApp()).post("/v1/sales-funnel-campaigns").send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ salesFunnelCampaign: { id: "x" }, created: true, started: false });
    const { url, init } = upstream();
    expect(new URL(url).pathname).toBe("/sales-funnel-campaigns");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("GET one: forwards to /sales-funnel-campaigns/{id}", async () => {
    await request(buildApp()).get(`/v1/sales-funnel-campaigns/${SFC}`);
    expect(new URL(upstream().url).pathname).toBe(`/sales-funnel-campaigns/${SFC}`);
  });

  it("PATCH: forwards {status} untouched and relays a 409 refusal field-for-field", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return respond(409, '{"error":"Add a card first.","reason":"no_payment_method"}');
    });
    const res = await request(buildApp()).patch(`/v1/sales-funnel-campaigns/${SFC}`).send({ status: "activate" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Add a card first.", reason: "no_payment_method" });
    const { url, init } = upstream();
    expect(new URL(url).pathname).toBe(`/sales-funnel-campaigns/${SFC}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ status: "activate" });
  });

  it("caps GET: forwards to billing's same path with the funnel id re-encoded", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND}/offers/${OFFER}/sales-funnels/${FUNNEL_ENCODED}/caps`);
    expect(res.status).toBe(200);
    const { url, init } = upstream();
    expect(url).toContain(`/v1/brands/${BRAND}/offers/${OFFER}/sales-funnels/${FUNNEL_ENCODED}/caps`);
    expect(decodeURIComponent(new URL(url).pathname)).toBe(`/v1/brands/${BRAND}/offers/${OFFER}/sales-funnels/${FUNNEL}/caps`);
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
  });

  it("caps PUT: forwards the body untouched", async () => {
    const body = { maxBudget: { amountCents: 5000, period: "weekly" }, maxVolume: { count: 200, period: "monthly" } };
    await request(buildApp()).put(`/v1/brands/${BRAND}/offers/${OFFER}/sales-funnels/${FUNNEL_ENCODED}/caps`).send(body);
    const { init } = upstream();
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("caps DELETE: forwards the method, no body", async () => {
    await request(buildApp()).delete(`/v1/brands/${BRAND}/offers/${OFFER}/sales-funnels/${FUNNEL_ENCODED}/caps`);
    const { init } = upstream();
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("caps 404 relayed field-for-field", async () => {
    global.fetch = vi.fn().mockImplementation(async () => respond(404, '{"error":"unknown funnel","reason":"sales_funnel_not_found"}'));
    const res = await request(buildApp()).get(`/v1/brands/${BRAND}/offers/${OFFER}/sales-funnels/x/caps`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "unknown funnel", reason: "sales_funnel_not_found" });
  });

  it("brand caps list: forwards to /v1/brands/{brandId}/sales-funnel-caps with the query verbatim", async () => {
    await request(buildApp()).get(`/v1/brands/${BRAND}/sales-funnel-caps?offerId=${OFFER}`);
    const u = new URL(upstream().url);
    expect(u.pathname + u.search).toBe(`/v1/brands/${BRAND}/sales-funnel-caps?offerId=${OFFER}`);
  });
});
