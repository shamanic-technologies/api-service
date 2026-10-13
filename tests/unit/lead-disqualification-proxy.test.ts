import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * PUT + DELETE /v1/leads/:id/disqualification (and the GET list reached through
 * /v1/leads/:id) — pass-through to lead-service. Driven through the real router with a
 * stubbed `fetch`: asserts the downstream URL, identity headers, body and query byte for
 * byte, and that upstream status + error body survive (CLAUDE.md rule #7 corollaries).
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

const MARK_BODY = JSON.stringify({
  id: LEAD,
  leadId: "aaaa",
  brandId: "cccc",
  offerId: null,
  disqualified: true,
  disqualification: { offerId: null, note: "wrong person", source: "manual", statedByUserId: "user_test123", statedAt: "2026-10-13T10:00:00.000Z" },
  aFieldThisGatewayHasNeverHeardOf: 7,
});

function stubFetch(body: string, status = 200) {
  const calls: Array<{ url: string; init: any }> = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

describe("PUT /v1/leads/:id/disqualification", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch(MARK_BODY);
  });

  it("forwards to lead-service PUT /orgs/leads/{id}/disqualification with the body verbatim", async () => {
    const body = { brandId: "cccc", note: "wrong person", aFieldLeadServiceMayAddLater: true };
    const res = await request(buildApp()).put(`/v1/leads/${LEAD}/disqualification`).send(body);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/disqualification`)).toBe(true);
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(calls[0].init.body)).toEqual(body);
  });

  it("carries the AUTHENTICATED org and user, never a caller-supplied one", async () => {
    await request(buildApp())
      .put(`/v1/leads/${LEAD}/disqualification`)
      .set("x-org-id", "org_spoofed_by_caller")
      .send({});
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("returns lead-service's body untransformed", async () => {
    const res = await request(buildApp()).put(`/v1/leads/${LEAD}/disqualification`).send({});
    expect(res.body).toEqual(JSON.parse(MARK_BODY));
  });

  it("forwards the upstream status and error body, code included", async () => {
    calls = stubFetch(JSON.stringify({ error: "no such lead", code: "lead_not_found" }), 404);
    const res = await request(buildApp()).put(`/v1/leads/${LEAD}/disqualification`).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "no such lead", code: "lead_not_found" });
  });
});

describe("DELETE /v1/leads/:id/disqualification", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch(JSON.stringify({ id: LEAD, withdrawn: true, disqualified: false, disqualification: null }));
  });

  it("forwards to lead-service DELETE with the query string verbatim", async () => {
    const res = await request(buildApp()).delete(`/v1/leads/${LEAD}/disqualification?brandId=cccc&offerId=dddd`);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/disqualification?brandId=cccc&offerId=dddd`)).toBe(true);
    expect(calls[0].init.method).toBe("DELETE");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(res.body.withdrawn).toBe(true);
  });

  it("forwards the upstream refusal with its own status and body", async () => {
    calls = stubFetch(JSON.stringify({ error: "brandId is required", code: "brand_required" }), 400);
    const res = await request(buildApp()).delete(`/v1/leads/${LEAD}/disqualification`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "brandId is required", code: "brand_required" });
  });
});

describe("GET /v1/leads/disqualifications (through /v1/leads/:id)", () => {
  it("reaches lead-service GET /orgs/leads/disqualifications with the query verbatim", async () => {
    const calls = stubFetch(JSON.stringify({ leads: [] }));
    const res = await request(buildApp()).get(`/v1/leads/disqualifications?brandId=cccc&offerId=dddd`);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith(`/orgs/leads/disqualifications?brandId=cccc&offerId=dddd`)).toBe(true);
    expect(res.body).toEqual({ leads: [] });
  });
});
