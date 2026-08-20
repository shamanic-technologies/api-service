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

const READS = [
  { suffix: "revenue", body: REVENUE_BODY, query: "pricing=net" },
  { suffix: "audience-stats", body: AUDIENCE_STATS_BODY, query: "pricing=net" },
  { suffix: "pipeline-activity", body: PIPELINE_ACTIVITY_BODY, query: "days=7&timezone=America%2FNew_York" },
] as const;

describe("GET /v1/brands/:brandId/* — over the wire", () => {
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

      it("returns features-service's body unchanged, per-channel breakdown included", async () => {
        stubUpstream(body);

        const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/${suffix}?${query}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual(body);
        expect(res.body.channels).toHaveLength(2);
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
});
