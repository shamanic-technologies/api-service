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
 * Wave C4 — the three funnel-free public reads, forwarded exactly like their funnel-keyed
 * siblings: anonymous, query string verbatim, body byte-for-byte, upstream errors field-for-field.
 * `authenticate` is deliberately NOT mocked: these must answer an anonymous visitor.
 */

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const CASES = [
  { gateway: "/v1/public/features/outcome-return-on-spend", downstream: "/public/stats/outcome-return-on-spend" },
  { gateway: "/v1/public/features/showcase-outcomes", downstream: "/public/stats/showcase-outcomes" },
  { gateway: "/v1/public/channel-outcome-economics", downstream: "/public/channel-outcome-economics" },
];

const BODY = JSON.stringify({ rows: [{ outcomeKey: "meeting_booked", measured: false, reason: "not_enough_brands", aFieldThisGatewayHasNeverHeardOf: 7 }] });

describe.each(CASES)("GET $gateway — anonymous pass-through", ({ gateway, downstream }) => {
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

  it(`forwards to features-service GET ${downstream} with no identity and the body untouched`, async () => {
    stub(BODY);
    const res = await request(buildApp()).get(gateway);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}${downstream}`);
    expect(calls[0].init.headers["x-org-id"]).toBeUndefined();
    expect(calls[0].init.headers["x-user-id"]).toBeUndefined();
    expect(calls[0].init.headers["x-run-id"]).toBeUndefined();
    expect(res.body).toEqual(JSON.parse(BODY));
  });

  it("carries the query string through verbatim", async () => {
    stub(BODY);
    const query = "?channelSlug=sales-cold-email-outreach&minSpendUsd=250&somethingBrandNew=x%20y&ids=a&ids=b";
    await request(buildApp()).get(`${gateway}${query}`);

    expect(calls[0].url).toBe(`${FEATURES_BASE}${downstream}${query}`);
  });

  it("forwards an upstream 404 with its body field-for-field", async () => {
    stub('{"error":"Acquisition channel not found: \\"nope\\"","code":"NOT_FOUND"}', 404);
    const res = await request(buildApp()).get(`${gateway}?channelSlug=nope`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Acquisition channel not found: "nope"', code: "NOT_FOUND" });
  });
});

describe("the funnel-keyed siblings stay on their own downstream paths", () => {
  it("routes each funnel read to its funnel path, not the outcome twin", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    const app = buildApp();
    await request(app).get("/v1/public/features/funnel-return-on-spend");
    await request(app).get("/v1/public/features/showcase-funnels");
    await request(app).get("/v1/public/channel-funnel-economics");

    expect(seen).toEqual([
      `${FEATURES_BASE}/public/stats/funnel-return-on-spend`,
      `${FEATURES_BASE}/public/stats/showcase-funnels`,
      `${FEATURES_BASE}/public/channel-funnel-economics`,
    ]);
  });
});
