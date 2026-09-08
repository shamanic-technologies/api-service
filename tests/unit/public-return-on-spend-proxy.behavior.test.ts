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
 * GET /v1/public/features/return-on-spend — the median return on spend our clients
 * get, read by the statically-rendered public landing with no identity of any kind.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes
 * over the wire: the downstream path, the caller's query string byte-for-byte, and
 * the producer's body untouched. `authenticate` is deliberately NOT mocked — the
 * route must answer an anonymous visitor, and a mock would hide a gate rather than
 * prove its absence (CLAUDE.md rule #3 and rule #7 corollary 3).
 */

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const MEASURED_BODY = JSON.stringify({
  costBasis: "charged",
  featureSlug: "sales-cold-email-outreach",
  unit: "brand",
  measured: true,
  reason: null,
  minSpendUsd: 100,
  brandCount: 9,
  medianReturnPerDollar: 3.7,
  p25ReturnPerDollar: 1.8,
  p75ReturnPerDollar: 9.4,
  minReturnPerDollar: 0.4,
  maxReturnPerDollar: 61.2,
  computedAt: "2026-09-08T09:00:00.000Z",
  aFieldThisGatewayHasNeverHeardOf: 7,
});

describe("GET /v1/public/features/return-on-spend — anonymous pass-through", () => {
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

  it("forwards to features-service GET /public/stats/return-on-spend with no identity demanded", async () => {
    stub(MEASURED_BODY);
    const res = await request(buildApp()).get("/v1/public/features/return-on-spend");

    expect(res.status).toBe(200);
    const { url, init } = upstream();
    expect(url).toBe(`${FEATURES_BASE}/public/stats/return-on-spend`);
    expect(init.method ?? "GET").toBe("GET");
    // A landing visitor is anonymous: the gateway invents no org, user or run.
    expect(init.headers["x-org-id"]).toBeUndefined();
    expect(init.headers["x-user-id"]).toBeUndefined();
    expect(init.headers["x-run-id"]).toBeUndefined();
  });

  it("carries the population-selecting query string through verbatim", async () => {
    stub(MEASURED_BODY);
    const query = "?featureSlug=sales-cold-email-outreach&minSpendUsd=250&somethingBrandNew=x%20y&ids=a&ids=b";
    await request(buildApp()).get(`/v1/public/features/return-on-spend${query}`);

    expect(upstream().url).toBe(`${FEATURES_BASE}/public/stats/return-on-spend${query}`);
  });

  it("returns the producer's body field-for-field", async () => {
    stub(MEASURED_BODY);
    const res = await request(buildApp()).get("/v1/public/features/return-on-spend?minSpendUsd=100");

    expect(res.body).toEqual(JSON.parse(MEASURED_BODY));
    expect(res.body.medianReturnPerDollar).toBe(3.7);
    expect(res.body.brandCount).toBe(9);
    expect(res.body.aFieldThisGatewayHasNeverHeardOf).toBe(7);
  });

  it("keeps the two unmeasurable answers distinguishable instead of blanking them", async () => {
    for (const reason of ["no_snapshot_yet", "not_enough_brands"]) {
      calls = [];
      const body = JSON.stringify({
        measured: false,
        reason,
        brandCount: reason === "not_enough_brands" ? 2 : 0,
        medianReturnPerDollar: null,
      });
      stub(body);
      const res = await request(buildApp()).get("/v1/public/features/return-on-spend");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(JSON.parse(body));
      expect(res.body.reason).toBe(reason);
    }
  });

  it("forwards an upstream 400 with its body field-for-field", async () => {
    stub('{"error":"minSpendUsd must be a non-negative number","code":"BAD_MIN_SPEND"}', 400);
    const res = await request(buildApp()).get("/v1/public/features/return-on-spend?minSpendUsd=-1");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "minSpendUsd must be a non-negative number", code: "BAD_MIN_SPEND" });
  });

  it("leaves the public feature reads the landing already makes on their own downstream paths", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const app = buildApp();
    await request(app).get("/v1/public/features/ranked?groupBy=brand");
    await request(app).get("/v1/public/features/best?featureSlug=x");
    await request(app).get("/v1/public/features/revenue?featureSlug=x");

    expect(seen[0]).toContain("/public/stats/ranked?");
    expect(seen[0]).toContain("groupBy=brand");
    expect(seen[1]).toContain("/public/stats/best?");
    expect(seen[2]).toContain("/public/stats/revenue?");
    expect(seen.some((u) => u.includes("return-on-spend"))).toBe(false);
  });
});
