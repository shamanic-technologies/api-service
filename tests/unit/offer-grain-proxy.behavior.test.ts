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
 * GET /v1/offers/:offerId/{revenue,audience-stats,pipeline-activity,chains} — BEHAVIOURAL cover.
 *
 * Per CLAUDE.md #7 corollary 3, a source-substring test cannot see a template
 * literal's interpolated value, so it can verify neither the downstream path that
 * goes over the wire nor the identity carried with it. This file drives the real
 * router with supertest and a stubbed fetch.
 *
 * What the offer screen depends on, asserted here:
 *  - each read reaches its OWN features-service path at the offer grain;
 *  - the query arrives byte-identical, including a param this gateway has never
 *    heard of — a dropped filter here returns a 200 about a different population
 *    (the `pricing` / `funnel` failure this file's siblings were cleaned of);
 *  - the response passes through unchanged, per-channel breakdown included;
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

// Two channels funding one offer — the breakdown a per-feature read cannot give.
const CHANNELS = [
  { featureSlug: "sales-cold-email-outreach", campaignIds: ["campaign-a", "campaign-b"] },
  { featureSlug: "sales-linkedin-outreach", campaignIds: ["campaign-c"] },
];

const REVENUE_BODY = {
  offerId: OFFER_ID,
  brandId: BRAND_ID,
  featureSlug: "sales-cold-email-outreach,sales-linkedin-outreach",
  costEconomics: { committedSpendUsd: 2518.92, roiMultiple: 1.8 },
  channels: [
    { ...CHANNELS[0], costEconomics: { committedSpendUsd: 2411.42 } },
    { ...CHANNELS[1], costEconomics: { committedSpendUsd: 107.5 } },
  ],
};

const AUDIENCE_STATS_BODY = {
  offerId: OFFER_ID,
  brandId: BRAND_ID,
  featureSlug: "sales-cold-email-outreach,sales-linkedin-outreach",
  goal: null,
  sortMetric: "returnPerDollar",
  audiences: [],
  brandProjection: { lifetimeRevenueUsd: null, costPerPaidClientUsd: null, returnPerDollar: null, costOfAcquisitionPct: null },
  channels: CHANNELS,
};

const PIPELINE_ACTIVITY_BODY = {
  offerId: OFFER_ID,
  brandId: BRAND_ID,
  featureSlug: "sales-cold-email-outreach,sales-linkedin-outreach",
  timezone: "America/New_York",
  generatedAt: "2026-08-20T00:00:00.000Z",
  days: [],
  summary: { dailyBudgetUsd: null, openRatePct: null, clickToSignupPct: null, clickToFormSubmissionPct: null, undatedSignups: null, undatedFormSubmissions: null },
  channels: CHANNELS,
};

// The (offer x sales chain) grain: one row per chain, each carrying its own
// channels. The per-channel breakdown sits one level deeper than on the three
// reads above, which is exactly why the body must not be reshaped here.
const CHAINS_BODY = {
  offerId: OFFER_ID,
  brandId: BRAND_ID,
  costBasis: "charged",
  costCoverage: "platform_spend_only",
  chains: [
    {
      funnelKey: "self-serve",
      name: "Self-serve",
      steps: ["contacted", "clicked", "signed_up"],
      campaignIds: ["campaign-a", "campaign-b", "campaign-c"],
      channels: CHANNELS,
      priced: true,
      unpricedReason: null,
      headline: { totalPipelineUsd: 4534.05, economicsSource: "sales-economics" },
      costEconomics: {
        committedCostUsd: 2518.92,
        actualCostUsd: 2411.42,
        costOfAcquisitionPct: 55.55,
        roiMultiple: 1.8,
        costPerAcquisitionUsd: 111.06,
      },
      outcomes: {
        recipientsContacted: 812,
        recipientsClicked: 47,
        recipientsRepliesPositive: 9,
        committedSpentCents: 251892,
        actualSpentCents: 241142,
        cpcCents: 5359,
        cpprCents: 27988,
      },
    },
  ],
  unattributedCampaignIds: ["campaign-d"],
};

const READS = [
  { suffix: "revenue", body: REVENUE_BODY, query: `brandId=${BRAND_ID}`, channelsOf: (b: any) => b.channels },
  { suffix: "audience-stats", body: AUDIENCE_STATS_BODY, query: `brandId=${BRAND_ID}`, channelsOf: (b: any) => b.channels },
  { suffix: "pipeline-activity", body: PIPELINE_ACTIVITY_BODY, query: `brandId=${BRAND_ID}&timezone=America%2FNew_York`, channelsOf: (b: any) => b.channels },
  { suffix: "chains", body: CHAINS_BODY, query: `brandId=${BRAND_ID}`, channelsOf: (b: any) => b.chains[0].channels },
] as const;

describe("GET /v1/offers/:offerId/* — over the wire", () => {
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

  for (const { suffix, body, query, channelsOf } of READS) {
    describe(`/${suffix}`, () => {
      it("forwards to features-service's offer-grain path, carrying the resolved identity", async () => {
        stubUpstream(body);

        const res = await request(buildApp()).get(`/v1/offers/${OFFER_ID}/${suffix}?${query}`);

        expect(res.status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(`${FEATURES_BASE}/offers/${OFFER_ID}/${suffix}?${query}`);
        expect(calls[0].options.method).toBe("GET");
        expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
        expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
        expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
        expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
      });

      it("returns features-service's body unchanged, per-channel breakdown included", async () => {
        stubUpstream(body);

        const res = await request(buildApp()).get(`/v1/offers/${OFFER_ID}/${suffix}?${query}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual(body);
        expect(channelsOf(res.body)).toHaveLength(2);
      });

      it("forwards every query param verbatim — no whitelist, nothing narrowed", async () => {
        stubUpstream(body);

        await request(buildApp()).get(
          `/v1/offers/${OFFER_ID}/${suffix}?${query}&pricing=net&funnel=self-serve&goal=signup&statuses=active%2Cpaused&limit=3&days=30&somethingFeaturesShipsNext=42`,
        );

        const forwarded = new URL(calls[0].url).searchParams;
        expect(forwarded.get("brandId")).toBe(BRAND_ID);
        expect(forwarded.get("pricing")).toBe("net");
        expect(forwarded.get("funnel")).toBe("self-serve");
        expect(forwarded.get("goal")).toBe("signup");
        expect(forwarded.get("statuses")).toBe("active,paused");
        expect(forwarded.get("limit")).toBe("3");
        expect(forwarded.get("days")).toBe("30");
        expect(forwarded.get("somethingFeaturesShipsNext")).toBe("42");
      });

      it("ignores a caller-supplied org — only the authenticated org reaches features-service", async () => {
        stubUpstream(body);

        const res = await request(buildApp())
          .get(`/v1/offers/${OFFER_ID}/${suffix}?${query}`)
          .set("x-org-id", "someone-elses-org");

        expect(res.status).toBe(200);
        expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
      });

      it("propagates an upstream 400 with its body intact rather than a generic 500", async () => {
        global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
          calls.push({ url, options });
          return {
            ok: false,
            status: 400,
            text: () =>
              Promise.resolve(JSON.stringify({ error: "brandId is required", code: "MISSING_BRAND_ID" })),
            json: () => Promise.resolve({}),
          };
        });

        const res = await request(buildApp()).get(`/v1/offers/${OFFER_ID}/${suffix}`);

        // Not flattened into { error: "<the whole JSON body>" } — `code` survives the
        // hop so a consumer can branch on the reason (CLAUDE.md #7).
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "brandId is required", code: "MISSING_BRAND_ID" });
      });
    });
  }

  it("keeps the caller's repeated keys and ordering byte-identical", async () => {
    stubUpstream(REVENUE_BODY);

    await request(buildApp()).get(
      `/v1/offers/${OFFER_ID}/revenue?pricing=net&brandId=${BRAND_ID}&channel=a&channel=b`,
    );

    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/offers/${OFFER_ID}/revenue?pricing=net&brandId=${BRAND_ID}&channel=a&channel=b`,
    );
  });

  it("encodes the offer id into the downstream path", async () => {
    stubUpstream(REVENUE_BODY);

    await request(buildApp()).get(`/v1/offers/a%2Fb/revenue?brandId=${BRAND_ID}`);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/offers/a%2Fb/revenue?brandId=${BRAND_ID}`);
  });

  it("does not touch the per-feature reads beside it", async () => {
    stubUpstream(REVENUE_BODY);

    await request(buildApp()).get(
      `/v1/features/sales-cold-email-outreach/revenue?brandId=${BRAND_ID}&offerId=${OFFER_ID}`,
    );

    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/features/sales-cold-email-outreach/revenue?brandId=${BRAND_ID}&offerId=${OFFER_ID}`,
    );
  });
});
