import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/leads/:id/crm-attribution[/:step] and /v1/leads/crm-evidence/sync — pass-through
 * to lead-service. Driven through the real router with a stubbed `fetch`, so these assert
 * what goes over the wire: the full downstream path, the authenticated identity, the
 * verbatim body and query, and the upstream status + error body (the 409
 * `no_crm_evidence` code must reach the browser).
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

const LEAD = "44444444-4444-4444-4444-444444444444";
const BRAND = "75d7e3e8-6926-4f85-a557-976895400666";

function stubFetch(body: string, status = 200) {
  const calls: Array<{ url: string; init: any }> = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

const READ_BODY = JSON.stringify({
  leadCampaignId: LEAD,
  steps: [{ step: "meeting_booked", standing: "rule", causedByOutreach: true }],
  aFieldThisGatewayHasNeverHeardOf: 7,
});

describe("GET /v1/leads/:id/crm-attribution", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch(READ_BODY);
  });

  it("forwards to the full lead-service path with the query verbatim", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/crm-attribution?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname + new URL(calls[0].url).search).toBe(
      `/orgs/leads/${LEAD}/crm-attribution?brandId=${BRAND}`
    );
    expect(calls[0].init.method).toBe("GET");
  });

  it("carries the AUTHENTICATED org and user, never a caller-supplied one", async () => {
    await request(buildApp())
      .get(`/v1/leads/${LEAD}/crm-attribution`)
      .set("x-org-id", "org_spoofed_by_caller");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("returns lead-service's body untransformed", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/crm-attribution`);
    expect(res.body).toEqual(JSON.parse(READ_BODY));
  });
});

describe("PUT /v1/leads/:id/crm-attribution/:step", () => {
  it("forwards the body verbatim to the full path with org + user", async () => {
    const calls = stubFetch(JSON.stringify({ step: "sale", causedByOutreach: false, extra: 1 }));
    const body = { causedByOutreach: false, note: "they came via a referral", unknownField: "kept" };
    const res = await request(buildApp())
      .put(`/v1/leads/${LEAD}/crm-attribution/sale?brandId=${BRAND}`)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ step: "sale", causedByOutreach: false, extra: 1 });
    const url = new URL(calls[0].url);
    expect(url.pathname + url.search).toBe(`/orgs/leads/${LEAD}/crm-attribution/sale?brandId=${BRAND}`);
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(calls[0].init.body)).toEqual(body);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("forwards the 409 no_crm_evidence status and body field-for-field", async () => {
    const refusal = { error: "Their CRM evidences no sale for this lead", code: "no_crm_evidence" };
    stubFetch(JSON.stringify(refusal), 409);
    const res = await request(buildApp())
      .put(`/v1/leads/${LEAD}/crm-attribution/sale`)
      .send({ causedByOutreach: true });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(refusal);
  });

  it("does not enumerate the step vocabulary — lead-service's 400 comes back verbatim", async () => {
    const calls = stubFetch(JSON.stringify({ error: "step must be one of a | b" }), 400);
    const res = await request(buildApp())
      .put(`/v1/leads/${LEAD}/crm-attribution/some_future_step`)
      .send({ causedByOutreach: true });
    expect(calls).toHaveLength(1);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "step must be one of a | b" });
  });
});

describe("DELETE /v1/leads/:id/crm-attribution/:step", () => {
  it("forwards to the full path and returns the upstream body", async () => {
    const body = { withdrawn: false, alreadyWithdrawn: true, step: "meeting_booked" };
    const calls = stubFetch(JSON.stringify(body));
    const res = await request(buildApp()).delete(`/v1/leads/${LEAD}/crm-attribution/meeting_booked`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(new URL(calls[0].url).pathname).toBe(`/orgs/leads/${LEAD}/crm-attribution/meeting_booked`);
    expect(calls[0].init.method).toBe("DELETE");
    expect((calls[0].init.headers as Record<string, string>)["x-user-id"]).toBe("user_test123");
  });
});

describe("POST /v1/leads/crm-evidence/sync", () => {
  it("reaches the literal sync path, not /orgs/leads/{id}", async () => {
    const calls = stubFetch(JSON.stringify({ contactsWithEvents: 3 }));
    const res = await request(buildApp()).post(`/v1/leads/crm-evidence/sync?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contactsWithEvents: 3 });
    const url = new URL(calls[0].url);
    expect(url.pathname + url.search).toBe(`/orgs/leads/crm-evidence/sync?brandId=${BRAND}`);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["x-org-id"]).toBe("org_authenticated");
  });

  it("forwards a 502 naming the unreachable sibling verbatim", async () => {
    stubFetch(JSON.stringify({ error: "crm-service GET /x: 500" }), 502);
    const res = await request(buildApp()).post(`/v1/leads/crm-evidence/sync?brandId=${BRAND}`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "crm-service GET /x: 500" });
  });
});
