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

const BODY = { topup_amount_cents: 1000, auto_topup_amount_cents: 1000 };
const RULES = {
  org_id: "org-1",
  first_topup_minimum_cents: 1000,
  reload_amount_minimum_cents: 1000,
  default_reload_amount_cents: 1000,
};

describe("POST /v1/billing/accounts/prepaid_checkout", () => {
  // RELOAD-RULE-ONE-HOME-1118: billing owns every minimum; the gateway checks none.
  it("forwards an amount under the minimum to billing and relays its 400 verbatim", async () => {
    const refusal = { error: "auto_topup_amount_cents must be at least 1000", code: "reload_below_minimum", minimum_cents: 1000 };
    stubFetch(400, refusal);
    const res = await request(buildApp())
      .post("/v1/billing/accounts/prepaid_checkout")
      .send({ ...BODY, auto_topup_amount_cents: 999 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(refusal);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.auto_topup_amount_cents).toBe(999);
  });

  it("sends no reload figure and no threshold when the caller sends none (billing applies its own)", async () => {
    stubFetch(200, { url: "u" });
    const res = await request(buildApp()).post("/v1/billing/accounts/prepaid_checkout").send({ topup_amount_cents: 1000 });
    expect(res.status).toBe(200);
    expect(calls[0].body).not.toHaveProperty("auto_topup_amount_cents");
    expect(calls[0].body).not.toHaveProperty("auto_topup_threshold_cents");
  });

  it("passes a larger reload the person chose ($50) through untouched", async () => {
    stubFetch(200, { url: "u" });
    await request(buildApp()).post("/v1/billing/accounts/prepaid_checkout").send({ ...BODY, auto_topup_amount_cents: 5000 });
    expect(calls[0].body.auto_topup_amount_cents).toBe(5000);
  });

  it("the prepay instructions quote billing's rules, and hold no figure when billing could not be read", () => {
    const how = prepayInstructions(RULES);
    expect(how.minimums_cents).toEqual({ topup_amount_cents: 1000, auto_topup_amount_cents: 1000 });
    expect(how.defaults_cents).toEqual({ auto_topup_amount_cents: 1000 });
    expect(how.example_body).toEqual({ topup_amount_cents: 1000 });
    const blind = prepayInstructions(null);
    expect(blind.minimums_cents).toBeNull();
    expect(blind.defaults_cents).toBeNull();
    expect(blind.example_body).toEqual({});
    expect(blind.rules_path).toBe("/v1/billing/accounts/reload_rules");
  });

  // Owner 2026-11-18: the threshold is $0 for everyone, changeable nowhere.
  it("the prepay instructions never name a threshold, even when billing still serves one", () => {
    const how = prepayInstructions({ ...RULES, reload_threshold_minimum_cents: 0, default_reload_threshold_cents: 0 } as any);
    expect(JSON.stringify(how)).not.toMatch(/threshold/i);
  });

  it("forwards to billing with the org identity and default return pages, answer verbatim", async () => {
    const upstream = { url: "https://checkout.stripe.com/c/pay/cs_test", session_id: "cs_test", org_id: "org-1", payment_mode: "prepaid" };
    stubFetch(200, upstream);

    const res = await request(buildApp()).post("/v1/billing/accounts/prepaid_checkout").send(BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/prepaid_checkout`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["x-org-id"]).toBe("org-1");
    expect(calls[0].headers["x-user-id"]).toBe("user-1");
    expect(calls[0].headers["x-run-id"]).toBe("run-1");
    expect(calls[0].body).toEqual({
      ...BODY,
      success_url: "https://distribute.you/?prepaid=paid",
      cancel_url: "https://distribute.you/?prepaid=cancelled",
    });
  });

  it("keeps the caller's own return pages and any other field", async () => {
    stubFetch(200, { url: "u" });
    await request(buildApp())
      .post("/v1/billing/accounts/prepaid_checkout")
      .send({ ...BODY, topup_amount_cents: 5000, success_url: "https://a.example/ok", cancel_url: "https://a.example/no", consent: { x: 1 } });

    expect(calls[0].body).toEqual({
      ...BODY,
      topup_amount_cents: 5000,
      success_url: "https://a.example/ok",
      cancel_url: "https://a.example/no",
      consent: { x: 1 },
    });
  });

  it("forwards billing's 409 status and body", async () => {
    const refusal = { error: "This organization pays by subscription; prepaid checkout is not available.", code: "subscription_mode" };
    stubFetch(409, refusal);
    const res = await request(buildApp()).post("/v1/billing/accounts/prepaid_checkout").send(BODY);
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
