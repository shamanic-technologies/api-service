import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/campaigns/:id/sourcing-stats — pass-through to lead-service
 * GET /orgs/campaigns/{campaignId}/sourcing-stats.
 *
 * Driven through the real router with a stubbed `fetch`: asserts the downstream path,
 * the identity headers, and that status + body cross the hop untouched.
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

import campaignsRouter from "../../src/routes/campaigns.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignsRouter);
  return app;
}

const CAMPAIGN = "905216c3-5ee5-445d-8f88-38fa766f4de8";
const BODY = JSON.stringify({
  found: { people: 12, companies: 4 },
  kept: { people: 3 },
  daily: [{ day: "2026-10-10", found: 12 }],
  unknownDownstreamField: 7,
});

describe("GET /v1/campaigns/:id/sourcing-stats — pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  function stub(status: number, body: string) {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
  }

  beforeEach(() => stub(200, BODY));

  it("forwards to the exact lead-service path, not the aggregated campaign stats", async () => {
    const res = await request(buildApp()).get(`/v1/campaigns/${CAMPAIGN}/sourcing-stats`);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe(`/orgs/campaigns/${CAMPAIGN}/sourcing-stats`);
    expect(calls[0].url).not.toContain("/orgs/stats");
  });

  it("returns the upstream body byte-identical", async () => {
    const res = await request(buildApp()).get(`/v1/campaigns/${CAMPAIGN}/sourcing-stats`);
    expect(res.body).toEqual(JSON.parse(BODY));
  });

  it("forwards the query string verbatim", async () => {
    const q = "?somethingNew=a%20b&x=1&x=2";
    await request(buildApp()).get(`/v1/campaigns/${CAMPAIGN}/sourcing-stats${q}`);
    expect(calls[0].url.endsWith(`/orgs/campaigns/${CAMPAIGN}/sourcing-stats${q}`)).toBe(true);
  });

  it("sends the AUTHENTICATED org, not one the caller named", async () => {
    await request(buildApp())
      .get(`/v1/campaigns/${CAMPAIGN}/sourcing-stats`)
      .set("x-org-id", "org_someone_else");
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[0].init.headers["x-user-id"]).toBe("user_test123");
  });

  it.each([404, 409, 502])("forwards a %i with its upstream body field-for-field", async (status) => {
    const body = { error: "refused", code: `CODE_${status}` };
    stub(status, JSON.stringify(body));
    const res = await request(buildApp()).get(`/v1/campaigns/${CAMPAIGN}/sourcing-stats`);
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
  });

  it("is not swallowed by /campaigns/:id", async () => {
    await request(buildApp()).get(`/v1/campaigns/${CAMPAIGN}/sourcing-stats`);
    expect(calls.every((c) => c.url.includes("/sourcing-stats"))).toBe(true);
  });
});
