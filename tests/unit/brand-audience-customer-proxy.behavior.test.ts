import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BRAND_BASE, HUMAN_BASE, FEATURES_BASE } = vi.hoisted(() => {
  const BRAND_BASE = "http://brand.test.local";
  const HUMAN_BASE = "http://human.test.local";
  const FEATURES_BASE = "http://features.test.local";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  process.env.HUMAN_SERVICE_URL = HUMAN_BASE;
  process.env.HUMAN_SERVICE_API_KEY = "human-test-key";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { BRAND_BASE, HUMAN_BASE, FEATURES_BASE };
});

/**
 * CUSTOMER reads of a brand's Audience page (src/routes/brand-audience.ts):
 * GET /v1/brands/:brandId/audience-snapshot[/people|/companies] and
 * GET /v1/brands/:brandId/sourcing-investment[/people|/companies].
 *
 * Real authenticate chain (no auth mock), a NON-staff org member (customer email),
 * stubbed global.fetch. Asserts: own brand → 200 scoped to the authenticated org;
 * a brand of another org → 404 with ZERO data reads; investment bodies carry no
 * vendorUsd at any depth; a caller-named orgId never reaches human-service.
 */
const { createRun } = vi.hoisted(() => ({ createRun: vi.fn() }));
vi.mock("@distribute/runs-client", () => ({
  createRun,
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

import brandAudienceRouter, { stripVendorCost } from "../../src/routes/brand-audience.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandAudienceRouter);
  return app;
}

const ORG = "fc600ac6-d6d4-4086-861d-fe12683d0637";
const OTHER_ORG = "0b8e2b1e-0000-4000-8000-000000000001";
const USER = "7d7d6c9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const BRAND = "7d9cc3d9-15ec-4357-bfe9-49b17dadb90c";
const FOREIGN_BRAND = "11111111-2222-4333-8444-555555555555";
const CUSTOMER = { "X-API-Key": "admin-test-key", "x-email": "owner@customer.com", "x-org-id": ORG, "x-user-id": USER };

const SNAPSHOT_RAW = '{"lists":[{"audienceId":"a1", "people":3}]}';
const money = (b: number, n: number, v: number | null) => ({ billedUsd: b, netUsd: n, vendorUsd: v, unpricedBilledUsd: 0 });
const INVESTMENT = {
  brandId: BRAND,
  total: money(10, 9, 2),
  serves: money(8, 7, 1.5),
  peopleWithoutCompany: { personCount: 1, invested: money(1, 1, null) },
  audiences: [{ audienceId: "a1", invested: money(10, 9, 2), serves: money(8, 7, 1.5) }],
  people: [{ leadId: "l1", invested: money(1, 0.9, 0.2) }],
  companies: [{ companyKey: "domain:x.com", invested: money(1, 0.9, 0.2) }],
};

let calls: Array<{ url: string; options: any }>;

/** brand-service answers the org's brands; human/features answer `raw` with `status`. */
function upstream(opts: { orgBrands?: string[]; status?: number; raw?: string } = {}) {
  const { orgBrands = [BRAND], status = 200, raw } = opts;
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    const json = { "content-type": "application/json; charset=utf-8" };
    if (url.startsWith(`${BRAND_BASE}/orgs/brands`)) {
      return new Response(JSON.stringify({ brands: orgBrands.map((id) => ({ id, domain: "x.com" })) }), { status: 200, headers: json });
    }
    const body = raw ?? (url.startsWith(HUMAN_BASE) ? SNAPSHOT_RAW : JSON.stringify(INVESTMENT));
    return new Response(body, { status, headers: json });
  });
}

beforeEach(() => {
  calls = [];
  createRun.mockReset().mockResolvedValue({ id: "run-1" });
});

function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, key));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => k === key || hasKeyDeep(v, key));
  }
  return false;
}

describe.each(["", "/people", "/companies"])("customer — GET /v1/brands/:brandId/audience-snapshot%s", (suffix) => {
  const path = (brand: string) => `/v1/brands/${brand}/audience-snapshot${suffix}`;

  it("own brand: 200, checks ownership under the caller's org, reads human-service scoped to that org, body byte-for-byte", async () => {
    upstream();
    const res = await request(buildApp()).get(`${path(BRAND)}?limit=50&offset=10&acceptedOnly=true`).set(CUSTOMER);

    expect(res.status).toBe(200);
    expect(res.text).toBe(SNAPSHOT_RAW);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands`);
    expect(calls[0].options.headers["x-org-id"]).toBe(ORG);
    expect(calls[1].url).toBe(
      `${HUMAN_BASE}/internal/brands/${BRAND}/audience-snapshot${suffix}?limit=50&offset=10&acceptedOnly=true&orgId=${ORG}`
    );
    expect(calls[1].options.headers["X-API-Key"]).toBe("human-test-key");
  });

  it("a caller-named orgId is dropped: human-service only ever sees the authenticated org", async () => {
    upstream();
    await request(buildApp()).get(`${path(BRAND)}?orgId=${OTHER_ORG}&limit=5`).set(CUSTOMER);
    const humanCall = calls.find((c) => c.url.startsWith(HUMAN_BASE))!;
    expect(humanCall.url).toBe(`${HUMAN_BASE}/internal/brands/${BRAND}/audience-snapshot${suffix}?limit=5&orgId=${ORG}`);
    expect(humanCall.url).not.toContain(OTHER_ORG);
  });

  it("a brand of another org: 404 brand_not_in_org and no human-service read", async () => {
    upstream({ orgBrands: [BRAND] });
    const res = await request(buildApp()).get(path(FOREIGN_BRAND)).set(CUSTOMER);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("brand_not_in_org");
    expect(calls.filter((c) => c.url.startsWith(HUMAN_BASE))).toHaveLength(0);
  });

  it("passes human-service's 400 through with its status and body", async () => {
    const raw = '{"error":"limit must be <= 200"}';
    upstream({ status: 400, raw });
    const res = await request(buildApp()).get(`${path(BRAND)}?limit=9999`).set(CUSTOMER);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(JSON.parse(raw));
  });

  it("refuses a call with no credentials (401) and reads nothing", async () => {
    upstream();
    const res = await request(buildApp()).get(path(BRAND));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe.each(["", "/people", "/companies"])("customer — GET /v1/brands/:brandId/sourcing-investment%s", (suffix) => {
  const path = (brand: string) => `/v1/brands/${brand}/sourcing-investment${suffix}`;

  it("own brand: 200 under the caller's org, query forwarded verbatim, no vendorUsd anywhere, net figures intact", async () => {
    upstream();
    const res = await request(buildApp())
      .get(`${path(BRAND)}?limit=500&apolloPersonIds=a,b&companyKeys=domain:x.com`)
      .set(CUSTOMER);

    expect(res.status).toBe(200);
    expect(hasKeyDeep(res.body, "vendorUsd")).toBe(false);
    expect(res.text).not.toContain("vendorUsd");
    expect(res.body.total).toEqual({ billedUsd: 10, netUsd: 9, unpricedBilledUsd: 0 });
    expect(res.body.audiences[0].invested.netUsd).toBe(9);
    expect(res.body.people[0].invested.netUsd).toBe(0.9);
    expect(res.body.peopleWithoutCompany.invested).toEqual({ billedUsd: 1, netUsd: 1, unpricedBilledUsd: 0 });

    const featuresCall = calls.find((c) => c.url.startsWith(FEATURES_BASE))!;
    expect(featuresCall.url).toBe(
      `${FEATURES_BASE}/brands/${BRAND}/sourcing-investment${suffix}?limit=500&apolloPersonIds=a,b&companyKeys=domain:x.com`
    );
    expect(featuresCall.options.headers["x-org-id"]).toBe(ORG);
    expect(featuresCall.options.headers["x-user-id"]).toBe(USER);
    expect(featuresCall.options.headers["X-API-Key"]).toBe("features-test-key");
  });

  it("a brand of another org: 404 brand_not_in_org and no features-service read", async () => {
    upstream({ orgBrands: [BRAND] });
    const res = await request(buildApp()).get(path(FOREIGN_BRAND)).set(CUSTOMER);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("brand_not_in_org");
    expect(calls.filter((c) => c.url.startsWith(FEATURES_BASE))).toHaveLength(0);
  });

  it("passes features-service's 400 through with its status and body", async () => {
    const raw = '{"error":"limit must be between 1 and 500"}';
    upstream({ status: 400, raw });
    const res = await request(buildApp()).get(`${path(BRAND)}?limit=9999`).set(CUSTOMER);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(JSON.parse(raw));
  });
});

describe("stripVendorCost", () => {
  it("removes vendorUsd at any depth and leaves every other field", () => {
    const out = stripVendorCost({ a: { vendorUsd: 1, netUsd: 2 }, b: [{ c: { vendorUsd: null, d: 3 } }], vendorUsd: 0 });
    expect(out).toEqual({ a: { netUsd: 2 }, b: [{ c: { d: 3 } }] });
  });
});
