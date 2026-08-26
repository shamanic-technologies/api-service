import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET + POST /v1/leads/:id/step-statements — pass-through to lead-service.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what actually
 * goes over the wire: the downstream path, the identity headers, and the body byte for
 * byte. A source-substring test cannot see what a template literal interpolates, and
 * cannot see identity at all (CLAUDE.md rule #7, corollaries 2 and 3).
 *
 * The load-bearing claims here are the passthrough ones. A gateway that re-declares a
 * downstream body strips whatever it has not been taught about, and a consumer cannot
 * see the field is missing — it just reads `undefined` forever.
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

const STEPS_BODY = JSON.stringify({
  leadCampaignId: LEAD,
  leadId: "aaaa",
  campaignId: "bbbb",
  brandId: "cccc",
  steps: [
    { step: "meeting_booked", state: "outcome", source: "manual", valueCents: null, note: null, statedByUserId: "user_test123", at: "2026-08-26T10:00:00.000Z" },
    { step: "sale", state: "never", source: "manual", valueCents: null, note: "went with a competitor", statedByUserId: "user_test123", at: null },
  ],
  aFieldThisGatewayHasNeverHeardOf: 7,
});

const STATEMENT_BODY = JSON.stringify({
  statement: {
    id: "s1",
    leadCampaignId: LEAD,
    step: "meeting_attended",
    kind: "outcome",
    source: "manual",
    valueCents: null,
    aFieldThisGatewayHasNeverHeardOf: 7,
  },
  retractedNever: true,
});

function stubFetch(body: string, status = 200) {
  const calls: Array<{ url: string; init: any }> = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

describe("GET /v1/leads/:id/step-statements", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch(STEPS_BODY);
  });

  it("forwards to lead-service GET /orgs/leads/{id}/step-statements", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/step-statements`);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/step-statements`)).toBe(true);
  });

  it("carries the AUTHENTICATED org and user, never a caller-supplied one", async () => {
    await request(buildApp())
      .get(`/v1/leads/${LEAD}/step-statements`)
      .set("x-org-id", "org_spoofed_by_caller");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("returns lead-service's body untransformed, including fields it has never heard of", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/step-statements`);
    // The whole point of a passthrough: a field added downstream reaches the caller
    // with no change here. A re-declared schema would strip it silently.
    expect(res.body.aFieldThisGatewayHasNeverHeardOf).toBe(7);
    expect(res.body.steps).toHaveLength(2);
    expect(res.body.steps[1].state).toBe("never");
  });
});

describe("POST /v1/leads/:id/step-statements", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch(STATEMENT_BODY, 201);
  });

  it("forwards to lead-service POST /orgs/leads/{id}/step-statements", async () => {
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/step-statements`)
      .send({ step: "meeting_attended", kind: "outcome" });
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/step-statements`)).toBe(true);
    expect(calls[0].init.method).toBe("POST");
  });

  it("forwards the request body VERBATIM, including fields it does not know", async () => {
    // lead-service owns which statements are legal. A whitelist here would drop a
    // field it validates on, and the caller would never learn why.
    const body = {
      step: "sale",
      kind: "outcome",
      valueCents: 490000,
      note: "signed on the call",
      occurredAt: "2026-08-19T14:30:00.000Z",
      someFutureField: "keep me",
    };
    await request(buildApp()).post(`/v1/leads/${LEAD}/step-statements`).send(body);
    expect(JSON.parse(calls[0].init.body)).toEqual(body);
  });

  it("carries the AUTHENTICATED user, because lead-service records who stated the fact", async () => {
    await request(buildApp())
      .post(`/v1/leads/${LEAD}/step-statements`)
      .set("x-user-id", "user_spoofed_by_caller")
      .send({ step: "signup", kind: "outcome" });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-org-id"]).toBe("org_authenticated");
  });

  it("returns lead-service's response untransformed", async () => {
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/step-statements`)
      .send({ step: "meeting_attended", kind: "outcome" });
    expect(res.body.retractedNever).toBe(true);
    expect(res.body.statement.aFieldThisGatewayHasNeverHeardOf).toBe(7);
  });

  it("returns the UPSTREAM success status, not one this gateway decided on", async () => {
    // The route used to hardcode 201. lead-service only answers 201 today, so the
    // assertion is cheap now and is the whole contract the day it answers anything
    // else — a status this gateway invents is a downstream shape it does not own.
    calls = stubFetch(STATEMENT_BODY, 200);
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/step-statements`)
      .send({ step: "meeting_attended", kind: "outcome" });
    expect(res.status).toBe(200);
    expect(res.body.retractedNever).toBe(true);
  });

  it("forwards the caller's query string verbatim, like the sibling read", async () => {
    const query = "?campaignId=33333333-3333-3333-3333-333333333333&somethingNew=x%20y";
    await request(buildApp())
      .post(`/v1/leads/${LEAD}/step-statements${query}`)
      .send({ step: "signup", kind: "outcome" });
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/step-statements${query}`)).toBe(true);
  });

  it("forwards a REFUSAL with its own status and body, so a surface can say why", async () => {
    // A 409 flattened into a generic gateway error is what makes a consumer unable
    // to distinguish "this step already happened" from any other failure.
    calls = stubFetch(
      JSON.stringify({ error: "sale already happened for this lead", code: "STEP_ALREADY_REACHED" }),
      409,
    );
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/step-statements`)
      .send({ step: "sale", kind: "never" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STEP_ALREADY_REACHED");
  });
});
