import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE };
});

/** A brand's global sales budget — passthrough to billing-service /v1/brands/:id/sales-budget. */
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
const UPSTREAM = { brandId: BRAND_ID, mode: "global", dailyBudgetCents: "2000.0000000000", updatedAt: "x" };
let calls: Array<{ url: string; options: any }>;

function stubFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    if (status >= 200 && status < 300) return { ok: true, status, json: () => Promise.resolve(body) };
    return { ok: false, status, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) };
  });
}

beforeEach(() => {
  calls = [];
  stubFetch(200, UPSTREAM);
});

describe("sales-budget proxies", () => {
  it("GET forwards with the authenticated org, body untouched", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/sales-budget`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/sales-budget`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("PUT forwards the body byte-identical", async () => {
    const body = { dailyBudgetCents: 2000 };
    const res = await request(buildApp()).put(`/v1/brands/${BRAND_ID}/sales-budget`).send(body);
    expect(res.status).toBe(200);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it("DELETE and history forward to billing's real paths", async () => {
    await request(buildApp()).delete(`/v1/brands/${BRAND_ID}/sales-budget`);
    expect(calls[0].options.method).toBe("DELETE");
    await request(buildApp()).get(`/v1/brands/${BRAND_ID}/sales-budget/history`);
    expect(calls[1].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/sales-budget/history`);
  });

  it("forwards billing's 400 verbatim and rejects a non-UUID brand locally", async () => {
    stubFetch(400, { error: "dailyBudgetCents must be non-negative" });
    const res = await request(buildApp()).put(`/v1/brands/${BRAND_ID}/sales-budget`).send({ dailyBudgetCents: -1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "dailyBudgetCents must be non-negative" });
    const bad = await request(buildApp()).get("/v1/brands/nope/sales-budget");
    expect(bad.status).toBe(400);
  });
});
