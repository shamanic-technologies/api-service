import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the router import.
const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { BILLING_BASE };
});

/**
 * Subscription payment mode — over the wire.
 *
 * Customer routes (`authenticate` mocked to a resolved identity): the org reaching
 * billing is the authenticated one, the body goes through untouched, and billing's
 * 409 settle refusal reaches the dashboard field-for-field.
 *
 * Staff routes use the REAL `authenticatePlatform` + `requireStaff` (no mock on
 * either), so the gate assertions are about the shipped middleware.
 *
 * Per CLAUDE.md #6/#8 what is asserted is the forwarded path + byte-identical
 * body — the payloads below are fixtures, not a contract this repo owns.
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

const TARGET_ORG = "0b2d6f1e-3c4a-4d5e-8f60-718293a4b5c6";
const REFUSAL = { error: "This org already has an active subscription", code: "subscription_already_active" };

let calls: Array<{ url: string; options: any }>;

function upstreamOk(body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: () => Promise.resolve(body) };
  });
}

function upstreamFail(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return {
      ok: false,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    };
  });
}

beforeEach(() => {
  calls = [];
});


function expectCustomerIdentity(options: any) {
  expect(options.headers["x-org-id"]).toBe("org_test456");
  expect(options.headers["x-user-id"]).toBe("user_test123");
  expect(options.headers["x-run-id"]).toBe("run_test789");
}

describe("customer — /v1/billing/accounts/subscription*", () => {
  it("GET forwards to billing's path with the authenticated identity and returns the body unchanged", async () => {
    const body = { org_id: "org_test456", payment_mode: "subscription", subscription: { status: "trialing" }, future: [1] };
    upstreamOk(body);

    const res = await request(buildApp())
      .get("/v1/billing/accounts/subscription")
      .set("x-org-id", "someone-elses-org");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/subscription`);
    expect(calls[0].options.method).toBe("GET");
    expectCustomerIdentity(calls[0].options);
  });

  it("POST checkout_session forwards the body byte-identical", async () => {
    const body = {
      monthly_amount_cents: 9900,
      currency: "usd",
      trial_days: 3,
      card_required: true,
      card_setup: { mode: "embedded_widget", token: "tok_1" },
    };
    upstreamOk(body);
    const sent = { ui_mode: "hosted", return_url: "https://a", monthly_amount_cents: 9900, future_field: 1 };

    const res = await request(buildApp()).post("/v1/billing/accounts/subscription/checkout_session").send(sent);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/subscription/checkout_session`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(sent);
    expectCustomerIdentity(calls[0].options);
  });

  it("POST checkout_session with an EMPTY body is not refused locally (billing defaults to embedded)", async () => {
    upstreamOk({ monthly_amount_cents: 9900, card_required: false, card_setup: null });
    const res = await request(buildApp()).post("/v1/billing/accounts/subscription/checkout_session").send({});
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/subscription/checkout_session`);
  });

  it("POST checkout_session forwards billing's 409 {error, code} byte-equal", async () => {
    upstreamFail(409, REFUSAL);
    const res = await request(buildApp()).post("/v1/billing/accounts/subscription/checkout_session").send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual(REFUSAL);
  });

  it("POST start forwards to billing's start path: method, identity headers, body byte-identical, body back unchanged", async () => {
    const body = { org_id: "org_test456", payment_mode: "subscription", subscription: { status: "trialing" }, future: [2] };
    upstreamOk(body);
    const sent = { monthly_amount_cents: 19900, future_field: "x" };

    const res = await request(buildApp())
      .post("/v1/billing/accounts/subscription/start")
      .set("x-org-id", "someone-elses-org")
      .send(sent);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/subscription/start`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(sent);
    expectCustomerIdentity(calls[0].options);
  });

  it("POST start with an EMPTY body is not refused locally", async () => {
    upstreamOk({ subscription: { status: "trialing" } });
    const res = await request(buildApp()).post("/v1/billing/accounts/subscription/start").send({});
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/subscription/start`);
    expect(JSON.parse(calls[0].options.body)).toEqual({});
  });

  for (const refusal of [
    { error: "Save a card before starting the subscription", code: "card_required" },
    { error: "Your card was declined", code: "first_charge_declined" },
  ]) {
    it(`POST start forwards billing's 409 ${refusal.code} byte-equal`, async () => {
      upstreamFail(409, refusal);
      const res = await request(buildApp()).post("/v1/billing/accounts/subscription/start").send({});
      expect(res.status).toBe(409);
      expect(res.body).toEqual(refusal);
    });
  }

  it("POST start forwards billing's 400 and 502 verbatim", async () => {
    upstreamFail(400, { error: "monthly_amount_cents must be 9900 + a multiple of 10000" });
    let res = await request(buildApp()).post("/v1/billing/accounts/subscription/start").send({ monthly_amount_cents: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "monthly_amount_cents must be 9900 + a multiple of 10000" });
    upstreamFail(502, { error: "Failed to start the subscription" });
    res = await request(buildApp()).post("/v1/billing/accounts/subscription/start").send({});
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Failed to start the subscription" });
  });

  it("PATCH forwards the body byte-identical, and billing's 400 verbatim", async () => {
    upstreamFail(400, { error: "monthly_amount_cents must be 9900 + a multiple of 10000 ($99, $199, $299, ...)" });
    const res = await request(buildApp()).patch("/v1/billing/accounts/subscription").send({ monthly_amount_cents: 12345 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "monthly_amount_cents must be 9900 + a multiple of 10000 ($99, $199, $299, ...)" });
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/subscription`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ monthly_amount_cents: 12345 });
    expectCustomerIdentity(calls[0].options);
  });

  for (const action of ["cancel", "resume"]) {
    it(`POST ${action} forwards to billing's ${action} path and returns the body unchanged`, async () => {
      const body = { org_id: "org_test456", subscription: { status: action === "cancel" ? "canceling" : "active" } };
      upstreamOk(body);
      const res = await request(buildApp()).post(`/v1/billing/accounts/subscription/${action}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(body);
      expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/subscription/${action}`);
      expect(calls[0].options.method).toBe("POST");
      expectCustomerIdentity(calls[0].options);
    });

    it(`POST ${action} forwards billing's 409 {error, code} byte-equal`, async () => {
      const refusal = { error: "No subscription to change", code: "no_subscription" };
      upstreamFail(409, refusal);
      const res = await request(buildApp()).post(`/v1/billing/accounts/subscription/${action}`);
      expect(res.status).toBe(409);
      expect(res.body).toEqual(refusal);
    });
  }

  it("forwards billing's 502 verbatim", async () => {
    upstreamFail(502, { error: "Failed to read the subscription" });
    const res = await request(buildApp()).get("/v1/billing/accounts/subscription");
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Failed to read the subscription" });
  });
});

describe("staff — /v1/billing/accounts/by-org/:orgId/subscription", () => {
  const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" };

  it("GET forwards to billing's internal by-org path for the NAMED org, no identity headers", async () => {
    const body = { org_id: TARGET_ORG, payment_mode: "subscription", subscription: null };
    upstreamOk(body);

    const res = await request(buildApp()).get(`/v1/billing/accounts/by-org/${TARGET_ORG}/subscription`).set(STAFF);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(`${BILLING_BASE}/internal/accounts/by-org/${TARGET_ORG}/subscription`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["X-API-Key"]).toBe("billing-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
    expect(calls[0].options.headers["x-user-id"]).toBeUndefined();
  });

  it("forwards billing's 404 verbatim", async () => {
    upstreamFail(404, { error: "Billing account not found" });
    const res = await request(buildApp()).get(`/v1/billing/accounts/by-org/${TARGET_ORG}/subscription`).set(STAFF);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Billing account not found" });
  });

  it("refuses the platform key without a staff email (403)", async () => {
    upstreamOk({});
    const res = await request(buildApp())
      .get(`/v1/billing/accounts/by-org/${TARGET_ORG}/subscription`)
      .set("X-API-Key", "admin-test-key")
      .set("x-email", "customer@example.com");
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a wrong platform key (401)", async () => {
    upstreamOk({});
    const res = await request(buildApp())
      .get(`/v1/billing/accounts/by-org/${TARGET_ORG}/subscription`)
      .set("X-API-Key", "nope")
      .set("x-email", "kevin@distribute.you");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("staff payment-mode PUT passes \"subscription\" through unchanged", () => {
  it("does not validate the payment_mode vocabulary locally", async () => {
    upstreamOk({ org_id: TARGET_ORG, payment_mode: "subscription" });
    const res = await request(buildApp())
      .put(`/v1/billing/accounts/by-org/${TARGET_ORG}/payment-mode`)
      .set({ "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" })
      .send({ payment_mode: "subscription" });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BILLING_BASE}/internal/accounts/by-org/${TARGET_ORG}/payment-mode`);
    expect(JSON.parse(calls[0].options.body)).toEqual({ payment_mode: "subscription" });
  });
});
