import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/leads/:id — pass-through to lead-service GET /orgs/leads/{id}.
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

const DETAIL_BODY = JSON.stringify({
  leadDetail: {
    id: LEAD,
    email: "someone@example.com",
    lead: { firstName: "Ada", employmentHistory: [{ title: "CTO" }] },
    audience: { id: "aud-1", name: "Founders", avatarUrl: null },
    contacted: true,
    unknownDownstreamField: 7,
  },
});

describe("GET /v1/leads/:id — single lead pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(DETAIL_BODY, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("forwards to lead-service GET /orgs/leads/{id}, not a list query", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}`);
    expect(res.status).toBe(200);

    const { url, init } = upstream();
    expect(url.endsWith(`/orgs/leads/${LEAD}`)).toBe(true);
    expect(url).not.toContain("?id=");
    expect(url).not.toContain("/orgs/leads?");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("returns the upstream record untouched, one record and not a list", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(DETAIL_BODY));
    expect(Array.isArray(res.body.leadDetail)).toBe(false);
    // A field this gateway has never heard of survives the hop.
    expect(res.body.leadDetail.unknownDownstreamField).toBe(7);
  });

  it("forwards the caller's query string verbatim, order and encoding intact", async () => {
    const query = `?brandId=${BRAND}&campaignId=${CAMPAIGN}&somethingBrandNew=slice-42&q=a%20b%2Bc`;
    await request(buildApp()).get(`/v1/leads/${LEAD}${query}`);
    expect(upstream().url.endsWith(`/orgs/leads/${LEAD}${query}`)).toBe(true);
  });

  it("sends the AUTHENTICATED org, not one the caller named", async () => {
    await request(buildApp())
      .get(`/v1/leads/${LEAD}?brandId=${BRAND}`)
      .set("x-org-id", "org_someone_else")
      .set("x-user-id", "user_someone_else");

    const { init } = upstream();
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
    expect(init.headers["x-user-id"]).toBe("user_test123");
  });

  it("cannot be pointed at another org through the query string either", async () => {
    await request(buildApp()).get(`/v1/leads/${LEAD}?orgId=org_someone_else&brandId=${BRAND}`);
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

    const res = await request(buildApp()).get(`/v1/leads/${LEAD}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Lead not found", code: "LEAD_NOT_FOUND" });
  });

  it("forwards a 400 on a non-uuid id from lead-service rather than judging it here", async () => {
    global.fetch = vi.fn().mockImplementation(
      async () =>
        new Response('{"error":"id must be a uuid"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        })
    );

    const res = await request(buildApp()).get("/v1/leads/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "id must be a uuid" });
  });

  it("does not shadow GET /v1/leads/stats — a literal segment is not a lead id", async () => {
    const statsCalls: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      statsCalls.push(url);
      return new Response('{"totalLeads":3}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await request(buildApp()).get(`/v1/leads/stats?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(statsCalls[0].endsWith(`/orgs/stats?brandId=${BRAND}`)).toBe(true);
    expect(statsCalls[0]).not.toContain("/orgs/leads/stats");
  });

  it("does not shadow GET /v1/leads — the list route still lists", async () => {
    const listCalls: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      listCalls.push(url);
      return new Response('{"leads":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await request(buildApp()).get(`/v1/leads?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(listCalls[0].endsWith(`/orgs/leads?brandId=${BRAND}`)).toBe(true);
  });
});
