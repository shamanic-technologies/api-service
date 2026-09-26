import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load, so set it BEFORE the router imports.
const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { FEATURES_BASE };
});

/**
 * Wave C2 retired the sales funnel as an identity. features-service v0.177.0 deleted
 * its funnel-keyed reads (goal-arbitration / funnel-ranking, /offers/:id/funnels and the
 * per-funnel revenue / audience-stats / pipeline-activity under it), so the gateway no
 * longer mounts or documents them (CLAUDE.md #5: a route whose producer is gone is
 * removed here too). These assertions drive the real router: a retired path must never
 * reach features-service, and the surviving offer / feature reads must still forward.
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
import { buildDocument } from "../../src/openapi/document.js";

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";
const OFFER_ID = "d5ecba00-783a-4939-b5bd-f85b9e6b7d9e";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const RETIRED_PATHS = [
  `/v1/features/sales-cold-email-outreach/goal-arbitration?brandId=${BRAND_ID}`,
  `/v1/features/sales-cold-email-outreach/funnel-ranking?brandId=${BRAND_ID}`,
  `/v1/offers/${OFFER_ID}/funnels?brandId=${BRAND_ID}`,
  `/v1/offers/${OFFER_ID}/funnels/self-serve/revenue?brandId=${BRAND_ID}`,
  `/v1/offers/${OFFER_ID}/funnels/self-serve/audience-stats?brandId=${BRAND_ID}`,
  `/v1/offers/${OFFER_ID}/funnels/self-serve/pipeline-activity?brandId=${BRAND_ID}`,
];

let calls: string[];
const originalFetch = global.fetch;

beforeEach(() => {
  calls = [];
  global.fetch = vi.fn(async (url: any) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as any;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("retired funnel-keyed routes", () => {
  it.each(RETIRED_PATHS)("%s is not mounted and never reaches features-service", async (path) => {
    const res = await request(buildApp()).get(path);
    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("are absent from the published and the staff OpenAPI documents", () => {
    for (const audience of ["public", "staff"] as const) {
      const paths = Object.keys((buildDocument({ audience }) as any).paths);
      expect(paths.filter((p) => /goal-arbitration|funnel-ranking|\/offers\/\{offerId\}\/funnels/.test(p))).toEqual([]);
    }
  });
});

describe("surviving features-service forwards", () => {
  it.each(["revenue", "audience-stats", "pipeline-activity", "outcomes"])(
    "/v1/offers/:offerId/%s still forwards verbatim",
    async (suffix) => {
      const res = await request(buildApp()).get(`/v1/offers/${OFFER_ID}/${suffix}?brandId=${BRAND_ID}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(calls).toEqual([`${FEATURES_BASE}/offers/${OFFER_ID}/${suffix}?brandId=${BRAND_ID}`]);
    },
  );

  it("/v1/features/:slug/workflow-projection still forwards", async () => {
    const res = await request(buildApp()).get(
      `/v1/features/sales-cold-email-outreach/workflow-projection?brandId=${BRAND_ID}`,
    );
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      `${FEATURES_BASE}/features/sales-cold-email-outreach/workflow-projection?brandId=${BRAND_ID}`,
    ]);
  });
});
