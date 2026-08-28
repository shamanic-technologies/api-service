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
 * GET /v1/offers/:offerId/funnels/:funnelKey/{revenue,audience-stats,pipeline-activity}
 * — BEHAVIOURAL cover of the grain UNDER the offer.
 *
 * Per CLAUDE.md #7 corollary 3 a source-substring test cannot see a template
 * literal's interpolated value, so it can verify neither the downstream path that
 * goes over the wire nor the identity carried with it. This file drives the real
 * router with supertest and a stubbed fetch.
 *
 * What a funnel's page depends on, asserted here:
 *  - each read reaches its OWN features-service path at the (offer x funnel) grain,
 *    with the funnel key on the PATH and not smuggled into the query;
 *  - the table read `/offers/:offerId/funnels` beside it still reaches its own path
 *    — three segments deeper is a different route, and neither shadows the other;
 *  - the query arrives byte-identical, including a param this gateway has never
 *    heard of — a dropped filter here returns a 200 about a different population;
 *  - features-service's named refusals (the unknown-key 400, the funnel_not_sold
 *    404 carrying soldFunnelKeys) reach the caller with their machine-readable
 *    fields intact, rather than a gateway-invented one;
 *  - the org reaching features-service is the AUTHENTICATED one, never a
 *    caller-supplied override.
 *
 * Per CLAUDE.md #6/#8 the payloads below are fixtures, not a contract this repo
 * owns — what is asserted is the forwarded URL and the byte-identical body.
 */

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";
const OFFER_ID = "d5ecba00-783a-4939-b5bd-f85b9e6b7d9e";
const FUNNEL_KEY = "self-serve";

// The legs of ONE funnel: two channels performing different steps of it. A funnel
// is carried by however many channels fund its legs, which is why the body must
// not be reshaped here.
const CHANNELS = [
  { featureSlug: "sales-cold-email-outreach", campaignIds: ["campaign-a"] },
  { featureSlug: "sales-linkedin-outreach", campaignIds: ["campaign-c"] },
];

const REVENUE_BODY = {
  offerId: OFFER_ID,
  funnelKey: FUNNEL_KEY,
  brandId: BRAND_ID,
  costBasis: "charged",
  channels: CHANNELS,
  priced: true,
  unpricedReason: null,
  costEconomics: { committedSpendUsd: 812.4, roiMultiple: 1.6, costPerAcquisitionUsd: 101.55 },
  spend: { bySource: [{ source: "instantly-email-sent", spendUsd: 812.4 }], todayUsd: 12.1 },
  roiHistory: [{ date: "2026-08-01", cumulativeSpendUsd: 400.0, cumulativePipelineUsd: 610.0 }],
};

const AUDIENCE_STATS_BODY = {
  offerId: OFFER_ID,
  funnelKey: FUNNEL_KEY,
  channels: CHANNELS,
  goal: null,
  sortMetric: "returnPerDollar",
  audiences: [],
  brandProjection: { lifetimeRevenueUsd: null, costPerPaidClientUsd: null, returnPerDollar: null, costOfAcquisitionPct: null },
};

const PIPELINE_ACTIVITY_BODY = {
  offerId: OFFER_ID,
  funnelKey: FUNNEL_KEY,
  channels: CHANNELS,
  timezone: "America/New_York",
  generatedAt: "2026-08-28T00:00:00.000Z",
  days: [],
  summary: { dailyBudgetUsd: null, openRatePct: null, clickToSignupPct: null, clickToFormSubmissionPct: null, undatedSignups: null, undatedFormSubmissions: null },
};

const READS = [
  { suffix: "revenue", body: REVENUE_BODY, query: `brandId=${BRAND_ID}` },
  { suffix: "audience-stats", body: AUDIENCE_STATS_BODY, query: `brandId=${BRAND_ID}` },
  { suffix: "pipeline-activity", body: PIPELINE_ACTIVITY_BODY, query: `brandId=${BRAND_ID}&timezone=America%2FNew_York` },
] as const;

describe("GET /v1/offers/:offerId/funnels/:funnelKey/* — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  function stubUpstream(body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(body) };
    });
  }

  beforeEach(() => {
    calls = [];
  });

  for (const { suffix, body, query } of READS) {
    describe(`/${suffix}`, () => {
      it("forwards to features-service's funnel-grain path, carrying the resolved identity", async () => {
        stubUpstream(body);

        const res = await request(buildApp()).get(
          `/v1/offers/${OFFER_ID}/funnels/${FUNNEL_KEY}/${suffix}?${query}`,
        );

        expect(res.status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(
          `${FEATURES_BASE}/offers/${OFFER_ID}/funnels/${FUNNEL_KEY}/${suffix}?${query}`,
        );
        expect(calls[0].options.method).toBe("GET");
        expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
        expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
        expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
        expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
      });

      it("returns features-service's body unchanged, per-channel legs included", async () => {
        stubUpstream(body);

        const res = await request(buildApp()).get(
          `/v1/offers/${OFFER_ID}/funnels/${FUNNEL_KEY}/${suffix}?${query}`,
        );

        expect(res.status).toBe(200);
        expect(res.body).toEqual(body);
        expect(res.body.channels).toHaveLength(2);
      });

      it("forwards every query param verbatim — no whitelist, nothing narrowed", async () => {
        stubUpstream(body);

        await request(buildApp()).get(
          `/v1/offers/${OFFER_ID}/funnels/${FUNNEL_KEY}/${suffix}?${query}&pricing=net&goal=signup&statuses=active%2Cpaused&limit=3&days=30&somethingFeaturesShipsNext=42`,
        );

        const forwarded = new URL(calls[0].url).searchParams;
        expect(forwarded.get("brandId")).toBe(BRAND_ID);
        expect(forwarded.get("pricing")).toBe("net");
        expect(forwarded.get("goal")).toBe("signup");
        expect(forwarded.get("statuses")).toBe("active,paused");
        expect(forwarded.get("limit")).toBe("3");
        expect(forwarded.get("days")).toBe("30");
        expect(forwarded.get("somethingFeaturesShipsNext")).toBe("42");
      });

      it("ignores a caller-supplied org — only the authenticated org reaches features-service", async () => {
        stubUpstream(body);

        const res = await request(buildApp())
          .get(`/v1/offers/${OFFER_ID}/funnels/${FUNNEL_KEY}/${suffix}?${query}`)
          .set("x-org-id", "someone-elses-org");

        expect(res.status).toBe(200);
        expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
      });

      it("propagates features-service's unknown-funnel 400 with its body intact", async () => {
        global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
          calls.push({ url, options });
          return {
            ok: false,
            status: 400,
            text: () =>
              Promise.resolve(
                JSON.stringify({ error: "funnelKey must be one of: self-serve, sales-led" }),
              ),
            json: () => Promise.resolve({}),
          };
        });

        const res = await request(buildApp()).get(
          `/v1/offers/${OFFER_ID}/funnels/not-a-funnel/${suffix}?${query}`,
        );

        // The gateway declares no funnel vocabulary of its own — the refusal is
        // features-service's, verbatim (CLAUDE.md #7 + the request-passthrough rule).
        expect(calls[0].url).toBe(
          `${FEATURES_BASE}/offers/${OFFER_ID}/funnels/not-a-funnel/${suffix}?${query}`,
        );
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "funnelKey must be one of: self-serve, sales-led" });
      });

      it("propagates the named funnel_not_sold 404 with soldFunnelKeys intact", async () => {
        global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
          calls.push({ url, options });
          return {
            ok: false,
            status: 404,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  error: `no campaign of offer ${OFFER_ID} sells through the sales funnel ${FUNNEL_KEY}`,
                  reason: "funnel_not_sold",
                  offerId: OFFER_ID,
                  funnelKey: FUNNEL_KEY,
                  soldFunnelKeys: ["sales-led"],
                }),
              ),
            json: () => Promise.resolve({}),
          };
        });

        const res = await request(buildApp()).get(
          `/v1/offers/${OFFER_ID}/funnels/${FUNNEL_KEY}/${suffix}?${query}`,
        );

        // Not flattened into { error: "<the whole JSON body>" } — a consumer can
        // send the reader to a funnel that exists because `soldFunnelKeys` survived.
        expect(res.status).toBe(404);
        expect(res.body.reason).toBe("funnel_not_sold");
        expect(res.body.soldFunnelKeys).toEqual(["sales-led"]);
      });
    });
  }

  it("keeps the caller's repeated keys and ordering byte-identical", async () => {
    stubUpstream(REVENUE_BODY);

    await request(buildApp()).get(
      `/v1/offers/${OFFER_ID}/funnels/${FUNNEL_KEY}/revenue?pricing=net&brandId=${BRAND_ID}&channel=a&channel=b`,
    );

    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/offers/${OFFER_ID}/funnels/${FUNNEL_KEY}/revenue?pricing=net&brandId=${BRAND_ID}&channel=a&channel=b`,
    );
  });

  it("encodes the offer id and the funnel key into the downstream path", async () => {
    stubUpstream(REVENUE_BODY);

    await request(buildApp()).get(`/v1/offers/a%2Fb/funnels/c%2Fd/revenue?brandId=${BRAND_ID}`);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/offers/a%2Fb/funnels/c%2Fd/revenue?brandId=${BRAND_ID}`);
  });

  it("does not shadow the offer's funnel TABLE read one segment up", async () => {
    stubUpstream({ offerId: OFFER_ID, funnels: [] });

    await request(buildApp()).get(`/v1/offers/${OFFER_ID}/funnels?brandId=${BRAND_ID}`);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/offers/${OFFER_ID}/funnels?brandId=${BRAND_ID}`);
  });

  it("leaves the offer grain beside it untouched", async () => {
    stubUpstream(REVENUE_BODY);

    await request(buildApp()).get(`/v1/offers/${OFFER_ID}/revenue?brandId=${BRAND_ID}`);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/offers/${OFFER_ID}/revenue?brandId=${BRAND_ID}`);
  });

  it("leaves the brand grain untouched", async () => {
    stubUpstream({ brandId: BRAND_ID });

    await request(buildApp()).get(`/v1/brands/${BRAND_ID}/revenue?pricing=net`);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/brands/${BRAND_ID}/revenue?pricing=net`);
  });
});
