import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BILLING_BASE, DOWN_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE, DOWN_BASE: "http://brand.test.local" };
});

import { agentPaymentRequired } from "../../src/middleware/payment-required.js";
import { callExternalService } from "../../src/lib/service-client.js";
import { respondUpstreamError } from "../../src/lib/upstream-error.js";

const DOWNSTREAM_402 = { error: "Insufficient credits", balance_cents: 0, required_cents: 12 };

/**
 * Two route shapes found in this gateway: one that forwards the upstream status
 * (respondUpstreamError), one that masks every failure as a 500. Identity is set
 * by a stand-in for `authenticate` so the test can vary the caller.
 */
function buildApp(identity: { authType: "user_key" | "admin"; orgId?: string }) {
  const app = express();
  app.use(express.json());
  app.use(agentPaymentRequired);
  app.use((req: any, _res, next) => {
    req.authType = identity.authType;
    req.orgId = identity.orgId;
    req.userId = "user-1";
    req.runId = "run-1";
    next();
  });
  const down = { url: DOWN_BASE, apiKey: "k" };
  app.post("/forwarding", async (_req, res) => {
    try {
      res.json(await callExternalService(down, "/paid", { method: "POST" }));
    } catch (error) {
      respondUpstreamError(res, error, "failed");
    }
  });
  app.post("/masking", async (_req, res) => {
    try {
      res.json(await callExternalService(down, "/paid", { method: "POST" }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/not-found", async (_req, res) => {
    try {
      res.json(await callExternalService(down, "/missing"));
    } catch (error) {
      respondUpstreamError(res, error, "failed");
    }
  });
  app.get("/free", (_req, res) => res.json({ ok: true }));
  return app;
}

let billingCalls: number;

function stubFetch(offer: string | "billing_down") {
  global.fetch = vi.fn(async (input: any) => {
    const url = String(input);
    if (url === `${DOWN_BASE}/paid`) {
      return new Response(JSON.stringify(DOWNSTREAM_402), { status: 402, headers: { "content-type": "application/json" } });
    }
    if (url === `${DOWN_BASE}/missing`) {
      return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
    }
    if (url === `${BILLING_BASE}/v1/accounts/prepaid_status`) {
      billingCalls += 1;
      if (offer === "billing_down") return new Response("boom", { status: 502 });
      return new Response(
        JSON.stringify({ state: "awaiting_payment", free_credit_offer: offer, balance_cents: "0", card: { not_reloadable_reason: "no_saved_card" } }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as any;
}

beforeEach(() => {
  billingCalls = 0;
});

describe("agentPaymentRequired", () => {
  it("answers an agent org's refused paid call with a legible 402 naming the prepay route", async () => {
    stubFetch("agent_api");
    const res = await request(buildApp({ authType: "user_key", orgId: "org-1" })).post("/forwarding");

    expect(res.status).toBe(402);
    expect(res.headers.link).toBe('</v1/billing/accounts/prepaid_checkout>; rel="payment"');
    expect(res.body).toMatchObject({
      error: "payment_required",
      code: "payment_required",
      balance_cents: "0",
      prepaid_state: "awaiting_payment",
      prepay: {
        method: "POST",
        path: "/v1/billing/accounts/prepaid_checkout",
        minimums_cents: { topup_amount_cents: 1000, auto_topup_amount_cents: 1500, auto_topup_threshold_cents: 500 },
        status_path: "/v1/billing/accounts/prepaid_status",
      },
      upstream: DOWNSTREAM_402,
    });
    expect(res.body.message).toContain("POST /v1/billing/accounts/prepaid_checkout");
  });

  it("recovers the 402 a route masked as a 500, for an agent org", async () => {
    stubFetch("agent_api");
    const res = await request(buildApp({ authType: "user_key", orgId: "org-1" })).post("/masking");

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("payment_required");
    expect(res.body.upstream).toEqual(DOWNSTREAM_402);
  });

  it("leaves every other org's answer exactly as it was", async () => {
    stubFetch("match_100");
    const app = buildApp({ authType: "user_key", orgId: "org-1" });

    const forwarded = await request(app).post("/forwarding");
    expect(forwarded.status).toBe(402);
    expect(forwarded.body).toEqual(DOWNSTREAM_402);
    expect(forwarded.headers.link).toBeUndefined();

    const masked = await request(app).post("/masking");
    expect(masked.status).toBe(500);
    expect(masked.body).toEqual({ error: JSON.stringify(DOWNSTREAM_402) });
  });

  it("never touches a platform-key (dashboard) call, not even reading billing", async () => {
    stubFetch("agent_api");
    const res = await request(buildApp({ authType: "admin", orgId: "org-1" })).post("/forwarding");

    expect(res.status).toBe(402);
    expect(res.body).toEqual(DOWNSTREAM_402);
    expect(billingCalls).toBe(0);
  });

  it("does not read billing for a success or a failure that is not about payment", async () => {
    stubFetch("agent_api");
    const app = buildApp({ authType: "user_key", orgId: "org-1" });

    expect((await request(app).get("/free")).status).toBe(200);
    const notFound = await request(app).post("/not-found");
    expect(notFound.status).toBe(404);
    expect(billingCalls).toBe(0);
  });

  it("answers the route's own response when billing cannot be read", async () => {
    stubFetch("billing_down");
    const res = await request(buildApp({ authType: "user_key", orgId: "org-1" })).post("/forwarding");

    expect(res.status).toBe(402);
    expect(res.body).toEqual(DOWNSTREAM_402);
    expect(billingCalls).toBe(1);
  });
});
