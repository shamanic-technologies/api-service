import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET + POST /v1/leads/:id/followups — pass-through to lead-service.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what actually
 * goes over the wire: the downstream path, the identity headers, the body byte for
 * byte, and the refusals coming back. A source-substring test cannot see what a
 * template literal interpolates, and cannot see identity at all (CLAUDE.md rule #7,
 * corollaries 2 and 3).
 *
 * The load-bearing claim on the write is the refusal one. lead-service names why it
 * would not move a due date — a schedule somebody stopped, a date outside the accepted
 * range, an unparseable one — and the customer reads that reason. A refusal flattened
 * into a generic error makes the button unexplainable.
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

const FOLLOWUP_BODY = JSON.stringify({
  followup: {
    id: LEAD,
    leadId: "50000000-0000-0000-0000-000000000002",
    campaignId: "camp-1",
    dueAt: "2026-09-05T09:00:00.000Z",
    claimedAt: null,
    followupCount: 3,
    lastActionAt: "2026-08-29T09:00:00.000Z",
    stoppedReason: null,
    aFieldThisGatewayHasNeverHeardOf: 7,
  },
});

function stubFetch(body: string, status = 200) {
  const calls: Array<{ url: string; init: any }> = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

describe("GET /v1/leads/:id/followups", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch(FOLLOWUP_BODY);
  });

  it("forwards to lead-service GET /orgs/leads/{id}/followups", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/followups`);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/followups`)).toBe(true);
  });

  it("carries the AUTHENTICATED org and user, never a caller-supplied one", async () => {
    await request(buildApp())
      .get(`/v1/leads/${LEAD}/followups`)
      .set("x-org-id", "org_spoofed_by_caller");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("returns lead-service's body untransformed, including fields it has never heard of", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/followups`);
    expect(res.body.followup.aFieldThisGatewayHasNeverHeardOf).toBe(7);
    expect(res.body.followup.dueAt).toBe("2026-09-05T09:00:00.000Z");
  });
});

describe("POST /v1/leads/:id/followups", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch(FOLLOWUP_BODY, 200);
  });

  it("forwards to lead-service POST /orgs/leads/{id}/followups", async () => {
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/followups`)
      .send({ kind: "scheduled", dueAt: "2026-09-05T09:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/followups`)).toBe(true);
    expect(calls[0].init.method).toBe("POST");
  });

  it("forwards the request body VERBATIM, including fields and kinds it does not know", async () => {
    // lead-service owns the vocabulary. An enum copied here would 400 a kind it
    // accepts, and every one it ships later would need a gateway release.
    const body = {
      kind: "a_kind_shipped_tomorrow",
      dueAt: "2026-09-05T09:00:00.000Z",
      nextDueAt: "2026-09-12T09:00:00.000Z",
      reason: "answered_again",
      someFutureField: "keep me",
    };
    await request(buildApp()).post(`/v1/leads/${LEAD}/followups`).send(body);
    expect(JSON.parse(calls[0].init.body)).toEqual(body);
  });

  it("carries the AUTHENTICATED org and user, never a caller-supplied one", async () => {
    await request(buildApp())
      .post(`/v1/leads/${LEAD}/followups`)
      .set("x-org-id", "org_spoofed_by_caller")
      .set("x-user-id", "user_spoofed_by_caller")
      .send({ kind: "scheduled", dueAt: "2026-09-05T09:00:00.000Z" });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("returns lead-service's response untransformed", async () => {
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/followups`)
      .send({ kind: "scheduled", dueAt: "2026-09-05T09:00:00.000Z" });
    expect(res.body.followup.aFieldThisGatewayHasNeverHeardOf).toBe(7);
    expect(res.body.followup.followupCount).toBe(3);
  });

  it("returns the UPSTREAM success status, not one this gateway decided on", async () => {
    calls = stubFetch(FOLLOWUP_BODY, 201);
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/followups`)
      .send({ kind: "scheduled", dueAt: "2026-09-05T09:00:00.000Z" });
    expect(res.status).toBe(201);
  });

  it("forwards the caller's query string verbatim, like the sibling read", async () => {
    const query = "?campaignId=33333333-3333-3333-3333-333333333333&somethingNew=x%20y";
    await request(buildApp())
      .post(`/v1/leads/${LEAD}/followups${query}`)
      .send({ kind: "scheduled", dueAt: "2026-09-05T09:00:00.000Z" });
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/followups${query}`)).toBe(true);
  });

  it("forwards a REFUSAL with its own status and body, so the customer reads the reason", async () => {
    // A date outside the accepted range comes back naming itself and carrying the
    // bounds. Flattened into `{ error: "<the whole body>" }` no surface could branch
    // on it, and "answer them now" would fail without saying why.
    calls = stubFetch(
      JSON.stringify({
        error: "dueAt is outside the accepted range",
        code: "due_date_out_of_bounds",
        details: { earliest: "2026-09-05T00:00:00.000Z", latest: "2027-09-05T00:00:00.000Z" },
      }),
      400,
    );
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/followups`)
      .send({ kind: "scheduled", dueAt: "1999-01-01T00:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("due_date_out_of_bounds");
    expect(res.body.details.latest).toBe("2027-09-05T00:00:00.000Z");
  });

  it("forwards a 404 for a lead outside this org", async () => {
    calls = stubFetch(JSON.stringify({ error: "No such lead row for this org" }), 404);
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/followups`)
      .send({ kind: "scheduled", dueAt: "2026-09-05T09:00:00.000Z" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("No such lead row for this org");
  });
});

describe("route ordering — the literal siblings still reach their own downstream path", () => {
  // `/leads/:id` matches any single segment, so a two-segment sibling declared in the
  // wrong order is the hazard a same-file family produces.
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch(FOLLOWUP_BODY);
  });

  it("keeps /leads/stats, /leads/:id, /leads/:id/history and /leads/:id/followups distinct", async () => {
    const app = buildApp();
    await request(app).get("/v1/leads/stats");
    await request(app).get(`/v1/leads/${LEAD}`);
    await request(app).get(`/v1/leads/${LEAD}/history`);
    await request(app).get(`/v1/leads/${LEAD}/followups`);
    expect(calls[0].url.endsWith("/orgs/stats")).toBe(true);
    expect(calls[1].url.endsWith(`/orgs/leads/${LEAD}`)).toBe(true);
    expect(calls[2].url.endsWith(`/orgs/leads/${LEAD}/history`)).toBe(true);
    expect(calls[3].url.endsWith(`/orgs/leads/${LEAD}/followups`)).toBe(true);
  });
});
