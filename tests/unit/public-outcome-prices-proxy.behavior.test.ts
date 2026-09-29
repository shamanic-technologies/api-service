import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { FEATURES_BASE };
});

/**
 * GET /v1/public/outcome-prices — the unauthenticated features-service read the
 * signed-out onboarding prices "Website visits" / "Meetings booked" with.
 * Auth middleware deliberately NOT mocked: an anonymous visitor must get through.
 */

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const BODY = JSON.stringify({
  computedAt: null,
  outcomes: {
    websiteVisit: { priceUsd: null, aFieldThisGatewayHasNeverHeardOf: 7 },
    meetingBooked: { priceUsd: 123.45 },
  },
});

describe("GET /v1/public/outcome-prices — anonymous pass-through", () => {
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

  it("forwards to features-service GET /public/stats/outcome-prices with no identity", async () => {
    stub(BODY);
    const res = await request(buildApp()).get("/v1/public/outcome-prices");

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/stats/outcome-prices`);
    expect(calls[0].init.headers["x-org-id"]).toBeUndefined();
    expect(calls[0].init.headers["x-user-id"]).toBeUndefined();
    expect(calls[0].init.headers["x-run-id"]).toBeUndefined();
  });

  it("returns the producer body byte-equal", async () => {
    stub(BODY);
    const res = await request(buildApp()).get("/v1/public/outcome-prices");
    expect(res.body).toEqual(JSON.parse(BODY));
  });

  it("forwards the query string verbatim", async () => {
    stub(BODY);
    const query = "?somethingBrandNew=x&q=a%20b%2Bc";
    await request(buildApp()).get(`/v1/public/outcome-prices${query}`);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/stats/outcome-prices${query}`);
  });

  it("surfaces a downstream failure instead of an empty body", async () => {
    stub('{"error":"down","code":"X"}', 503);
    const res = await request(buildApp()).get("/v1/public/outcome-prices");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "down", code: "X" });
  });
});
