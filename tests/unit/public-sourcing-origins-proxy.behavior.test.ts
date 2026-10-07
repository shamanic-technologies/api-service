import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load, so set it before the router imports.
const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { FEATURES_BASE };
});

/**
 * GET /v1/public/sourcing-origins — the anonymous sourcing-origin catalogue.
 *
 * Driven through the real router with a stubbed `fetch`. `authenticate` is NOT
 * mocked: the route must work for an anonymous visitor, and a mock would hide a
 * gate rather than prove its absence.
 */

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const CATALOGUE_BODY = JSON.stringify({
  origins: [
    { slug: "apollo-cold-filters", name: "Apollo Cold Filters", aFieldThisGatewayHasNeverHeardOf: 7 },
    { slug: "linkedin-engagement-signals", name: "LinkedIn Engagement Signals" },
  ],
});

describe("GET /v1/public/sourcing-origins — anonymous pass-through", () => {
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

  it("forwards to features-service GET /public/sourcing-origins with no identity demanded", async () => {
    stub(CATALOGUE_BODY);
    const res = await request(buildApp()).get("/v1/public/sourcing-origins");

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/sourcing-origins`);
    expect(calls[0].init.headers["x-org-id"]).toBeUndefined();
    expect(calls[0].init.headers["x-user-id"]).toBeUndefined();
    expect(calls[0].init.headers["x-run-id"]).toBeUndefined();
  });

  it("returns what features-service served, byte-equal", async () => {
    stub(CATALOGUE_BODY);
    const res = await request(buildApp()).get("/v1/public/sourcing-origins");

    expect(res.body).toEqual(JSON.parse(CATALOGUE_BODY));
  });

  it("forwards the caller's query string verbatim", async () => {
    stub(CATALOGUE_BODY);
    const query = "?somethingBrandNew=x&q=a%20b%2Bc&ids=a&ids=b";
    await request(buildApp()).get(`/v1/public/sourcing-origins${query}`);

    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/sourcing-origins${query}`);
  });

  it("forwards a downstream failure field-for-field", async () => {
    stub('{"error":"down","code":"ORIGINS_UNAVAILABLE"}', 503);
    const res = await request(buildApp()).get("/v1/public/sourcing-origins");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "down", code: "ORIGINS_UNAVAILABLE" });
  });
});
