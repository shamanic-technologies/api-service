import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load: set it BEFORE the router import.
vi.hoisted(() => {
  process.env.BILLING_SERVICE_URL = "http://billing.test.local";
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
});

/**
 * PATCH /v1/billing/accounts/auto_topup needs only the reload amount. The threshold is
 * billing's (owner 2026-11-18: « On mets $0 pour tout le monde. On ne permet pas de
 * changer cette valeur nulle part »), so the dashboard sends none; the gateway must not
 * refuse that body with a 400 of its own.
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
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

let calls: Array<{ url: string; options: any }>;

beforeEach(() => {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    const body = { org_id: "org_test456", has_auto_topup: true };
    return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) };
  });
});

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", billingRouter);
  return a;
}

describe("PATCH /v1/billing/accounts/auto_topup without a threshold", () => {
  it("forwards a body carrying only the reload amount", async () => {
    const res = await request(app()).patch("/v1/billing/accounts/auto_topup").send({ topup_amount_cents: 1000 });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/v1/accounts/auto_topup");
    expect(JSON.parse(calls[0].options.body)).toEqual({ topup_amount_cents: 1000 });
  });

  it("still refuses a body with no reload amount", async () => {
    const res = await request(app()).patch("/v1/billing/accounts/auto_topup").send({});
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
