import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the router imports.
const { RUNS_BASE, COSTS_BASE, INSTANTLY_BASE } = vi.hoisted(() => {
  const RUNS_BASE = "http://runs.test.local";
  const COSTS_BASE = "http://costs.test.local";
  const INSTANTLY_BASE = "http://instantly.test.local";
  process.env.RUNS_SERVICE_URL = RUNS_BASE;
  process.env.RUNS_SERVICE_API_KEY = "runs-test-key";
  process.env.COSTS_SERVICE_URL = COSTS_BASE;
  process.env.COSTS_SERVICE_API_KEY = "costs-test-key";
  process.env.INSTANTLY_SERVICE_URL = INSTANTLY_BASE;
  process.env.INSTANTLY_SERVICE_API_KEY = "instantly-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { RUNS_BASE, COSTS_BASE, INSTANTLY_BASE };
});

/**
 * Staff "Monitoring" reads — fleet-wide, no org scoping, byte passthrough:
 *   GET /v1/runs/stats/costs/vendor → runs-service      GET /internal/stats/costs/vendor
 *   GET /v1/runs/stats/costs/margin → runs-service      GET /internal/stats/costs/margin
 *   GET /v1/runs/stats/costs/margin/timeseries → runs-service GET /internal/stats/costs/margin/timeseries
 *   GET /v1/costs/vendor-costs      → costs-service     GET /internal/vendor-costs
 *   GET /v1/costs/payment-sources   → costs-service     GET /internal/payment-sources
 *   GET /v1/costs/provider-payment-sources → costs-service GET /internal/provider-payment-sources
 *   PUT /v1/costs/provider-payment-sources/:provider → costs-service PUT same path under /internal
 *   GET /v1/instantly/stats         → instantly-service GET /public/stats
 *
 * No auth mock: the real authenticatePlatform + requireStaff run, and every refusal
 * asserts ZERO outbound calls. Bodies are fixtures — the producers own the shape.
 */
import runsRouter from "../../src/routes/runs.js";
import costsRouter from "../../src/routes/costs-staff.js";
import instantlyRouter from "../../src/routes/instantly.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(costsRouter);
  app.use("/v1", instantlyRouter);
  app.use("/v1", runsRouter);
  return app;
}

const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" };
// Odd spacing + key order on purpose: byte-for-byte means NOT re-serialized, and an
// unknown field (a future runs-service addition) must reach the caller.
const RAW = '{"groups":[{"dimensions":{"provider":"anthropic"}, "vendorTotalCostInUsdCents":"12","marginInUsdCents":"30"}],"someNewField":true}';

let calls: Array<{ url: string; options: any }>;

function upstream(status: number, raw: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(raw, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  });
}

beforeEach(() => {
  calls = [];
});

const ROUTES = [
  {
    path: "/v1/runs/stats/costs/vendor",
    query: "?groupBy=provider,costName&costSource=platform&x=a&x=b",
    downstream: `${RUNS_BASE}/internal/stats/costs/vendor`,
    key: "runs-test-key",
  },
  {
    path: "/v1/runs/stats/costs/margin",
    query: "?orgId=0b2d6f1e-3c4a-4d5e-8f60-718293a4b5c6&groupBy=provider",
    downstream: `${RUNS_BASE}/internal/stats/costs/margin`,
    key: "runs-test-key",
  },
  {
    path: "/v1/runs/stats/costs/margin/timeseries",
    query: "?orgId=0b2d6f1e-3c4a-4d5e-8f60-718293a4b5c6",
    downstream: `${RUNS_BASE}/internal/stats/costs/margin/timeseries`,
    key: "runs-test-key",
  },
  {
    path: "/v1/costs/payment-sources",
    query: "?x=a&x=b",
    downstream: `${COSTS_BASE}/internal/payment-sources`,
    key: "costs-test-key",
  },
  {
    path: "/v1/costs/provider-payment-sources",
    query: "?x=a",
    downstream: `${COSTS_BASE}/internal/provider-payment-sources`,
    key: "costs-test-key",
  },
  {
    path: "/v1/costs/vendor-costs",
    query: "?names=anthropic-sonnet-input,instantly-email-sent",
    downstream: `${COSTS_BASE}/internal/vendor-costs`,
    key: "costs-test-key",
  },
  {
    path: "/v1/instantly/stats",
    query: "?groupBy=featureSlug",
    downstream: `${INSTANTLY_BASE}/public/stats`,
    key: "instantly-test-key",
  },
];

for (const r of ROUTES) {
  describe(`staff — GET ${r.path}`, () => {
    it("forwards the query verbatim with the service key and returns the body byte-for-byte", async () => {
      upstream(200, RAW);
      const res = await request(buildApp()).get(`${r.path}${r.query}`).set(STAFF);

      expect(res.status).toBe(200);
      expect(res.text).toBe(RAW);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${r.downstream}${r.query}`);
      expect(calls[0].options.headers["X-API-Key"]).toBe(r.key);
      expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
    });

    it("forwards no query string when none is sent", async () => {
      upstream(200, RAW);
      await request(buildApp()).get(r.path).set(STAFF);
      expect(calls[0].url).toBe(r.downstream);
    });

    it("passes the downstream 400 through with its body", async () => {
      const raw = '{"error":"groupBy is required","code":"BAD_QUERY"}';
      upstream(400, raw);
      const res = await request(buildApp()).get(r.path).set(STAFF);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(JSON.parse(raw));
    });

    it("refuses the platform key without a staff email (403) and calls nothing", async () => {
      upstream(200, RAW);
      const res = await request(buildApp())
        .get(r.path)
        .set("X-API-Key", "admin-test-key")
        .set("x-email", "customer@example.com");
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it("refuses a wrong platform key (401) and calls nothing", async () => {
      upstream(200, RAW);
      const res = await request(buildApp()).get(r.path).set("X-API-Key", "nope").set("x-email", "kevin@distribute.you");
      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    it("refuses a customer bearer key (401) and calls nothing", async () => {
      upstream(200, RAW);
      const res = await request(buildApp())
        .get(r.path)
        .set("Authorization", "Bearer distrib.usr_customer")
        .set("x-email", "kevin@distribute.you");
      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });
  });
}

describe("staff — PUT /v1/costs/provider-payment-sources/:provider", () => {
  const PATH = "/v1/costs/provider-payment-sources/deepseek";
  const DOWNSTREAM = `${COSTS_BASE}/internal/provider-payment-sources/deepseek`;
  const BODY = { sources: ["revolut_business", "qonto"], futureField: 1 };

  it("forwards method and body as-is and returns the body byte-for-byte", async () => {
    const raw = '{"provider":"deepseek", "providerDomain":"deepseek.com","sources":[{"key":"qonto"}]}';
    upstream(200, raw);
    const res = await request(buildApp()).put(PATH).set(STAFF).send(BODY);

    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(DOWNSTREAM);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual(BODY);
    expect(calls[0].options.headers["X-API-Key"]).toBe("costs-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("returns the producer's 400 for an unknown source key unchanged", async () => {
    const raw =
      '{"error":"Unknown payment source(s): paypal. Known sources: qonto, revolut_business, revolut_personal, stripe. Add a new one with PUT /internal/payment-sources/:key first."}';
    upstream(400, raw);
    const res = await request(buildApp()).put(PATH).set(STAFF).send({ sources: ["paypal"] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(JSON.parse(raw));
  });

  it("returns the producer's 404 for an unknown provider unchanged", async () => {
    const raw = '{"error":"Provider not found: nope"}';
    upstream(404, raw);
    const res = await request(buildApp()).put("/v1/costs/provider-payment-sources/nope").set(STAFF).send({ sources: [] });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(JSON.parse(raw));
    expect(calls[0].url).toBe(`${COSTS_BASE}/internal/provider-payment-sources/nope`);
  });

  it("encodes the provider so it cannot escape the downstream path", async () => {
    upstream(200, "{}");
    await request(buildApp()).put("/v1/costs/provider-payment-sources/a%3Fx%3D1").set(STAFF).send({ sources: [] });
    expect(calls[0].url).toBe(`${COSTS_BASE}/internal/provider-payment-sources/a%3Fx%3D1`);
  });

  it("refuses the platform key without a staff email (403) and calls nothing", async () => {
    upstream(200, "{}");
    const res = await request(buildApp())
      .put(PATH)
      .set("X-API-Key", "admin-test-key")
      .set("x-email", "customer@example.com")
      .send(BODY);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a customer bearer key (401) and calls nothing", async () => {
    upstream(200, "{}");
    const res = await request(buildApp())
      .put(PATH)
      .set("Authorization", "Bearer distrib.usr_customer")
      .set("x-email", "kevin@distribute.you")
      .send(BODY);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
