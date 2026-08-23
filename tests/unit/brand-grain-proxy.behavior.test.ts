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
 * GET /v1/brands/:brandId/{revenue,audience-stats,pipeline-activity} — BEHAVIOURAL cover.
 *
 * The offer-grain cover beside this file, one level up. Per CLAUDE.md #7
 * corollary 3, a source-substring test cannot see a template literal's
 * interpolated value, so it can verify neither the downstream path that goes over
 * the wire nor the identity carried with it — and these six routes are declared
 * from ONE table, where an interpolated collection segment is exactly what could
 * go wrong. This file drives the real router with supertest and a stubbed fetch.
 *
 * What the brand Overview depends on, asserted here:
 *  - each read reaches its OWN features-service path at the BRAND grain, not the
 *    offer one it shares a declaration with;
 *  - the query arrives byte-identical, including a param this gateway has never
 *    heard of — a dropped filter here returns a 200 about a different population
 *    (the `pricing` / `funnel` failure this file's siblings were cleaned of);
 *  - the response passes through unchanged, per-channel breakdown included, so
 *    the spend the Overview shows accounts for every channel rather than one;
 *  - the org reaching features-service is the AUTHENTICATED one, never a
 *    caller-supplied override;
 *  - the offer-grain routes and the per-feature reads still go where they did.
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

// Two channels on one brand — the breakdown a per-feature read cannot give, and
// the reason the Overview's "$40 / 50" had two grains in it: $40.07 was one
// channel's spend, 50 was billing's brand-wide ceiling over both.
const CHANNELS = [
  { featureSlug: "sales-cold-email-outreach", campaignIds: ["campaign-a", "campaign-b"] },
  { featureSlug: "sales-linkedin-outreach", campaignIds: ["campaign-c"] },
];

const REVENUE_BODY = {
  brandId: BRAND_ID,
  featureSlug: "sales-cold-email-outreach,sales-linkedin-outreach",
  costEconomics: { committedSpendUsd: 50.39, roiMultiple: 1.8 },
  channels: [
    { ...CHANNELS[0], costEconomics: { committedSpendUsd: 40.07 } },
    { ...CHANNELS[1], costEconomics: { committedSpendUsd: 10.32 } },
  ],
};

const AUDIENCE_STATS_BODY = {
  brandId: BRAND_ID,
  featureSlug: "sales-cold-email-outreach,sales-linkedin-outreach",
  goal: null,
  sortMetric: "returnPerDollar",
  audiences: [],
  brandProjection: { lifetimeRevenueUsd: null, costPerPaidClientUsd: null, returnPerDollar: null, costOfAcquisitionPct: null },
  channels: CHANNELS,
};

const PIPELINE_ACTIVITY_BODY = {
  brandId: BRAND_ID,
  featureSlug: "sales-cold-email-outreach,sales-linkedin-outreach",
  timezone: "America/New_York",
  generatedAt: "2026-08-23T00:00:00.000Z",
  days: [],
  summary: { dailyBudgetUsd: 50, openRatePct: null, clickToSignupPct: null, clickToFormSubmissionPct: null, undatedSignups: null, undatedFormSubmissions: null },
  channels: CHANNELS,
};

const READS = [
  { suffix: "revenue", body: REVENUE_BODY, query: "" },
  { suffix: "audience-stats", body: AUDIENCE_STATS_BODY, query: "" },
  { suffix: "pipeline-activity", body: PIPELINE_ACTIVITY_BODY, query: "timezone=America%2FNew_York" },
] as const;

describe("GET /v1/brands/:brandId/* — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  function stubUpstream(body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(body) };
    });
  }

  function url(suffix: string, query: string): string {
    return `/v1/brands/${BRAND_ID}/${suffix}${query ? `?${query}` : ""}`;
  }

  beforeEach(() => {
    calls = [];
  });

  for (const { suffix, body, query } of READS) {
    describe(`/${suffix}`, () => {
      it("forwards to features-service's brand-grain path, carrying the resolved identity", async () => {
        stubUpstream(body);

        const res = await request(buildApp()).get(url(suffix, query));

        expect(res.status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(
          `${FEATURES_BASE}/brands/${BRAND_ID}/${suffix}${query ? `?${query}` : ""}`,
        );
        // Not the offer collection it shares a declaration table with.
        expect(calls[0].url).not.toContain("/offers/");
        expect(calls[0].options.method).toBe("GET");
        expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
        expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
        expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
        expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
      });

      it("returns features-service's body unchanged, per-channel breakdown included", async () => {
        stubUpstream(body);

        const res = await request(buildApp()).get(url(suffix, query));

        expect(res.status).toBe(200);
        expect(res.body).toEqual(body);
        expect(res.body.channels).toHaveLength(2);
      });

      it("forwards every query param verbatim — no whitelist, nothing narrowed", async () => {
        stubUpstream(body);

        await request(buildApp()).get(
          `${url(suffix, query)}${query ? "&" : "?"}pricing=net&funnel=self-serve&goal=signup&statuses=active%2Cpaused&limit=3&days=30&somethingFeaturesShipsNext=42`,
        );

        const forwarded = new URL(calls[0].url).searchParams;
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
          .get(url(suffix, query))
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
              Promise.resolve(JSON.stringify({ error: "timezone is required", code: "MISSING_TIMEZONE" })),
            json: () => Promise.resolve({}),
          };
        });

        const res = await request(buildApp()).get(url(suffix, ""));

        // Not flattened into { error: "<the whole JSON body>" } — `code` survives the
        // hop so a consumer can branch on the reason (CLAUDE.md #7).
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "timezone is required", code: "MISSING_TIMEZONE" });
      });
    });
  }

  it("keeps the caller's repeated keys and ordering byte-identical", async () => {
    stubUpstream(REVENUE_BODY);

    await request(buildApp()).get(
      `/v1/brands/${BRAND_ID}/revenue?pricing=net&funnel=self-serve&channel=a&channel=b`,
    );

    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/brands/${BRAND_ID}/revenue?pricing=net&funnel=self-serve&channel=a&channel=b`,
    );
  });

  it("encodes the brand id into the downstream path", async () => {
    stubUpstream(REVENUE_BODY);

    await request(buildApp()).get(`/v1/brands/a%2Fb/revenue`);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/brands/a%2Fb/revenue`);
  });

  it("leaves the offer-grain routes on their own downstream collection", async () => {
    stubUpstream(REVENUE_BODY);

    await request(buildApp()).get(`/v1/offers/${OFFER_ID}/revenue?brandId=${BRAND_ID}`);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/offers/${OFFER_ID}/revenue?brandId=${BRAND_ID}`);
  });

  it("does not touch the per-feature reads beside it", async () => {
    stubUpstream(REVENUE_BODY);

    await request(buildApp()).get(
      `/v1/features/sales-cold-email-outreach/revenue?brandId=${BRAND_ID}`,
    );

    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/features/sales-cold-email-outreach/revenue?brandId=${BRAND_ID}`,
    );
  });
});
