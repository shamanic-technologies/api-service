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
 * GET /v1/public/features/showcase-funnels — the funnel counts of the named client
 * brands our homepage states, read by a static page from an anonymous browser.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes
 * over the wire: the downstream path literal, the absence of any identity header,
 * and the producer's body untouched. `authenticate` is deliberately NOT mocked —
 * the route must answer an anonymous visitor, and a mock would hide a gate rather
 * than prove its absence (CLAUDE.md rule #3 and rule #7 corollary 3).
 */

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const BODY = JSON.stringify({
  brands: [
    {
      brand: { id: "1e1b0e1a-0000-4000-8000-000000000001", name: "Acme", domain: "acme.com" },
      funnels: [
        {
          funnelKey: "sales_call",
          funnelName: "Sales call",
          steps: [
            { key: "contacted", label: "Contacted", peopleReached: 12000 },
            { key: "replied", label: "Replied", peopleReached: 0 },
            { key: "call_booked", label: "Call booked", peopleReached: null },
          ],
        },
      ],
      measured: true,
      unmeasuredReason: null,
    },
    {
      brand: { id: "1e1b0e1a-0000-4000-8000-000000000002", name: "Beta", domain: null },
      funnels: [],
      measured: false,
      unmeasuredReason: "no_funnel_sold",
    },
  ],
  aFieldThisGatewayHasNeverHeardOf: 7,
});

describe("GET /v1/public/features/showcase-funnels — anonymous pass-through", () => {
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

  it("forwards to features-service GET /public/stats/showcase-funnels with no identity demanded", async () => {
    stub(BODY);
    const res = await request(buildApp()).get("/v1/public/features/showcase-funnels");

    expect(res.status).toBe(200);
    const { url, init } = upstream();
    expect(url).toBe(`${FEATURES_BASE}/public/stats/showcase-funnels`);
    expect(init.method ?? "GET").toBe("GET");
    // A homepage visitor is anonymous: the gateway invents no org, user or run.
    expect(init.headers["x-org-id"]).toBeUndefined();
    expect(init.headers["x-user-id"]).toBeUndefined();
    expect(init.headers["x-run-id"]).toBeUndefined();
  });

  it("returns the producer's body field-for-field, unknown fields included", async () => {
    stub(BODY);
    const res = await request(buildApp()).get("/v1/public/features/showcase-funnels");

    expect(res.body).toEqual(JSON.parse(BODY));
    expect(res.body.aFieldThisGatewayHasNeverHeardOf).toBe(7);
  });

  it("keeps a measured 0 distinct from an unmeasured null, and a degraded brand's reason", async () => {
    stub(BODY);
    const res = await request(buildApp()).get("/v1/public/features/showcase-funnels");

    const steps = res.body.brands[0].funnels[0].steps;
    expect(steps[1].peopleReached).toBe(0);
    expect(steps[2].peopleReached).toBeNull();
    expect(res.body.brands[1].measured).toBe(false);
    expect(res.body.brands[1].unmeasuredReason).toBe("no_funnel_sold");
    // A degraded brand is still served alongside the measured one.
    expect(res.body.brands).toHaveLength(2);
  });

  it("forwards an upstream failure with its status and its body field-for-field", async () => {
    stub('{"error":"features-service is unavailable","code":"UPSTREAM_DOWN"}', 502);
    const res = await request(buildApp()).get("/v1/public/features/showcase-funnels");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "features-service is unavailable", code: "UPSTREAM_DOWN" });
  });

  it("does not let a caller name a brand — a query string is carried through, never turned into a brand selector here", async () => {
    stub(BODY);
    const query = "?brandId=1e1b0e1a-0000-4000-8000-0000000000ff";
    await request(buildApp()).get(`/v1/public/features/showcase-funnels${query}`);

    // Forwarded verbatim: the producer owns its (empty) parameter vocabulary and
    // ignores what it does not accept. The gateway neither strips nor invents.
    expect(upstream().url).toBe(`${FEATURES_BASE}/public/stats/showcase-funnels${query}`);
  });

  it("leaves the sibling public feature reads on their own downstream paths", async () => {
    const seen: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const app = buildApp();
    await request(app).get("/v1/public/features/return-on-spend");
    await request(app).get("/v1/public/features/ranked?groupBy=brand");
    await request(app).get("/v1/public/channels");

    expect(seen[0]).toBe(`${FEATURES_BASE}/public/stats/return-on-spend`);
    expect(seen[1]).toContain("/public/stats/ranked?");
    expect(seen[2]).toBe(`${FEATURES_BASE}/public/channels`);
    expect(seen.some((u) => u.includes("showcase-funnels"))).toBe(false);
  });
});
