import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/leads/:id/timeline — pass-through to lead-service GET /orgs/leads/{id}/timeline.
 *
 * Driven through the real router with a stubbed `fetch`: asserts the downstream path,
 * the identity headers, the query string and that status + body are relayed verbatim.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import leadsRouter from "../../src/routes/leads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", leadsRouter);
  return app;
}

const LEAD = "22222222-2222-2222-2222-222222222222";
const BRAND = "11111111-1111-1111-1111-111111111111";
const OFFER = "33333333-3333-3333-3333-333333333333";

const TIMELINE_BODY = JSON.stringify({
  leadId: "lead-1",
  brandId: BRAND,
  offerId: OFFER,
  items: [
    { at: "2026-09-01T10:00:00.000Z", fact: "replied", label: "Not interested", somethingBrandNew: 42 },
  ],
  tags: {
    lastWord: "not_interested",
    lastWordAt: "2026-09-01T10:00:00.000Z",
    furthestStep: "contacted",
    furthestStepAttributable: true,
  },
});

function respond(status: number, body: string) {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("GET /v1/leads/:id/timeline — per-lead timeline pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return respond(200, TIMELINE_BODY);
    });
  });

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("forwards path + brandId/offerId verbatim to lead-service GET /orgs/leads/{id}/timeline", async () => {
    const query = `?brandId=${BRAND}&offerId=${OFFER}`;
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/timeline${query}`);
    expect(res.status).toBe(200);
    const { url, init } = upstream();
    expect(url.endsWith(`/orgs/leads/${LEAD}/timeline${query}`)).toBe(true);
    expect(init.method ?? "GET").toBe("GET");
  });

  it("relays the 200 body untouched, unknown fields intact", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/timeline?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(TIMELINE_BODY));
  });

  it("sends the AUTHENTICATED org, not one the caller named", async () => {
    await request(buildApp())
      .get(`/v1/leads/${LEAD}/timeline?brandId=${BRAND}`)
      .set("x-org-id", "org_someone_else");
    const { init } = upstream();
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
    expect(init.headers["x-user-id"]).toBe("user_test123");
  });

  it("relays lead-service's 400 (no brandId) field-for-field, without refusing it itself", async () => {
    const upstreamCall = vi
      .fn()
      .mockImplementation(async () => respond(400, '{"error":"brandId is required","code":"BRAND_REQUIRED"}'));
    global.fetch = upstreamCall;
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/timeline`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "brandId is required", code: "BRAND_REQUIRED" });
    expect(upstreamCall).toHaveBeenCalledTimes(1);
  });

  it("relays lead-service's 404 field-for-field", async () => {
    global.fetch = vi
      .fn()
      .mockImplementation(async () => respond(404, '{"error":"Lead not found","code":"LEAD_NOT_FOUND"}'));
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/timeline?brandId=${BRAND}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Lead not found", code: "LEAD_NOT_FOUND" });
  });

  it("does not shadow the sibling history route", async () => {
    await request(buildApp()).get(`/v1/leads/${LEAD}/history`);
    expect(upstream().url.endsWith(`/orgs/leads/${LEAD}/history`)).toBe(true);
  });
});
