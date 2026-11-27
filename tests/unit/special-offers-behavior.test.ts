import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE };
});

/**
 * GET /v1/billing/special-offers (SPECIAL-OFFER-BF-1127): what each special offer brought
 * the org in context. Drives the real router over the wire and asserts (a) billing's real
 * path, (b) the AUTHENTICATED org only, (c) the body byte-identical, money strings included.
 * Billing's field names below are a fixture, not a contract this repo owns (CLAUDE.md #6/#8).
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

const UPSTREAM_BODY = {
  org_id: "org_test456",
  special_offers: [
    {
      slug: "black-friday-2026",
      name: "Black Friday 2026",
      starts_at: "2026-11-27T00:00:00.000Z",
      ends_at: "2026-12-01T23:59:59.000Z",
      paid_cents: "50000.0000",
      free_credit_cents: "25000.0000",
      payments: [
        {
          payment_id: "pi_123",
          acquirer: "stripe",
          paid_cents: "50000.0000",
          paid_at: "2026-11-27T10:00:00.000Z",
          free_credit_cents: "25000.0000",
          grant_id: "5f5f4fcc-ccda-4d3e-9e5c-b05d6d7e8f90",
          applied_at: "2026-11-27T10:00:05.000Z",
        },
      ],
    },
  ],
};

describe("GET /v1/billing/special-offers — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(UPSTREAM_BODY) };
    });
  });

  it("forwards to billing's real path with the resolved org identity", async () => {
    const res = await request(buildApp()).get("/v1/billing/special-offers");

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/special-offers`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["X-API-Key"]).toBe("billing-test-key");
  });

  it("returns billing's body unchanged, money strings included", async () => {
    const res = await request(buildApp()).get("/v1/billing/special-offers");
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("ignores a caller-supplied org: only the authenticated org reaches billing", async () => {
    const res = await request(buildApp())
      .get("/v1/billing/special-offers?orgId=someone-elses-org")
      .set("x-org-id", "someone-elses-org");

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/special-offers`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("never exposes billing's staff special-offer routes", async () => {
    const app = buildApp();
    for (const [method, path] of [
      ["post", "/v1/billing/special-offers"],
      ["get", "/v1/billing/special-offers/black-friday-2026"],
      ["post", "/v1/billing/special-offers/black-friday-2026/apply"],
    ] as const) {
      const res = await (request(app) as any)[method](path);
      expect(res.status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  it("propagates an upstream refusal with its status and body", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ error: "Missing or invalid x-org-id" })),
      json: () => Promise.resolve({}),
    }));
    const res = await request(buildApp()).get("/v1/billing/special-offers");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing or invalid x-org-id" });
  });
});
