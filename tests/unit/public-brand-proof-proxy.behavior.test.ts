import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BRAND_BASE } = vi.hoisted(() => {
  const BRAND_BASE = "http://brand.test.local";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { BRAND_BASE };
});

/**
 * GET /v1/public/brand-proof — a brand's proof logos (BRAND-PROOF-LOGOS-1121),
 * read by the anonymous landing. Real router, stubbed fetch, no auth mocked.
 */
import router from "../../src/routes/public-brand-proof.js";

function buildApp() {
  const app = express();
  app.use("/v1", router);
  return app;
}

const BODY = '{"brandId":"b","domain":"distribute.you","minScore":80,"minMonthlyTraffic":10000,"limit":24,"employers":[],"press":[]}';

describe("public brand proof — anonymous byte pass-through", () => {
  let calls: Array<{ url: string; init: any }>;
  function stub(body: string, status = 200) {
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
  }
  beforeEach(() => { calls = []; });

  it("forwards the query verbatim to brand-service GET /public/brand-proof with no identity", async () => {
    stub(BODY);
    const res = await request(buildApp()).get("/v1/public/brand-proof?domain=distribute.you&limit=12");
    expect(res.status).toBe(200);
    expect(res.text).toBe(BODY);
    expect(calls[0].url).toBe(`${BRAND_BASE}/public/brand-proof?domain=distribute.you&limit=12`);
    expect(calls[0].init.headers["x-org-id"]).toBeUndefined();
    expect(calls[0].init.headers["x-user-id"]).toBeUndefined();
  });

  it("keeps the producer's 404", async () => {
    stub('{"error":"Brand not found"}', 404);
    const res = await request(buildApp()).get("/v1/public/brand-proof?domain=nobody.com");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Brand not found" });
  });
});
