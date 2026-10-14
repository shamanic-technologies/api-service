import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/campaigns/:campaignId/leads/by-lead/:leadId — pass-through to lead-service
 * GET /orgs/campaigns/{campaignId}/leads/by-lead/{leadId} (one person's lead on one campaign).
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes
 * over the wire: the downstream path, the identity headers, the query string and the
 * body. A source-substring test cannot see what a template literal interpolates, and
 * cannot see identity at all (CLAUDE.md rule #7, corollaries 2 and 3).
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
const CAMPAIGN = "33333333-3333-3333-3333-333333333333";

const PATH = `/v1/campaigns/${CAMPAIGN}/leads/by-lead/${LEAD}`;
const UPSTREAM = `/orgs/campaigns/${CAMPAIGN}/leads/by-lead/${LEAD}`;
const DETAIL_BODY = JSON.stringify({ leadDetail: { id: "row-1", leadId: LEAD, unknownDownstreamField: 7 } });

function reply(status: number, body: string) {
  return vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
}

let calls: Array<{ url: string; init: any }>;

describe("GET /v1/campaigns/:campaignId/leads/by-lead/:leadId", () => {
  beforeEach(() => {
    calls = [];
    global.fetch = reply(200, DETAIL_BODY);
  });

  it("forwards to the full lead-service path literal, GET", async () => {
    const res = await request(buildApp()).get(PATH);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith(UPSTREAM)).toBe(true);
    expect(calls[0].init.method ?? "GET").toBe("GET");
  });

  it("returns the upstream body untouched", async () => {
    const res = await request(buildApp()).get(PATH);
    expect(res.body).toEqual(JSON.parse(DETAIL_BODY));
  });

  it("forwards the query string verbatim", async () => {
    const query = `?brandId=${BRAND}&include=campaigns&brandNew=x%20y`;
    await request(buildApp()).get(`${PATH}${query}`);
    expect(calls[0].url.endsWith(`${UPSTREAM}${query}`)).toBe(true);
  });

  it("sends the AUTHENTICATED org and user, not ones the caller named", async () => {
    await request(buildApp()).get(PATH).set("x-org-id", "org_other").set("x-user-id", "user_other");
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[0].init.headers["x-user-id"]).toBe("user_test123");
  });

  it("relays a 404 lead_not_on_campaign field-for-field", async () => {
    const body = '{"error":"This person is not a lead of this campaign in this org","code":"lead_not_on_campaign"}';
    global.fetch = reply(404, body);
    const res = await request(buildApp()).get(PATH);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(JSON.parse(body));
  });

  it("relays a 400 from lead-service rather than judging the id here", async () => {
    global.fetch = reply(400, '{"error":"leadId must be a person\'s lead id, a uuid"}');
    const res = await request(buildApp()).get(`/v1/campaigns/${CAMPAIGN}/leads/by-lead/not-a-uuid`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("uuid");
    expect(calls[0].url.endsWith(`/orgs/campaigns/${CAMPAIGN}/leads/by-lead/not-a-uuid`)).toBe(true);
  });
});
