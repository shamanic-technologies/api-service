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
 * DELETE /v1/billing/accounts/saved_payment_method — a customer stops us holding
 * their card, from their own billing page.
 *
 * Three properties, none of them visible in a source-substring test:
 *   1. the org whose card goes is the AUTHENTICATED one — a caller cannot name
 *      someone else's;
 *   2. billing-service's body reaches the caller field-for-field, including the
 *      settlement counters the page renders (CLAUDE.md #7/#8);
 *   3. the gateway refuses nobody and retries nothing — whether removal is
 *      allowed is billing-service's decision, and it allows everybody.
 * Payloads below are FIXTURES of billing-service's shapes, not a contract this
 * repo owns.
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

const REMOVED = {
  object: "saved_payment_method_removed",
  org_id: "org_test456",
  removed: 1,
  already_removed: 0,
  auto_topup_disarmed: true,
  settled_cents: 1240,
};

beforeEach(() => {
  calls = [];
});

describe("DELETE /v1/billing/accounts/saved_payment_method — the card goes", () => {
  it("returns billing-service's body unchanged", async () => {
    stubUpstream(200, REMOVED);

    const res = await request(buildApp()).delete("/v1/billing/accounts/saved_payment_method");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(REMOVED);
  });

  it("removes the AUTHENTICATED org's card, on billing's real path", async () => {
    stubUpstream(200, REMOVED);

    await request(buildApp())
      // A caller-supplied org must not be able to redirect the removal.
      .delete("/v1/billing/accounts/saved_payment_method?orgId=org_someone_else")
      .set("x-org-id", "org_someone_else");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/saved_payment_method`);
    expect(calls[0].options.method).toBe("DELETE");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].url).not.toContain("org_someone_else");
  });

  it("forwards a field billing adds later without a change here", async () => {
    const withNewField = { ...REMOVED, settle_skip_reason: "nothing_owed", future_field: 7 };
    stubUpstream(200, withNewField);

    const res = await request(buildApp()).delete("/v1/billing/accounts/saved_payment_method");

    expect(res.body).toEqual(withNewField);
  });

  it("refuses nobody of its own accord and retries nothing — one upstream call", async () => {
    // An org with no card and a negative balance: billing allows it, so does the gateway.
    const nothingToRemove = { ...REMOVED, removed: 0, settled_cents: 0, settle_skip_reason: "no_card" };
    stubUpstream(200, nothingToRemove);

    const res = await request(buildApp()).delete("/v1/billing/accounts/saved_payment_method");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(nothingToRemove);
    expect(calls).toHaveLength(1);
  });
});

describe("DELETE /v1/billing/accounts/saved_payment_method — a failure stays a failure", () => {
  const refusals: Array<{ status: number; body: Record<string, unknown> }> = [
    { status: 404, body: { error: "Billing account not found" } },
    { status: 502, body: { error: "Could not remove the saved card" } },
    { status: 500, body: { error: "Internal server error" } },
  ];

  for (const { status, body } of refusals) {
    it(`${status} reaches the caller with its status and its body`, async () => {
      stubUpstream(status, body);

      const res = await request(buildApp()).delete("/v1/billing/accounts/saved_payment_method");

      expect(res.status).toBe(status);
      expect(res.body).toEqual(body);
    });
  }

  it("never reports a failed removal as a success", async () => {
    stubUpstream(502, { error: "Could not remove the saved card" });

    const res = await request(buildApp()).delete("/v1/billing/accounts/saved_payment_method");

    expect(res.status).not.toBe(200);
    expect(res.body.object).toBeUndefined();
  });
});

describe("the published document carries the removal", () => {
  it("documents DELETE /v1/billing/accounts/saved_payment_method with a passthrough response", async () => {
    const { buildDocument } = await import("../../src/openapi/document.js");
    const doc: any = buildDocument();
    const op = doc.paths["/v1/billing/accounts/saved_payment_method"]?.delete;

    expect(op).toBeDefined();
    expect(op.operationId).toBeTruthy();
    const schema = op.responses["200"].content["application/json"].schema;
    const name = schema.$ref?.split("/").pop();
    const resolved = name ? doc.components.schemas[name] : schema;
    // Passthrough: the gateway declares no downstream field (CLAUDE.md #8).
    expect(resolved.properties ?? {}).toEqual({});
  });
});
