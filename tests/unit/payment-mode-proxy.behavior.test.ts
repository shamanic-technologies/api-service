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
 * Payment mode (prepaid | postpaid) — over the wire.
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
const REFUSAL = { error: "Could not settle the outstanding balance", code: "settle_failed", owed_cents: 4210 };

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

describe("customer — /v1/billing/accounts/payment_mode", () => {
  it("GET forwards to billing's path with the authenticated org and returns the body unchanged", async () => {
    const body = { org_id: "org_test456", payment_mode: "postpaid" };
    upstreamOk(body);

    const res = await request(buildApp())
      .get("/v1/billing/accounts/payment_mode")
      .set("x-org-id", "someone-elses-org");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/payment_mode`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("PUT forwards the body byte-identical and returns billing's body unchanged", async () => {
    const body = { org_id: "org_test456", payment_mode: "prepaid", settled_cents: 0, auto_topup_enabled: true };
    upstreamOk(body);

    const res = await request(buildApp())
      .put("/v1/billing/accounts/payment_mode")
      .send({ payment_mode: "prepaid", future_field: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/accounts/payment_mode`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual({ payment_mode: "prepaid", future_field: 1 });
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("PUT forwards billing's 409 settle refusal with status AND body intact", async () => {
    upstreamFail(409, REFUSAL);
    const res = await request(buildApp()).put("/v1/billing/accounts/payment_mode").send({ payment_mode: "prepaid" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(REFUSAL);
  });

  it("PUT forwards billing's 400 verbatim", async () => {
    upstreamFail(400, { error: "Invalid payment_mode" });
    const res = await request(buildApp()).put("/v1/billing/accounts/payment_mode").send({ payment_mode: "weekly" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid payment_mode" });
  });
});

describe("staff — /v1/billing/accounts/by-org/:orgId/payment-mode", () => {
  const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" };

  it("GET forwards to billing's internal by-org path for the NAMED org", async () => {
    const body = { org_id: TARGET_ORG, payment_mode: "postpaid" };
    upstreamOk(body);

    const res = await request(buildApp())
      .get(`/v1/billing/accounts/by-org/${TARGET_ORG}/payment-mode`)
      .set(STAFF);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(`${BILLING_BASE}/internal/accounts/by-org/${TARGET_ORG}/payment-mode`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["X-API-Key"]).toBe("billing-test-key");
  });

  it("PUT forwards the body byte-identical and the 409 refusal intact", async () => {
    upstreamFail(409, REFUSAL);
    const res = await request(buildApp())
      .put(`/v1/billing/accounts/by-org/${TARGET_ORG}/payment-mode`)
      .set(STAFF)
      .send({ payment_mode: "prepaid" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(REFUSAL);
    expect(calls[0].url).toBe(`${BILLING_BASE}/internal/accounts/by-org/${TARGET_ORG}/payment-mode`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual({ payment_mode: "prepaid" });
  });

  it("forwards billing's 404 (no billing account) verbatim", async () => {
    upstreamFail(404, { error: "Billing account not found" });
    const res = await request(buildApp()).get(`/v1/billing/accounts/by-org/${TARGET_ORG}/payment-mode`).set(STAFF);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Billing account not found" });
  });

  it("refuses the platform key without a staff email (403) — customer proxy cannot reach it", async () => {
    upstreamOk({});
    const res = await request(buildApp())
      .put(`/v1/billing/accounts/by-org/${TARGET_ORG}/payment-mode`)
      .set("X-API-Key", "admin-test-key")
      .set("x-email", "customer@example.com")
      .send({ payment_mode: "prepaid" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing / wrong platform key (401)", async () => {
    upstreamOk({});
    const res = await request(buildApp())
      .get(`/v1/billing/accounts/by-org/${TARGET_ORG}/payment-mode`)
      .set("X-API-Key", "nope")
      .set("x-email", "kevin@distribute.you");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("keeps a slash-bearing orgId inside ONE encoded path segment (no traversal to another internal route)", async () => {
    upstreamOk({});
    await request(buildApp())
      .get(`/v1/billing/accounts/by-org/..%2F..%2Fcredits/payment-mode`)
      .set(STAFF);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${BILLING_BASE}/internal/accounts/by-org/..%2F..%2Fcredits/payment-mode`,
    );
  });
});
