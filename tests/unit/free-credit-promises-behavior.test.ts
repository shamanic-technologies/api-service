import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE };
});

/**
 * GET /v1/billing/free-credit-promises — BEHAVIOURAL cover for the proxy shipped in #779.
 *
 * `credits-proxy.test.ts` already pins the route's SOURCE (middleware chain, downstream
 * path literal, respondUpstreamError, no reshaping). Source assertions cannot see what
 * actually goes over the wire, so two acceptance criteria were left unverified: that the
 * request carries the org resolved from the authenticated identity (and only that org),
 * and that the upstream body comes back untouched. This file drives the real router with
 * supertest and a stubbed fetch to assert both.
 *
 * Per CLAUDE.md #6/#8, what is asserted is the forwarded path + the byte-identical body,
 * NOT billing's field names — the payload below is a fixture, not a contract this repo owns.
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

import creditsRouter from "../../src/routes/credits.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", creditsRouter);
  return app;
}

// An org holding two promises at different bars — one opened by a referral it made
// (referred_org_id set), one it received (referrer_org_id set).
const UPSTREAM_BODY = {
  org_id: "org_test456",
  paid_topups_cents: "12500",
  promises: [
    {
      id: "1b1b0b8e-8f6a-4f9a-9a1e-7c1f2f3a4b5c",
      kind: "referral_referrer",
      amount_cents: "50000",
      paid_trigger_cents: "20000",
      paid_so_far_cents: "12500",
      remaining_to_unlock_cents: "7500",
      progress_pct: 62,
      referred_org_id: "2c2c1c9f-9a7b-4a0b-8b2f-8d2a3a4b5c6d",
      referrer_org_id: null,
      created_at: "2026-07-30T10:00:00.000Z",
    },
    {
      id: "3d3d2daa-aab8-4b1c-9c3a-9e3b4b5c6d7e",
      kind: "referral_referee",
      amount_cents: "50000",
      paid_trigger_cents: "50000",
      paid_so_far_cents: "12500",
      remaining_to_unlock_cents: "37500",
      progress_pct: 25,
      referred_org_id: null,
      referrer_org_id: "4e4e3ebb-bbc9-4c2d-8d4b-af4c5c6d7e8f",
      created_at: "2026-07-31T09:00:00.000Z",
    },
  ],
};

describe("GET /v1/billing/free-credit-promises — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(UPSTREAM_BODY) };
    });
  });

  it("forwards to billing's real path, carrying the resolved org identity", async () => {
    const res = await request(buildApp()).get("/v1/billing/free-credit-promises");

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/free-credit-promises`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["X-API-Key"]).toBe("billing-test-key");
  });

  it("returns billing's body unchanged, including referred_org_id", async () => {
    const res = await request(buildApp()).get("/v1/billing/free-credit-promises");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("ignores a caller-supplied org — only the authenticated org reaches billing", async () => {
    const res = await request(buildApp())
      .get("/v1/billing/free-credit-promises?orgId=someone-elses-org")
      .set("x-org-id", "someone-elses-org");

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/free-credit-promises`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("propagates an upstream failure with its status AND its body intact", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 502,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: "stripe-service unavailable", code: "UPSTREAM_DOWN" }),
          ),
        json: () => Promise.resolve({}),
      };
    });

    const res = await request(buildApp()).get("/v1/billing/free-credit-promises");

    // Not flattened into { error: "<the whole JSON body>" } — the fields survive (CLAUDE.md #7).
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "stripe-service unavailable", code: "UPSTREAM_DOWN" });
  });
});
