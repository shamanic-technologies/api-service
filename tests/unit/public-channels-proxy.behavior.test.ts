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
 * GET /v1/public/channels and GET /v1/public/channel-funnel-economics — the two
 * unauthenticated features-service reads the marketing site is generated from.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes
 * over the wire rather than what the source file says: the downstream path, the
 * caller's query string byte-for-byte, and the upstream body untouched. A
 * source-substring test cannot see a template literal's interpolated value at all,
 * and cannot see that the routes demand no identity (CLAUDE.md rule #7 corollaries
 * 2 and 3).
 *
 * The auth middleware is deliberately NOT mocked here: these routes must work for
 * an anonymous visitor, and mocking `authenticate` would hide a gate rather than
 * prove its absence.
 */

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const CATALOGUE_BODY = JSON.stringify({
  channels: [
    {
      slug: "sales-cold-email-outreach",
      name: "Cold email",
      family: "outbound_one_to_one",
      terms: { dailyOperatingCostCents: 1200, minimumCommitmentDays: 30, maxDaysToFirstProduction: 14 },
      producibleSteps: [{ key: "conversation", label: "Conversation", description: "A reply." }],
      salesFunnels: [{ key: "reply_to_sale", name: "Reply to sale", steps: ["conversation", "sale"] }],
      aFieldThisGatewayHasNeverHeardOf: 7,
    },
  ],
  producibleSteps: [{ key: "conversation", label: "Conversation", description: "A reply." }],
});

const ECONOMICS_BODY = JSON.stringify({
  channelSlug: null,
  pairs: [
    {
      channelSlug: "sales-cold-email-outreach",
      channelName: "Cold email",
      funnelKey: "reply_to_sale",
      funnelName: "Reply to sale",
      funnelSteps: ["conversation", "sale"],
      result: { measured: false, reason: "no_spend_recorded" },
    },
  ],
});

describe("public acquisition-channel reads — anonymous pass-through", () => {
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

  describe("GET /v1/public/channels", () => {
    it("forwards to features-service GET /public/channels with no identity demanded", async () => {
      stub(CATALOGUE_BODY);
      const res = await request(buildApp()).get("/v1/public/channels");

      expect(res.status).toBe(200);
      const { url, init } = upstream();
      expect(url).toBe(`${FEATURES_BASE}/public/channels`);
      expect(init.method ?? "GET").toBe("GET");
      // A visitor is anonymous: the gateway invents no org, user or run for them.
      expect(init.headers["x-org-id"]).toBeUndefined();
      expect(init.headers["x-user-id"]).toBeUndefined();
      expect(init.headers["x-run-id"]).toBeUndefined();
    });

    it("returns what features-service served, byte-equal", async () => {
      stub(CATALOGUE_BODY);
      const res = await request(buildApp()).get("/v1/public/channels");

      expect(res.body).toEqual(JSON.parse(CATALOGUE_BODY));
      expect(res.body.channels[0].aFieldThisGatewayHasNeverHeardOf).toBe(7);
    });

    it("forwards the caller's query string verbatim, order and encoding intact", async () => {
      stub(CATALOGUE_BODY);
      const query = "?family=paid_reach&somethingBrandNew=slice-42&q=a%20b%2Bc&ids=a&ids=b";
      await request(buildApp()).get(`/v1/public/channels${query}`);

      expect(upstream().url).toBe(`${FEATURES_BASE}/public/channels${query}`);
    });

    it("surfaces a downstream failure instead of degrading to an empty catalogue", async () => {
      stub('{"error":"features-service is having a bad day","code":"CHANNELS_UNAVAILABLE"}', 503);
      const res = await request(buildApp()).get("/v1/public/channels");

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: "features-service is having a bad day",
        code: "CHANNELS_UNAVAILABLE",
      });
      expect(res.body.channels).toBeUndefined();
    });
  });

  describe("GET /v1/public/channel-funnel-economics", () => {
    it("forwards to features-service GET /public/channel-funnel-economics with no identity demanded", async () => {
      stub(ECONOMICS_BODY);
      const res = await request(buildApp()).get("/v1/public/channel-funnel-economics");

      expect(res.status).toBe(200);
      const { url, init } = upstream();
      expect(url).toBe(`${FEATURES_BASE}/public/channel-funnel-economics`);
      expect(init.headers["x-org-id"]).toBeUndefined();
      expect(init.headers["x-user-id"]).toBeUndefined();
    });

    it("carries channelSlug through — the site's pages are parameterised by it", async () => {
      stub(ECONOMICS_BODY);
      const query = "?channelSlug=sales-cold-email-outreach&funnelKey=reply_to_sale";
      await request(buildApp()).get(`/v1/public/channel-funnel-economics${query}`);

      expect(upstream().url).toBe(`${FEATURES_BASE}/public/channel-funnel-economics${query}`);
    });

    it("returns the not-enough-data answer byte-equal rather than flattening it", async () => {
      stub(ECONOMICS_BODY);
      const res = await request(buildApp()).get("/v1/public/channel-funnel-economics");

      expect(res.body).toEqual(JSON.parse(ECONOMICS_BODY));
      expect(res.body.pairs[0].result).toEqual({ measured: false, reason: "no_spend_recorded" });
    });

    it("forwards an unknown-slug 404 with its upstream body field-for-field", async () => {
      stub('{"error":"Unknown channel slug","code":"CHANNEL_NOT_FOUND"}', 404);
      const res = await request(buildApp()).get("/v1/public/channel-funnel-economics?channelSlug=nope");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Unknown channel slug", code: "CHANNEL_NOT_FOUND" });
    });
  });

  it("leaves the ten public features reads on their own downstream paths", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const app = buildApp();
    await request(app).get("/v1/public/features");
    await request(app).get("/v1/public/features/ranked?featureSlug=x");
    await request(app).get("/v1/public/features/best?featureSlug=x");
    await request(app).get("/v1/public/features/revenue?featureSlug=x");
    await request(app).get("/v1/public/features/cost-projection?featureSlug=x");

    expect(seen[0]).toBe(`${FEATURES_BASE}/public/features`);
    expect(seen[1]).toContain("/public/stats/ranked?");
    expect(seen[2]).toContain("/public/stats/best?");
    expect(seen[3]).toContain("/public/stats/revenue?");
    expect(seen[4]).toContain("/public/stats/cost-projection?");
    expect(seen.some((u) => u.includes("/public/channels"))).toBe(false);
  });
});
