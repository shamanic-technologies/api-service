import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { FEATURES_BASE };
});

/**
 * GET /v1/public/features/funnel-return-on-spend — what a dollar through one SALES FUNNEL
 * came back as for our clients, per (acquisition channel x sales funnel), read with no
 * identity of any kind.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes over the
 * wire: the downstream path, the caller's query string byte-for-byte, and the producer's body
 * untouched. `authenticate` is deliberately NOT mocked — the route must answer an anonymous
 * visitor, and a mock would hide a gate rather than prove its absence (CLAUDE.md rule #3 and
 * rule #7 corollary 3).
 */

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const MIXED_BODY = JSON.stringify({
  costBasis: "charged",
  unit: "brand",
  channelSlug: null,
  minSpendUsd: 100,
  pairs: [
    {
      channelSlug: "sales-cold-email-outreach",
      channelName: "Cold Email",
      funnelKey: "sales_meetings_from_conversation",
      funnelName: "Sales meetings from a conversation",
      funnelSteps: ["Positive reply", "Meeting booked", "Paid client"],
      measured: true,
      reason: null,
      minSpendUsd: 100,
      brandCount: 4,
      medianReturnPerDollar: 1.9,
      p25ReturnPerDollar: 1.35,
      p75ReturnPerDollar: 2.05,
      minReturnPerDollar: 0.02,
      maxReturnPerDollar: 2.2,
      medianCostPerPaidClientUsd: 412.5,
      costPerPaidClientBrandCount: 3,
      computedAt: "2026-09-08T09:00:00.000Z",
      aFieldThisGatewayHasNeverHeardOf: 7,
    },
    {
      channelSlug: "sales-cold-email-outreach",
      channelName: "Cold Email",
      funnelKey: "sales_meetings_from_website",
      funnelName: "Sales meetings from the website",
      funnelSteps: ["Website visit", "Meeting booked", "Paid client"],
      measured: false,
      reason: "not_enough_brands",
      minSpendUsd: 100,
      brandCount: 1,
      medianReturnPerDollar: null,
      medianCostPerPaidClientUsd: null,
      costPerPaidClientBrandCount: 1,
      computedAt: "2026-09-08T09:00:00.000Z",
    },
  ],
});

describe("GET /v1/public/features/funnel-return-on-spend — anonymous pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  function stub(body: string, status = 200) {
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
  }

  beforeEach(() => {
    calls = [];
  });

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("forwards to features-service GET /public/stats/funnel-return-on-spend with no identity demanded", async () => {
    stub(MIXED_BODY);
    const res = await request(buildApp()).get("/v1/public/features/funnel-return-on-spend");

    expect(res.status).toBe(200);
    const { url, init } = upstream();
    expect(url).toBe(`${FEATURES_BASE}/public/stats/funnel-return-on-spend`);
    expect(init.method ?? "GET").toBe("GET");
    // The consumer is anonymous: the gateway invents no org, user or run.
    expect(init.headers["x-org-id"]).toBeUndefined();
    expect(init.headers["x-user-id"]).toBeUndefined();
    expect(init.headers["x-run-id"]).toBeUndefined();
  });

  it("carries the population-selecting query string through verbatim", async () => {
    stub(MIXED_BODY);
    const query = "?channelSlug=sales-cold-email-outreach&minSpendUsd=250&somethingBrandNew=x%20y&ids=a&ids=b";
    await request(buildApp()).get(`/v1/public/features/funnel-return-on-spend${query}`);

    expect(upstream().url).toBe(`${FEATURES_BASE}/public/stats/funnel-return-on-spend${query}`);
  });

  it("returns the producer's pairs field-for-field, measured and unmeasured alike", async () => {
    stub(MIXED_BODY);
    const res = await request(buildApp()).get("/v1/public/features/funnel-return-on-spend?minSpendUsd=100");

    expect(res.body).toEqual(JSON.parse(MIXED_BODY));
    // A pair that could not be stated is FORWARDED rather than dropped — dropping it would read
    // as "this channel does not sell this funnel", which is a different statement.
    expect(res.body.pairs).toHaveLength(2);
    expect(res.body.pairs[0].medianReturnPerDollar).toBe(1.9);
    expect(res.body.pairs[0].medianCostPerPaidClientUsd).toBe(412.5);
    expect(res.body.pairs[0].aFieldThisGatewayHasNeverHeardOf).toBe(7);
    expect(res.body.pairs[1].reason).toBe("not_enough_brands");
    expect(res.body.pairs[1].brandCount).toBe(1);
  });

  it("forwards an upstream 400 and an upstream 404 with their bodies field-for-field", async () => {
    stub('{"error":"Query parameter \'minSpendUsd\' must be a number >= 0"}', 400);
    const bad = await request(buildApp()).get("/v1/public/features/funnel-return-on-spend?minSpendUsd=-1");
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "Query parameter 'minSpendUsd' must be a number >= 0" });

    calls = [];
    stub('{"error":"Acquisition channel not found: \\"nope\\""}', 404);
    const missing = await request(buildApp()).get("/v1/public/features/funnel-return-on-spend?channelSlug=nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toContain("nope");
  });

  it("leaves the sibling public reads on their OWN downstream paths", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const app = buildApp();
    // The channel-wide median and the per-pair PROJECTION both stay exactly where they were: this
    // read is beside them, never instead of either.
    await request(app).get("/v1/public/features/return-on-spend?featureSlug=x");
    await request(app).get("/v1/public/channel-funnel-economics");

    expect(seen[0]).toContain("/public/stats/return-on-spend");
    expect(seen[0]).not.toContain("funnel-return-on-spend");
    expect(seen[1]).toContain("/public/channel-funnel-economics");
  });
});
