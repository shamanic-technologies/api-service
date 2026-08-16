import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/leads forwards the caller's query string to lead-service verbatim.
 *
 * The route used to read a fixed set of parameters off `req.query` and rebuild the
 * upstream query string from that set, so anything else the caller sent was dropped
 * silently — a 200 carrying the un-narrowed population, with no way for the caller to
 * tell the parameter was ignored. A parameter this gateway has never heard of must
 * reach lead-service unchanged (CLAUDE.md rule #8 corollary: the request is a
 * passthrough too).
 *
 * These tests drive the real router with a stubbed `fetch` and assert on the URL that
 * goes over the wire — a source-substring test cannot see what a template literal
 * interpolates.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
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

const BRAND = "11111111-1111-1111-1111-111111111111";

describe("GET /v1/leads — query passthrough", () => {
  let capturedUrls: string[];

  beforeEach(() => {
    capturedUrls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrls.push(url);
      return new Response('{"leads":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });

  function upstream(): string {
    const url = capturedUrls.find((u) => u.includes("/orgs/leads"));
    expect(url).toBeDefined();
    return url as string;
  }

  it("forwards a parameter api-service has never heard of, unchanged", async () => {
    const res = await request(buildApp()).get(
      `/v1/leads?brandId=${BRAND}&somethingBrandNew=slice-42`
    );
    expect(res.status).toBe(200);
    expect(upstream()).toContain("somethingBrandNew=slice-42");
  });

  it("forwards the query string byte-identical, including order and encoding", async () => {
    const query = `?brandId=${BRAND}&view=basic&limit=25&offset=50&replyClassification=positive&q=a%20b%2Bc`;
    await request(buildApp()).get(`/v1/leads${query}`);
    expect(upstream().endsWith(`/orgs/leads${query}`)).toBe(true);
  });

  it("keeps repeated keys instead of collapsing them to one value", async () => {
    await request(buildApp()).get(
      `/v1/leads?brandId=${BRAND}&status=active&status=paused`
    );
    const url = upstream();
    expect(url).toContain("status=active");
    expect(url).toContain("status=paused");
  });

  it("still forwards the previously whitelisted parameters", async () => {
    await request(buildApp()).get(
      `/v1/leads?campaignId=${BRAND}&limit=10&offset=5&view=basic`
    );
    const url = upstream();
    expect(url).toContain(`campaignId=${BRAND}`);
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=5");
    expect(url).toContain("view=basic");
  });

  it("400s when neither brandId nor campaignId is present, without calling lead-service", async () => {
    const res = await request(buildApp()).get("/v1/leads?somethingBrandNew=slice-42");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Missing required query parameter: brandId or campaignId",
    });
    expect(capturedUrls).toHaveLength(0);
  });

  it("forwards the upstream body untouched", async () => {
    const body = '{"leads":[{"id":"row-1","unknownDownstreamField":7}],"nextCursor":"abc"}';
    global.fetch = vi.fn().mockImplementation(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const res = await request(buildApp()).get(`/v1/leads?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe(body);
  });
});
