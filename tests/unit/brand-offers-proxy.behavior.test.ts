import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { FEATURES_BASE, BRAND_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  const BRAND_BASE = "http://brand.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { FEATURES_BASE, BRAND_BASE };
});

/**
 * GET /v1/features/brands/:brandId/offers — BEHAVIOURAL cover.
 *
 * A source-substring test cannot see a template literal's interpolated value, so it can
 * verify neither the downstream path nor the identity carried with it. This drives the
 * real router with supertest and a stubbed fetch (CLAUDE.md #7 corollary 2/3).
 *
 * What the brand Overview's offer table depends on, asserted here:
 *  - the read reaches features-service's OWN path, /brands/{id}/offers — the offer grain
 *    combined across channels, not the per-feature read that answers for one channel;
 *  - the query arrives byte-identical, including a param this gateway has never heard of
 *    — a dropped `funnel` / `pricing` returns a 200 about a different population, which
 *    is the failure this file's siblings were cleaned of in #845;
 *  - the producer's body passes through unchanged;
 *  - the org reaching features-service is the AUTHENTICATED one, never a caller override;
 *  - the producer's 400 / named 404 / 409 / 502 reach the caller with their reason intact;
 *  - and the SIBLING route that shares the noun — brand-service's offer CATALOG at
 *    /v1/brands/:id/offers — still reaches brand-service. That collision is the reason
 *    this route is mounted under /v1/features/...; if someone "fixes" the path back to
 *    /v1/brands/:brandId/offers, brandRoutes wins and this read becomes dead code.
 *
 * Per CLAUDE.md #6/#8 the payloads are fixtures, not a contract this repo owns.
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
import brandRouter from "../../src/routes/brand.js";

// Mount order mirrors src/index.ts: brandRoutes BEFORE featuresRoutes.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  app.use("/v1", featuresRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";

const OFFERS_BODY = {
  brandId: BRAND_ID,
  funnel: "self-serve",
  pricing: "gross",
  offers: [
    {
      offerId: "offer-a",
      name: "Growth plan",
      // The whole point of the grain: this offer's money is BOTH channels' money.
      returnPerDollar: 1.8,
      costOfAcquisitionPct: 55.6,
      revenueUsd: 2518.92,
      investedUsd: 1399.4,
      channels: [
        { featureSlug: "sales-cold-email-outreach", investedUsd: 1120.5 },
        { featureSlug: "feedback-request-cold-email-outreach", investedUsd: 278.9 },
      ],
    },
    {
      offerId: "offer-b",
      name: "Starter plan",
      returnPerDollar: null,
      costOfAcquisitionPct: null,
      revenueUsd: 0,
      investedUsd: 0,
      channels: [],
    },
  ],
};

describe("GET /v1/features/brands/:brandId/offers — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  function stubUpstream(body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(body) };
    });
  }

  function stubUpstreamError(status: number, body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve({}),
      };
    });
  }

  beforeEach(() => {
    calls = [];
  });

  it("forwards to features-service's brand-offers path, carrying the resolved identity", async () => {
    stubUpstream(OFFERS_BODY);

    const res = await request(buildApp()).get(
      `/v1/features/brands/${BRAND_ID}/offers?funnel=self-serve&pricing=net`,
    );

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/brands/${BRAND_ID}/offers?funnel=self-serve&pricing=net`,
    );
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
  });

  it("returns features-service's body unchanged, per-offer channel breakdown included", async () => {
    stubUpstream(OFFERS_BODY);

    const res = await request(buildApp()).get(`/v1/features/brands/${BRAND_ID}/offers`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(OFFERS_BODY);
    expect(res.body.offers).toHaveLength(2);
    expect(res.body.offers[0].channels).toHaveLength(2);
  });

  it("forwards every query param verbatim — no whitelist, nothing narrowed", async () => {
    stubUpstream(OFFERS_BODY);

    await request(buildApp()).get(
      `/v1/features/brands/${BRAND_ID}/offers?funnel=self-serve&pricing=net&statuses=active%2Cpaused&somethingFeaturesShipsNext=42`,
    );

    const forwarded = new URL(calls[0].url).searchParams;
    expect(forwarded.get("funnel")).toBe("self-serve");
    expect(forwarded.get("pricing")).toBe("net");
    expect(forwarded.get("statuses")).toBe("active,paused");
    expect(forwarded.get("somethingFeaturesShipsNext")).toBe("42");
  });

  it("ignores a caller-supplied org — only the authenticated org reaches features-service", async () => {
    stubUpstream(OFFERS_BODY);

    const res = await request(buildApp())
      .get(`/v1/features/brands/${BRAND_ID}/offers`)
      .set("x-org-id", "someone-elses-org");

    expect(res.status).toBe(200);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("takes the brand from the PATH, so a query brandId cannot redirect the read", async () => {
    stubUpstream(OFFERS_BODY);

    await request(buildApp()).get(
      `/v1/features/brands/${BRAND_ID}/offers?brandId=00000000-0000-0000-0000-000000000000`,
    );

    expect(new URL(calls[0].url).pathname).toBe(`/brands/${BRAND_ID}/offers`);
  });

  for (const [status, body] of [
    [400, { error: "unknown pricing", code: "BAD_PRICING" }],
    [404, { error: "Brand not found", code: "BRAND_NOT_FOUND" }],
    [409, { error: "Offer grain is rebuilding", code: "GRAIN_REBUILDING" }],
    [502, { error: "runs-service unavailable", code: "UPSTREAM_UNAVAILABLE" }],
  ] as const) {
    it(`propagates an upstream ${status} with its body intact rather than a generic 500`, async () => {
      stubUpstreamError(status, body);

      const res = await request(buildApp()).get(`/v1/features/brands/${BRAND_ID}/offers`);

      // Not flattened into { error: "<the whole JSON body>" } — `code` survives the hop
      // so a consumer can branch on the reason (CLAUDE.md #7).
      expect(res.status).toBe(status);
      expect(res.body).toEqual(body);
    });
  }

  it("leaves brand-service's offer CATALOG at /v1/brands/:id/offers untouched", async () => {
    stubUpstream({ offers: [] });

    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/offers`);

    expect(res.status).toBe(200);
    // Still brand-service, still its own path — the noun is shared, the question is not.
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers`);
  });
});
