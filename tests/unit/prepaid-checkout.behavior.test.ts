import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE };
});

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user-1";
      req.orgId = "org-1";
      req.runId = "run-1";
      req.authType = "user_key";
      next();
    },
  };
});

import prepaidRouter from "../../src/routes/prepaid.js";
import { prepayInstructions } from "../../src/lib/agent-prepay.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", prepaidRouter);
  return app;
}

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
let calls: Call[];

function stubFetch(status: number, body: unknown) {
  global.fetch = vi.fn(async (input: any, init: any) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as any;
}

beforeEach(() => {
  calls = [];
});

const AT_MINIMUMS = { topup_amount_cents: 1000, auto_topup_amount_cents: 1000, auto_topup_threshold_cents: 500 };

describe("POST /v1/billing/accounts/prepaid_checkout", () => {
  it.each([
    ["topup_amount_cents", { ...AT_MINIMUMS, topup_amount_cents: 999 }, 1000],
    ["auto_topup_amount_cents", { ...AT_MINIMUMS, auto_topup_amount_cents: 999 }, 1000],
    ["auto_topup_threshold_cents", { ...AT_MINIMUMS, auto_topup_threshold_cents: 499 }, 500],
  ])("refuses %s below its minimum with a named error, calling nothing", async (field, body, minimum) => {
    stubFetch(200, {});
    const res = await request(buildApp()).post("/v1/billing/accounts/prepaid_checkout").send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "amount_below_minimum", code: "amount_below_minimum", field, minimum_cents: minimum });
    expect(res.body.message).toContain(field);
    expect(calls).toHaveLength(0);
  });

  // AGENT-RELOAD-10-1117, owner 2026-11-11: « +10 dès qu'on arrive sous $5 ».
  // Prod 2026-11-17 a lead's link with topup 1000 / threshold 500 / reload 1000 was
  // refused "must be at least 1500 ($15.00)". A $10 reload is accepted, $9.99 is not.
  it("accepts a $10 reload (topup 1000, threshold 500, reload 1000) and returns the payment url", async () => {
    stubFetch(200, { url: "https://checkout.stripe.com/c/pay/cs_10" });
    const res = await request(buildApp())
      .post("/v1/billing/accounts/prepaid_checkout")
      .send({ topup_amount_cents: 1000, auto_topup_threshold_cents: 500, auto_topup_amount_cents: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://checkout.stripe.com/c/pay/cs_10");
    expect(calls).toHaveLength(1);
    expect(calls[0].body.auto_topup_amount_cents).toBe(1000);
  });

  it("refuses a 999-cent reload naming the $10 minimum", async () => {
    stubFetch(200, {});
    const res = await request(buildApp())
      .post("/v1/billing/accounts/prepaid_checkout")
      .send({ topup_amount_cents: 1000, auto_topup_threshold_cents: 500, auto_topup_amount_cents: 999 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "amount_below_minimum", field: "auto_topup_amount_cents", minimum_cents: 1000 });
    expect(res.body.message).toContain("$10.00");
    expect(calls).toHaveLength(0);
  });

  it("the prepay instructions an agent reads default the reload to 1000 cents ($10)", () => {
    const how = prepayInstructions();
    expect(how.minimums_cents.auto_topup_amount_cents).toBe(1000);
    expect(how.example_body.auto_topup_amount_cents).toBe(1000);
  });

  it("refuses a missing or fractional amount as invalid_amount", async () => {
    stubFetch(200, {});
    const missing = await request(buildApp())
      .post("/v1/billing/accounts/prepaid_checkout")
      .send({ topup_amount_cents: 1000, auto_topup_amount_cents: 1000 });
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ code: "invalid_amount", field: "auto_topup_threshold_cents", minimum_cents: 500 });

    const fractional = await request(buildApp())
      .post("/v1/billing/accounts/prepaid_checkout")
      .send({ ...AT_MINIMUMS, topup_amount_cents: 1000.5 });
    expect(fractional.body).toMatchObject({ code: "invalid_amount", field: "topup_amount_cents" });
    expect(calls).toHaveLength(0);
  });

  it("at the minimums forwards to billing with the org identity and default return pages, answer verbatim", async () => {
    const upstream = { url: "https://checkout.stripe.com/c/pay/cs_test", session_id: "cs_test", org_id: "org-1", payment_mode: "prepaid" };
    stubFetch(200, upstream);

    const res = await request(buildApp()).post("/v1/billing/accounts/prepaid_checkout").send(AT_MINIMUMS);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/prepaid_checkout`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["x-org-id"]).toBe("org-1");
    expect(calls[0].headers["x-user-id"]).toBe("user-1");
    expect(calls[0].headers["x-run-id"]).toBe("run-1");
    expect(calls[0].body).toEqual({
      ...AT_MINIMUMS,
      success_url: "https://distribute.you/?prepaid=paid",
      cancel_url: "https://distribute.you/?prepaid=cancelled",
    });
  });

  it("keeps the caller's own return pages and any other field", async () => {
    stubFetch(200, { url: "u" });
    await request(buildApp())
      .post("/v1/billing/accounts/prepaid_checkout")
      .send({ ...AT_MINIMUMS, topup_amount_cents: 5000, success_url: "https://a.example/ok", cancel_url: "https://a.example/no", consent: { x: 1 } });

    expect(calls[0].body).toEqual({
      ...AT_MINIMUMS,
      topup_amount_cents: 5000,
      success_url: "https://a.example/ok",
      cancel_url: "https://a.example/no",
      consent: { x: 1 },
    });
  });

  it("forwards billing's 409 status and body", async () => {
    const refusal = { error: "This organization pays by subscription; prepaid checkout is not available.", code: "subscription_mode" };
    stubFetch(409, refusal);
    const res = await request(buildApp()).post("/v1/billing/accounts/prepaid_checkout").send(AT_MINIMUMS);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(refusal);
  });
});

describe("GET /v1/billing/accounts/prepaid_status", () => {
  it("forwards to billing with the org identity, body verbatim", async () => {
    const upstream = { org_id: "org-1", state: "awaiting_payment", balance_cents: "0", card: { saved: false, reloadable: false, not_reloadable_reason: "no_saved_card" } };
    stubFetch(200, upstream);

    const res = await request(buildApp()).get("/v1/billing/accounts/prepaid_status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/prepaid_status`);
    expect(calls[0].headers["x-org-id"]).toBe("org-1");
  });
});
