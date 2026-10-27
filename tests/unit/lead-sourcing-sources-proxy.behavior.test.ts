import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/orgs/lead-sourcing/sources → human-service GET /orgs/lead-sourcing/sources.
 * Drives the real router with a stubbed fetch: full downstream path with the raw
 * query verbatim, the AUTHENTICATED org forwarded (a caller-sent x-org-id does not
 * win), and status + body piped byte-identical on success and on the producer's 400.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "user_key";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import leadSourcingRouter from "../../src/routes/lead-sourcing.js";

const HUMAN_BASE = "http://human.test.local";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", leadSourcingRouter);
  return app;
}

describe("GET /v1/orgs/lead-sourcing/sources → human-service", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    process.env.HUMAN_SERVICE_URL = HUMAN_BASE;
    process.env.HUMAN_SERVICE_API_KEY = "human-test-key";
    calls = [];
  });

  afterEach(() => {
    delete process.env.HUMAN_SERVICE_URL;
    delete process.env.HUMAN_SERVICE_API_KEY;
  });

  function stubFetch(status: number, body: unknown) {
    const text = JSON.stringify(body);
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return new Response(text, { status, headers: { "content-type": "application/json" } });
    });
  }

  it("forwards path + raw query + authenticated org, pipes the answer byte-identical", async () => {
    const upstream = {
      brandId: "brand-1",
      offerId: "offer-1",
      leadSourcingOn: true,
      decided: true,
      basis: "roi",
      chosenOriginSlugs: ["apollo-cold-filters"],
      universeOriginSlugs: ["apollo-cold-filters", "linkedin-engagement"],
      sources: [
        { originSlug: "apollo-cold-filters", chosen: true, reason: "best_cost_per_positive_reply", evidence: null, bestCostPerPositiveReplyUsd: 12.5 },
      ],
      decidedAt: "2026-10-28T00:00:00.000Z",
      evidenceAt: null,
    };
    stubFetch(200, upstream);

    const res = await request(buildApp())
      .get("/v1/orgs/lead-sourcing/sources?brandId=brand-1&offerId=offer-1")
      .set("x-org-id", "org_attacker");

    expect(res.status).toBe(200);
    expect(res.text).toBe(JSON.stringify(upstream));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/lead-sourcing/sources?brandId=brand-1&offerId=offer-1`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["X-API-Key"]).toBe("human-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("forwards the producer's 400 with its body", async () => {
    const upstream = { error: "offerId: Required" };
    stubFetch(400, upstream);
    const res = await request(buildApp()).get("/v1/orgs/lead-sourcing/sources?brandId=brand-1");
    expect(res.status).toBe(400);
    expect(res.body).toEqual(upstream);
  });
});
