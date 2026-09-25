import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE };
});

/**
 * Per-campaign (offer × leg × channel) daily budgets — behavioural cover for the three
 * billing-service #500 proxies. Real router + stubbed fetch: full forwarded URL (query
 * verbatim), authenticated org, byte-identical body both ways.
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

import billingRouter from "../../src/routes/billing.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", billingRouter);
  return app;
}

const BRAND_ID = "7f9c2b1e-3d4a-4c5b-9e6f-0a1b2c3d4e5f";
const UPSTREAM = { brandId: BRAND_ID, dailyBudgetCents: "2500", campaigns: [{ offerId: "o1", legKey: "l", featureSlug: "f" }] };

let calls: Array<{ url: string; options: any }>;

function stubFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    if (status >= 200 && status < 300) {
      return { ok: true, status, json: () => Promise.resolve(body) };
    }
    return { ok: false, status, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) };
  });
}

beforeEach(() => {
  calls = [];
  stubFetch(200, UPSTREAM);
});

describe("GET /v1/brands/:brandId/campaign-budgets", () => {
  it("forwards to billing's real path with the authenticated org, body untouched", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/campaign-budgets`).set("x-org-id", "other");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/campaign-budgets`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });
});

describe("GET /v1/brands/:brandId/campaign-budget", () => {
  it("forwards the query string verbatim", async () => {
    const qs = "?offerId=o%201&legKey=reply_meeting&featureSlug=sales-cold-email&future=x";
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/campaign-budget${qs}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/campaign-budget${qs}`);
  });

  it("forwards billing's 400 on a missing key part verbatim", async () => {
    stubFetch(400, { error: "offerId required", details: { field: "offerId" } });
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/campaign-budget`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "offerId required", details: { field: "offerId" } });
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/campaign-budget`);
  });
});

describe("PUT /v1/brands/:brandId/campaign-budget", () => {
  it("forwards the body byte-identical and returns billing's body", async () => {
    const body = { offerId: "o1", legKey: "reply_meeting", featureSlug: "sales-cold-email", dailyBudgetCents: 500, extra: 1 };
    const res = await request(buildApp()).put(`/v1/brands/${BRAND_ID}/campaign-budget`).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/campaign-budget`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it("rejects a non-UUID brand id without calling billing", async () => {
    const res = await request(buildApp()).put("/v1/brands/nope/campaign-budget").send({});
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
