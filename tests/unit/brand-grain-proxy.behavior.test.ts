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
 * GET /v1/brands/:brandId/{revenue,audience-stats,pipeline-activity,conversion-rates,contacted-value,deals-value,lived-sales-paths,spend-charts,outcome-cost-series,campaign-revenue,companies} — BEHAVIOURAL cover.
 *
 * The offer-grain sibling's reasoning applies verbatim (see
 * offer-grain-proxy.behavior.test.ts): a source-substring test cannot see a template
 * literal's interpolated value, so it can verify neither the downstream path nor the
 * identity carried with it. This drives the real router with supertest and a stubbed
 * fetch.
 *
 * What the brand screen depends on, asserted here:
 *  - each read reaches its OWN features-service path at the BRAND grain — not the
 *    per-feature path it used to, which answered for one channel;
 *  - the query arrives byte-identical, including a param this gateway has never heard
 *    of — a dropped filter returns a 200 about a different population, which is the
 *    `pricing` / `funnel` failure this file's siblings were cleaned of;
 *  - the response passes through unchanged, per-channel breakdown included;
 *  - the org reaching features-service is the AUTHENTICATED one, never a
 *    caller-supplied override;
 *  - the brand id is taken from the PATH, so a caller cannot read another brand by
 *    smuggling one in the query.
 *
 * Per CLAUDE.md #6/#8 the payloads are fixtures, not a contract this repo owns —
 * what is asserted is the forwarded URL and the byte-identical body.
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

// The two channels the live brand runs — the breakdown a per-feature read cannot give.
const CHANNELS = [
  { featureSlug: "sales-cold-email-outreach", campaignIds: ["campaign-a"] },
  { featureSlug: "feedback-request-cold-email-outreach", campaignIds: ["campaign-b"] },
];

const REVENUE_BODY = {
  brandId: BRAND_ID,
  featureSlug: "sales-cold-email-outreach,feedback-request-cold-email-outreach",
  // The whole point of the grain: today's committed spend accounts for BOTH channels
  // ($40.07 + $10.32), where the per-feature read answered $40.07 alone.
  costEconomics: { committedSpendUsd: 2518.92, totalSpentTodayCents: 5039, roiMultiple: 1.8 },
  channels: [
    { ...CHANNELS[0], costEconomics: { totalSpentTodayCents: 4007 } },
    { ...CHANNELS[1], costEconomics: { totalSpentTodayCents: 1032 } },
  ],
};

const AUDIENCE_STATS_BODY = {
  brandId: BRAND_ID,
  featureSlug: "sales-cold-email-outreach,feedback-request-cold-email-outreach",
  goal: null,
  sortMetric: "returnPerDollar",
  audiences: [],
  brandProjection: {
    lifetimeRevenueUsd: null,
    costPerPaidClientUsd: null,
    returnPerDollar: null,
    costOfAcquisitionPct: null,
  },
  channels: CHANNELS,
};

const PIPELINE_ACTIVITY_BODY = {
  brandId: BRAND_ID,
  featureSlug: "sales-cold-email-outreach,feedback-request-cold-email-outreach",
  timezone: "America/New_York",
  generatedAt: "2026-08-20T00:00:00.000Z",
  days: [],
  summary: { dailyBudgetUsd: null, openRatePct: null },
  channels: CHANNELS,
};

// Brand-grain conversion rates carry no channel breakdown: one rate per (brand, funnel, arrow).
const CONVERSION_RATES_BODY = {
  brandId: BRAND_ID,
  minMeasuredFromReached: 10,
  contactedRecipients: 412,
  funnels: [
    {
      key: "self-serve",
      name: "Self-serve",
      steps: ["contacted", "visited", "signed_up"],
      arrows: [
        { from: "contacted", to: "visited", ratePct: 3.1, source: "measured", median: { ratePct: 2.4, brandCount: 7 } },
        { from: "visited", to: "signed_up", ratePct: 12, source: "manual", median: { ratePct: 9, brandCount: 7 } },
      ],
    },
  ],
};

const CONTACTED_VALUE_BODY = {
  brandId: BRAND_ID,
  totalValueUsd: 1234.5,
  leads: [{ leadId: "lead-1", valueUsd: 12.3 }],
  nextCursor: null,
};

// Deals-board column values: valued columns carry cards, the others state no value.
const DEALS_VALUE_BODY = {
  brandId: BRAND_ID,
  columns: [
    { standing: "sales_interest", valueUsd: 840.25, unpricedLeadCount: 0, leads: [{ leadId: "lead-1", valueUsd: 840.25 }] },
    { standing: "customer", valueUsd: 5000, unpricedLeadCount: null, leads: [{ leadId: "lead-2", valueUsd: 5000, valueSource: "stated_amount" }] },
    { standing: "disqualified", valueUsd: null, noValueReason: "disqualified", leads: [] },
  ],
};

// Lived sales paths: what people actually lived, ranked overall and per sales funnel campaign.
const LIVED_SALES_PATHS_BODY = {
  brandId: BRAND_ID,
  paths: [{ pathKey: "contacted>positive_reply>paid_client", leads: 12, paidClients: 2, revenueUsd: 4000, costUsd: 300, roi: 13.3 }],
  byCampaign: [],
};

// Brand spend charts: the brand-wide ledger chart, summed by features-service over the brand's offers.
const SPEND_CHARTS_BODY = {
  brandId: BRAND_ID,
  offerIds: ["offer-1", "offer-2"],
  pricing: "net",
  costBasis: "net",
  salesFunnelCampaignIds: ["sfc-1"],
  brand: { days: [{ date: "2026-11-06", spendUsd: 12.5 }] },
};

// Brand outcome cost series: the offer body without offerId, plus offerIds.
const OUTCOME_COST_SERIES_BODY = {
  brandId: BRAND_ID,
  offerIds: ["offer-1", "offer-2"],
  pricing: "net",
  outcomes: [{ step: "positive_reply", months: [{ month: "2026-10", costPerOutcomeUsd: 41.2 }], sinceInception: { costPerOutcomeUsd: 38.9 } }],
};

// One body per channel, each the per-channel grouped-by-campaign read (CAMPAIGN-MONEY-ONE-READ-1108).
// A stand-in page of features-service's brand company list (MON-PAGE-SPEED-2-1112).
const COMPANIES_BODY = {
  brandId: BRAND_ID,
  sort: "value",
  q: "acme",
  rung: "engaged",
  offset: 60,
  limit: 60,
  total: 61,
  organizationCount: 11345,
  rungs: [{ key: "engaged", rank: 2, label: "Engaged", organizationCount: 400 }],
  companies: [{ organizationKey: "org:1", companyKey: "acme.com", orgName: "Acme", expectedRevenueUsd: 12.5, lifecycle: { key: "engaged", rank: 2, label: "Engaged" } }],
};

const CAMPAIGN_REVENUE_BODY = {
  brandId: BRAND_ID,
  pricing: "net",
  channels: [
    { featureSlug: "sales-cold-email-outreach", costBasis: "charged", groupBy: "campaignId", groups: [{ campaignId: "campaign-a", costEconomics: { committedCostUsd: 40.07 } }] },
    { featureSlug: "ai-follow-up-email", error: "Failed to compute feature revenue", reason: "channel_read_failed" },
  ],
};

const READS = [
  { suffix: "revenue", body: REVENUE_BODY, query: "pricing=net" },
  { suffix: "audience-stats", body: AUDIENCE_STATS_BODY, query: "pricing=net" },
  { suffix: "pipeline-activity", body: PIPELINE_ACTIVITY_BODY, query: "days=7&timezone=America%2FNew_York" },
  { suffix: "conversion-rates", body: CONVERSION_RATES_BODY, query: "funnel=self-serve" },
  { suffix: "contacted-value", body: CONTACTED_VALUE_BODY, query: "cursor=lead-0" },
  { suffix: "deals-value", body: DEALS_VALUE_BODY, query: "refresh=1" },
  { suffix: "lived-sales-paths", body: LIVED_SALES_PATHS_BODY, query: "offerId=offer-1&pricing=net" },
  { suffix: "spend-charts", body: SPEND_CHARTS_BODY, query: "pricing=net" },
  { suffix: "outcome-cost-series", body: OUTCOME_COST_SERIES_BODY, query: "pricing=net" },
  { suffix: "campaign-revenue", body: CAMPAIGN_REVENUE_BODY, query: "pricing=net" },
  { suffix: "companies", body: COMPANIES_BODY, query: "pricing=net&sort=value&offset=60&q=acme&rung=engaged" },
] as const;

describe("GET /v1/brands/:brandId/* — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  function stubUpstream(body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      // A real Response: these reads are STREAMED to the caller (MON-PAGE-SPEED-1111), never parsed here.
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
  }

  beforeEach(() => {
    calls = [];
  });

  for (const { suffix, body, query } of READS) {
    describe(`/${suffix}`, () => {
      it("forwards to features-service's brand-grain path, carrying the resolved identity", async () => {
        stubUpstream(body);

        const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/${suffix}?${query}`);

        expect(res.status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(`${FEATURES_BASE}/brands/${BRAND_ID}/${suffix}?${query}`);
        expect(calls[0].options.method).toBe("GET");
        expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
        expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
        expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
        expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
      });

      it("returns features-service's body unchanged", async () => {
        stubUpstream(body);

        const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/${suffix}?${query}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual(body);
      });

      it("forwards every query param verbatim — no whitelist, nothing narrowed", async () => {
        stubUpstream(body);

        await request(buildApp()).get(
          `/v1/brands/${BRAND_ID}/${suffix}?${query}&funnel=self-serve&goal=signup&statuses=active%2Cpaused&limit=3&somethingFeaturesShipsNext=42`,
        );

        const forwarded = new URL(calls[0].url).searchParams;
        expect(forwarded.get("funnel")).toBe("self-serve");
        expect(forwarded.get("goal")).toBe("signup");
        expect(forwarded.get("statuses")).toBe("active,paused");
        expect(forwarded.get("limit")).toBe("3");
        expect(forwarded.get("somethingFeaturesShipsNext")).toBe("42");
      });

      it("ignores a caller-supplied org — only the authenticated org reaches features-service", async () => {
        stubUpstream(body);

        const res = await request(buildApp())
          .get(`/v1/brands/${BRAND_ID}/${suffix}?${query}`)
          .set("x-org-id", "someone-elses-org");

        expect(res.status).toBe(200);
        expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
      });

      it("takes the brand from the PATH, so a query brandId cannot redirect the read", async () => {
        stubUpstream(body);

        await request(buildApp()).get(
          `/v1/brands/${BRAND_ID}/${suffix}?${query}&brandId=00000000-0000-0000-0000-000000000000`,
        );

        // The forwarded PATH is the authenticated caller's brand. The stray query
        // param rides along untouched — narrowing the query is the bug this file's
        // siblings were cleaned of — and features-service decides what to do with it.
        expect(new URL(calls[0].url).pathname).toBe(`/brands/${BRAND_ID}/${suffix}`);
      });

      it("propagates an upstream 400 with its body intact rather than a generic 500", async () => {
        global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
          calls.push({ url, options });
          return {
            ok: false,
            status: 400,
            text: () =>
              Promise.resolve(JSON.stringify({ error: "unknown pricing", code: "BAD_PRICING" })),
            json: () => Promise.resolve({}),
          };
        });

        const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/${suffix}`);

        // Not flattened into { error: "<the whole JSON body>" } — `code` survives the
        // hop so a consumer can branch on the reason (CLAUDE.md #7).
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("BAD_PRICING");
      });
    });
  }

  it("/deals-value forwards a 409 refusal with its status and body intact", async () => {
    const refusal = { error: "channels price differently", reason: "brand_channels_price_differently", brandId: BRAND_ID };
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: false, status: 409, text: () => Promise.resolve(JSON.stringify(refusal)), json: () => Promise.resolve(refusal) };
    });

    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/deals-value`);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/brands/${BRAND_ID}/deals-value`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(refusal);
  });

  it("/companies/:companyKey reaches features-service's one-company path, key encoded, query verbatim", async () => {
    const body = { brandId: BRAND_ID, company: { companyKey: "acme.com" }, position: 3, previousKey: "b.io", nextKey: null, organizationCount: 11345, rungs: [] };
    stubUpstream(body);

    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/companies/acme.com?pricing=net`).set("x-org-id", "someone-elses-org");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/brands/${BRAND_ID}/companies/acme.com?pricing=net`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it("/companies/:companyKey forwards a named 404 intact", async () => {
    const refusal = { error: "no company", reason: "company_not_found" };
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: false, status: 404, text: () => Promise.resolve(JSON.stringify(refusal)), json: () => Promise.resolve(refusal) };
    });

    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/companies/nope.com`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(refusal);
  });
});
