import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load: set it before the router import.
const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE };
});

/**
 * POST /v1/billing/accounts/pay_balance — the postpaid "Pay $X now" button.
 * A pure pass-through: billing-service's status AND body (code, owed_cents) must
 * reach the dashboard verbatim on success and on every refusal. Payloads are
 * FIXTURES of billing-service's shapes (billing-service PR #782), not owned here.
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

let calls: Array<{ url: string; options: any }>;

function stubUpstream(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    };
  });
}

beforeEach(() => {
  calls = [];
});

describe("POST /v1/billing/accounts/pay_balance — success", () => {
  it("forwards billing's 200 body unchanged", async () => {
    const success = {
      charged_cents: 12345,
      account: { org_id: "org_test456", billing_mode: "postpaid", credit_balance_cents: 0 },
    };
    stubUpstream(200, success);

    const res = await request(buildApp()).post("/v1/billing/accounts/pay_balance");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(success);
  });

  it("calls billing's real path once, POST, with the authenticated identity headers", async () => {
    stubUpstream(200, { charged_cents: 100, account: {} });

    await request(buildApp()).post("/v1/billing/accounts/pay_balance");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/pay_balance`);
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
  });
});

describe("POST /v1/billing/accounts/pay_balance — every refusal reaches the caller verbatim", () => {
  const refusals: Array<{ status: number; body: Record<string, unknown> }> = [
    { status: 402, body: { error: "Your card was declined", code: "charge_declined", owed_cents: 12345 } },
    {
      status: 409,
      body: { error: "Balance below the minimum charge", code: "balance_below_minimum_charge", owed_cents: 30 },
    },
    { status: 409, body: { error: "Not a postpaid account", code: "not_postpaid", owed_cents: 0 } },
    { status: 429, body: { error: "Too soon after a failed charge", code: "charge_backoff" } },
    { status: 502, body: { error: "stripe-service unreachable", code: "upstream_error" } },
    { status: 404, body: { error: "Account not found" } },
  ];

  for (const { status, body } of refusals) {
    it(`${status} ${body.code ?? "no account"} keeps its status, code and owed_cents`, async () => {
      stubUpstream(status, body);

      const res = await request(buildApp()).post("/v1/billing/accounts/pay_balance");

      expect(res.status).toBe(status);
      expect(res.body).toEqual(body);
      expect(res.body.code).toBe(body.code);
      expect(res.body.owed_cents).toBe(body.owed_cents);
      // A charge is a write: the gateway never retries it.
      expect(calls).toHaveLength(1);
    });
  }
});
