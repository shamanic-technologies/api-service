import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BRAND_BASE, RUNS_BASE } = vi.hoisted(() => {
  const BRAND_BASE = "http://brand.test.local";
  const RUNS_BASE = "http://runs.test.local";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  process.env.RUNS_SERVICE_URL = RUNS_BASE;
  process.env.RUNS_SERVICE_API_KEY = "runs-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { BRAND_BASE, RUNS_BASE };
});

/**
 * FACTORY-USER-LEDGER-1102: a client reads the Ledger of its own brand.
 *
 * Customer: GET /v1/brands/:brandId/ledger[/runs] (src/routes/brand-audience.ts) →
 * runs-service GET /v1/brands/{brandId}/ledger[/runs], scoped there on x-org-id.
 * Staff (unchanged): GET /v1/runs/brands/:brandId/ledger[/runs] (src/routes/runs.ts) →
 * runs-service GET /internal/brands/{brandId}/ledger[/runs], brand-wide.
 *
 * Real authenticate chain, stubbed global.fetch.
 */
const { createRun } = vi.hoisted(() => ({ createRun: vi.fn() }));
vi.mock("@distribute/runs-client", () => ({
  createRun,
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

import brandAudienceRouter from "../../src/routes/brand-audience.js";
import runsRouter from "../../src/routes/runs.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", runsRouter);
  app.use("/v1", brandAudienceRouter);
  return app;
}

const ORG = "fc600ac6-d6d4-4086-861d-fe12683d0637";
const USER = "7d7d6c9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const BRAND = "7d9cc3d9-15ec-4357-bfe9-49b17dadb90c";
const OTHER_ORG_BRAND = "11111111-2222-4333-8444-555555555555";
const CUSTOMER = { "X-API-Key": "admin-test-key", "x-email": "owner@customer.com", "x-org-id": ORG, "x-user-id": USER };
const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" };

const LEDGER_RAW = '{"brandId":"b","books":{"spend":{"grossCents":"1.0000000000","netCents":"0.9000000000"},"balanced":true},"days":[]}';
const RUNS_RAW = '{"runs":[{"id":"r1","cost":{"grossCents":"1"}}],"nextBefore":null}';

let calls: Array<{ url: string; options: any }>;

function upstream(opts: { orgBrands?: string[]; status?: number; raw?: string } = {}) {
  const { orgBrands = [BRAND], status, raw } = opts;
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    const json = { "content-type": "application/json; charset=utf-8" };
    if (url.startsWith(`${BRAND_BASE}/orgs/brands`)) {
      return new Response(JSON.stringify({ brands: orgBrands.map((id) => ({ id, domain: "x.com" })) }), { status: 200, headers: json });
    }
    return new Response(raw ?? (url.includes("/ledger/runs") ? RUNS_RAW : LEDGER_RAW), { status: status ?? 200, headers: json });
  });
}

beforeEach(() => {
  calls = [];
  createRun.mockReset().mockResolvedValue({ id: "run-1" });
});

describe.each([
  { suffix: "", raw: LEDGER_RAW, query: "?since=2026-10-01&until=2026-11-01" },
  { suffix: "/runs", raw: RUNS_RAW, query: "?before=2026-11-02T00:00:00Z&limit=50&kind=produced" },
])("customer — GET /v1/brands/:brandId/ledger$suffix", ({ suffix, raw, query }) => {
  const path = (brand: string) => `/v1/brands/${brand}/ledger${suffix}`;

  it("own brand: 200, body byte-for-byte from runs-service's org-scoped read, under the authenticated org", async () => {
    upstream();
    const res = await request(buildApp()).get(`${path(BRAND)}${query}`).set(CUSTOMER);

    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands`);
    expect(calls[0].options.headers["x-org-id"]).toBe(ORG);
    expect(calls[1].url).toBe(`${RUNS_BASE}/v1/brands/${BRAND}/ledger${suffix}${query}`);
    expect(calls[1].url).not.toContain("/internal/");
    expect(calls[1].options.headers["x-org-id"]).toBe(ORG);
    expect(calls[1].options.headers["x-user-id"]).toBe(USER);
    expect(calls[1].options.headers["X-API-Key"]).toBe("runs-test-key");
  });

  it("a brand of another org: 404 brand_not_in_org and no runs-service read", async () => {
    upstream({ orgBrands: [BRAND] });
    const res = await request(buildApp()).get(path(OTHER_ORG_BRAND)).set(CUSTOMER);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("brand_not_in_org");
    expect(calls.filter((c) => c.url.startsWith(RUNS_BASE))).toHaveLength(0);
  });

  it("passes runs-service's 400 through with its status and body", async () => {
    const err = '{"error":"since/until must be YYYY-MM-DD"}';
    upstream({ status: 400, raw: err });
    const res = await request(buildApp()).get(`${path(BRAND)}?since=bad`).set(CUSTOMER);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(JSON.parse(err));
  });

  it("refuses a call with no credentials (401) and reads nothing", async () => {
    upstream();
    const res = await request(buildApp()).get(path(BRAND));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe.each(["", "/runs"])("staff — GET /v1/runs/brands/:brandId/ledger%s (unchanged)", (suffix) => {
  it("staff reads any brand, brand-wide, through runs-service's staff read", async () => {
    upstream({ orgBrands: [] });
    const res = await request(buildApp()).get(`/v1/runs/brands/${OTHER_ORG_BRAND}/ledger${suffix}?limit=5`).set(STAFF);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${RUNS_BASE}/internal/brands/${OTHER_ORG_BRAND}/ledger${suffix}?limit=5`);
  });

  it("a customer is still refused on the staff read (403)", async () => {
    upstream();
    const res = await request(buildApp()).get(`/v1/runs/brands/${BRAND}/ledger${suffix}`).set(CUSTOMER);
    expect(res.status).toBe(403);
    expect(calls.filter((c) => c.url.startsWith(RUNS_BASE))).toHaveLength(0);
  });
});
