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
 * GET /v1/public/indexes and /v1/public/indexes/:slug — our public fleet indexes,
 * read by the anonymous landing. Driven through the real router with a stubbed fetch;
 * `authenticate` is NOT mocked, so a gate would show up as a refusal here.
 */

import featuresRouter from "../../src/routes/features.js";

function buildApp(prefix: string) {
  const app = express();
  app.use(express.json());
  app.use(prefix, featuresRouter);
  return app;
}

const LIST = '{"statusRule":"r","indexes":[{"slug":"sceo-cost-per-click","name":"SCEO Cost Per Click Index","unit":"usd","value":0.42,"status":"live","day":"2026-10-17","extra":1}]}';
const ONE = '{"statusRule":"r","index":{"slug":"sceo-cost-per-click"},"points":[{"day":"2026-10-17","value":0.42,"status":"live"}]}';

describe("public fleet indexes — anonymous byte pass-through", () => {
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

  it.each(["/v1", ""])("lists indexes from features-service GET /public/indexes (mount %s) with no identity", async (prefix) => {
    stub(LIST);
    const res = await request(buildApp(prefix || "/")).get(`${prefix}/public/indexes`);

    expect(res.status).toBe(200);
    expect(res.text).toBe(LIST);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/indexes`);
    expect(calls[0].init.headers["x-org-id"]).toBeUndefined();
    expect(calls[0].init.headers["x-user-id"]).toBeUndefined();
    expect(calls[0].init.headers["x-run-id"]).toBeUndefined();
  });

  it("reads one index at GET /public/indexes/{slug}, query forwarded verbatim", async () => {
    stub(ONE);
    const res = await request(buildApp("/v1")).get("/v1/public/indexes/sceo-cost-per-click?from=2026-10-01&x=a&x=b");

    expect(res.status).toBe(200);
    expect(res.text).toBe(ONE);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/indexes/sceo-cost-per-click?from=2026-10-01&x=a&x=b`);
    expect(calls[0].init.headers["x-org-id"]).toBeUndefined();
  });

  it("keeps the producer's 404 index_not_found as a 404 with its body", async () => {
    stub('{"error":"index_not_found"}', 404);
    const res = await request(buildApp("/v1")).get("/v1/public/indexes/nope");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "index_not_found" });
  });

  it("keeps a slug carrying slashes inside one encoded segment, never a path out of /public/indexes", async () => {
    stub('{"error":"index_not_found"}', 404);
    await request(buildApp("/v1")).get("/v1/public/indexes/..%2F..%2Finternal%2Fx");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/indexes/..%2F..%2Finternal%2Fx`);
    expect(new URL(calls[0].url).pathname.startsWith("/public/indexes/")).toBe(true);
  });
});
