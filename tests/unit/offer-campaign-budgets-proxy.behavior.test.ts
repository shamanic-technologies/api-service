import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE };
});

/** Per-campaign budgets of an offer — passthrough to billing-service /v1/brands/:b/offers/:o/campaign-budgets. */
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
const OFFER_ID = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const PATH = `/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/campaign-budgets`;
const UPSTREAM = { items: [{ featureSlug: "cold-email", legKey: "entry", budgetCents: 500 }] };
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

describe("offer campaign-budgets proxies", () => {
  it("GET forwards to billing's exact path with the authenticated org and user, body untouched", async () => {
    const res = await request(buildApp()).get(PATH).set("x-org-id", "org_spoofed");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM);
    expect(calls[0].url).toBe(`${BILLING_BASE}${PATH}`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
  });

  it("GET forwards the campaigns query verbatim", async () => {
    const qs = "?campaigns=cold-email%3Aentry,linkedin:reactive";
    await request(buildApp()).get(`${PATH}${qs}`);
    expect(calls[0].url).toBe(`${BILLING_BASE}${PATH}${qs}`);
  });

  it("PUT forwards the body byte-identical and returns billing's body", async () => {
    const body = { items: [{ featureSlug: "cold-email", legKey: "entry", budgetCents: 500, extra: "kept" }] };
    const res = await request(buildApp()).put(PATH).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM);
    expect(calls[0].url).toBe(`${BILLING_BASE}${PATH}`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("DELETE forwards featureSlug and legKey verbatim, URL-encoding intact", async () => {
    const qs = "?featureSlug=cold-email%2Bv2&legKey=entry%20leg";
    const res = await request(buildApp()).delete(`${PATH}${qs}`);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BILLING_BASE}${PATH}${qs}`);
    expect(calls[0].options.method).toBe("DELETE");
  });

  it.each([
    [400, { error: "Below the minimum", code: "below_minimum", featureSlug: "cold-email", legKey: "entry", minimumCents: 1000 }],
    [409, { error: "No plan for this offer", code: "no_plan_for_offer", offerId: "x" }],
    [502, { error: "Minimums unavailable", code: "minimums_unavailable" }],
  ])("relays billing's %i with its body field-for-field", async (status, body) => {
    stubFetch(status, body);
    const res = await request(buildApp()).put(PATH).send({ items: [] });
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
  });

  it("relays a DELETE refusal verbatim", async () => {
    stubFetch(400, { error: "featureSlug and legKey are required", code: "invalid_items" });
    const res = await request(buildApp()).delete(PATH);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "featureSlug and legKey are required", code: "invalid_items" });
    expect(calls[0].url).toBe(`${BILLING_BASE}${PATH}`);
  });
});
