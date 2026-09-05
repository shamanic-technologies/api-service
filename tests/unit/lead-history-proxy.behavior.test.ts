import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/leads/:id/history — pass-through to lead-service GET /orgs/leads/{id}/history.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes over
 * the wire: the downstream path, the identity headers, the query string and the body.
 * A source-substring test cannot see what a template literal interpolates, and cannot
 * see identity at all (CLAUDE.md rule #7, corollaries 2 and 3).
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

// A degraded answer: the mailbox could not be read, so `complete` is false and one
// source is `unavailable` — the distinction the whole endpoint exists to make.
const HISTORY_BODY = JSON.stringify({
  leadCampaignId: LEAD,
  leadId: "lead-1",
  campaignId: "campaign-1",
  brandId: BRAND,
  email: "someone@example.com",
  scope: "campaign",
  campaignIds: ["campaign-1"],
  campaignsTruncated: false,
  complete: false,
  sources: [
    { source: "outreach", status: "ok", reason: null },
    { source: "mailbox", status: "unavailable", reason: "gmail token expired" },
  ],
  events: [
    {
      id: "e1",
      at: "2026-09-01T10:00:00.000Z",
      type: "message",
      evidence: "observed",
      source: "outreach",
      campaignId: "campaign-1",
      direction: "inbound",
      bodyText: "not interested, thanks",
      bodyStatus: "ok",
      somethingBrandNew: 42,
    },
  ],
});

describe("GET /v1/leads/:id/history — per-lead history pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(HISTORY_BODY, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("forwards to lead-service GET /orgs/leads/{id}/history", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/history`);
    expect(res.status).toBe(200);

    const { url, init } = upstream();
    expect(url.endsWith(`/orgs/leads/${LEAD}/history`)).toBe(true);
    expect(url).not.toContain("/orgs/history");
    expect(url).not.toContain("?leadId=");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("returns the upstream body untouched, degradation and unknown fields intact", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/history`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(HISTORY_BODY));
    // "we could not read this" survives the hop and is not collapsed into an empty list.
    expect(res.body.complete).toBe(false);
    expect(res.body.sources).toContainEqual({
      source: "mailbox",
      status: "unavailable",
      reason: "gmail token expired",
    });
    expect(res.body.events[0].bodyText).toBe("not interested, thanks");
    // A field this gateway has never heard of survives too.
    expect(res.body.events[0].somethingBrandNew).toBe(42);
  });

  it("forwards the caller's query string verbatim, order and encoding intact", async () => {
    const query = `?scope=brand&brandId=${BRAND}&somethingBrandNew=slice-42&q=a%20b%2Bc`;
    await request(buildApp()).get(`/v1/leads/${LEAD}/history${query}`);
    expect(upstream().url.endsWith(`/orgs/leads/${LEAD}/history${query}`)).toBe(true);
  });

  it("does not judge a parameter it has never heard of — a filter shipped tomorrow reaches lead-service", async () => {
    await request(buildApp()).get(`/v1/leads/${LEAD}/history?sinceISO=2026-01-01&kinds=message,delivery`);
    const { url } = upstream();
    expect(url).toContain("sinceISO=2026-01-01");
    expect(url).toContain("kinds=message,delivery");
  });

  it("sends the AUTHENTICATED org, not one the caller named", async () => {
    await request(buildApp())
      .get(`/v1/leads/${LEAD}/history`)
      .set("x-org-id", "org_someone_else")
      .set("x-user-id", "user_someone_else");

    const { init } = upstream();
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
    expect(init.headers["x-user-id"]).toBe("user_test123");
  });

  it("cannot be pointed at another org through the query string either", async () => {
    await request(buildApp()).get(`/v1/leads/${LEAD}/history?orgId=org_someone_else`);
    const { url, init } = upstream();
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
    // The parameter still reaches lead-service verbatim — it just is not identity.
    expect(url).toContain("orgId=org_someone_else");
  });

  it("forwards a 404 with its upstream body field-for-field", async () => {
    global.fetch = vi.fn().mockImplementation(
      async () =>
        new Response('{"error":"Lead not found","code":"LEAD_NOT_FOUND"}', {
          status: 404,
          headers: { "content-type": "application/json" },
        })
    );

    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/history`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Lead not found", code: "LEAD_NOT_FOUND" });
  });

  it("forwards a 400 on a scope lead-service rejects rather than enumerating the vocabulary here", async () => {
    const upstreamCall = vi.fn().mockImplementation(
      async () =>
        new Response('{"error":"scope must be campaign | brand","code":"INVALID_SCOPE"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        })
    );
    global.fetch = upstreamCall;

    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/history?scope=galaxy`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "scope must be campaign | brand", code: "INVALID_SCOPE" });
    // The gateway did not refuse it itself — lead-service was asked and answered.
    expect(upstreamCall).toHaveBeenCalledTimes(1);
  });

  it("does not shadow the sibling lead routes", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    await request(buildApp()).get(`/v1/leads/${LEAD}`);
    await request(buildApp()).get(`/v1/leads/${LEAD}/step-statements`);
    await request(buildApp()).get(`/v1/leads/stats?brandId=${BRAND}`);

    expect(seen[0].endsWith(`/orgs/leads/${LEAD}`)).toBe(true);
    expect(seen[1].endsWith(`/orgs/leads/${LEAD}/step-statements`)).toBe(true);
    expect(seen[2].endsWith(`/orgs/stats?brandId=${BRAND}`)).toBe(true);
  });
});
