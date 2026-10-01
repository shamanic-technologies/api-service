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
 *   GET /v1/costs/provider-payment-sources → costs-service GET /internal/provider-payment-sources
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

describe("staff — the hand-edited payment-source routes are gone (costs-service reads the bank ledger)", () => {
  for (const [method, path] of [
    ["get", "/v1/costs/payment-sources"],
    ["put", "/v1/costs/provider-payment-sources/deepseek"],
  ] as const) {
    it(`${method.toUpperCase()} ${path} is not routed and calls nothing`, async () => {
      upstream(200, "{}");
      const res = await request(buildApp())[method](path).set(STAFF).send({ sources: [] });
      expect(res.status).toBe(404);
      expect(calls).toHaveLength(0);
    });
  }
});
