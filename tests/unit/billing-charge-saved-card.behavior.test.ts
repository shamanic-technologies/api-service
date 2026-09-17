import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  process.env.STRIPE_SERVICE_URL = "http://stripe.test.local";
  process.env.STRIPE_SERVICE_API_KEY = "stripe-test-key";
  return { BILLING_BASE };
});

/**
 * POST /v1/billing/accounts/charge — the off-session charge the dashboard uses for
 * funnels 2..N of a sell-first onboarding.
 *
 * Two properties are worth a behavioural test and neither can be seen by reading the
 * route file as text:
 *   1. the org charged is the AUTHENTICATED one, put in the downstream path — a caller
 *      cannot name whose card to charge;
 *   2. every refusal keeps billing-service's status AND its `code`, so the consumer can
 *      fall back to hosted checkout on a 402/409 and retry on a 502 without confusing
 *      the two (CLAUDE.md #7).
 * The payloads are FIXTURES of billing-service's shapes, not a contract this repo owns.
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
      text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
      json: () => Promise.resolve(body),
    };
  });
}

const VALID_BODY = { amountCents: 29900, idempotencyKey: "funnel-2-org_test456-1" };

beforeEach(() => {
  calls = [];
});

describe("POST /v1/billing/accounts/charge — success path", () => {
  it("returns billing-service's success body unchanged", async () => {
    const success = { ok: true, charged: true, amountCents: 29900, reference: "pi_123" };
    stubUpstream(200, success);

    const res = await request(buildApp()).post("/v1/billing/accounts/charge").send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(success);
  });

  it("charges the AUTHENTICATED org, on billing's real internal path, body verbatim", async () => {
    stubUpstream(200, { ok: true, charged: true });

    await request(buildApp())
      .post("/v1/billing/accounts/charge")
      // A caller-supplied org must not be able to redirect the charge.
      .send({ ...VALID_BODY, orgId: "org_someone_else" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/internal/accounts/by-org/org_test456/charge`);
    expect(calls[0].url).not.toContain("org_someone_else");
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    // Body is a passthrough — nothing declared here strips a field billing may accept.
    expect(JSON.parse(calls[0].options.body)).toEqual({
      ...VALID_BODY,
      orgId: "org_someone_else",
    });
  });

  it("400s without reaching billing when a required field is missing", async () => {
    stubUpstream(200, { ok: true });

    const res = await request(buildApp())
      .post("/v1/billing/accounts/charge")
      .send({ amountCents: 29900 });

    expect(res.status).toBe(400);
    expect(res.body.missingFields).toEqual(["idempotencyKey"]);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /v1/billing/accounts/charge — every refusal stays distinguishable", () => {
  const refusals: Array<{ status: number; body: Record<string, unknown> }> = [
    { status: 402, body: { error: "Your card was declined", code: "charge_declined" } },
    {
      status: 409,
      body: { error: "No card on file", code: "no_chargeable_payment_method" },
    },
    {
      status: 409,
      body: {
        error: "This card cannot be charged off-session",
        code: "card_not_chargeable_off_session",
        country: "IN",
      },
    },
    {
      status: 429,
      body: { error: "Too soon after a failed charge", code: "charge_backoff", retry_after_s: 900 },
    },
    { status: 502, body: { error: "stripe-service unreachable", code: "upstream_error" } },
  ];

  for (const { status, body } of refusals) {
    it(`${status} ${body.code} reaches the caller with its status and its code`, async () => {
      stubUpstream(status, body);

      const res = await request(buildApp()).post("/v1/billing/accounts/charge").send(VALID_BODY);

      expect(res.status).toBe(status);
      expect(res.body).toEqual(body);
      expect(res.body.code).toBe(body.code);
    });
  }

  it("keeps the two 409 codes apart from each other", async () => {
    const codes: string[] = [];
    for (const refusal of refusals.filter((r) => r.status === 409)) {
      stubUpstream(409, refusal.body);
      const res = await request(buildApp()).post("/v1/billing/accounts/charge").send(VALID_BODY);
      codes.push(res.body.code);
    }
    expect(codes).toEqual(["no_chargeable_payment_method", "card_not_chargeable_off_session"]);
  });

  it("does not retry a 429 on the caller's behalf — one upstream call, answer forwarded", async () => {
    stubUpstream(429, { error: "back off", code: "charge_backoff" });

    const res = await request(buildApp()).post("/v1/billing/accounts/charge").send(VALID_BODY);

    expect(calls).toHaveLength(1);
    expect(res.status).toBe(429);
  });
});
