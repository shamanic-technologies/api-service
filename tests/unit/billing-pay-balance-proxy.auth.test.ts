import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// No auth mock: exercises the real authenticate / requireOrg gate.
vi.hoisted(() => {
  process.env.BILLING_SERVICE_URL = "http://billing.test.local";
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import billingRouter from "../../src/routes/billing.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", billingRouter);
  return app;
}

describe("POST /v1/billing/accounts/pay_balance — auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a call with no credentials, before any charge reaches billing", async () => {
    const res = await request(buildApp()).post("/v1/billing/accounts/pay_balance");
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a call carrying a wrong platform key", async () => {
    const res = await request(buildApp()).post("/v1/billing/accounts/pay_balance").set("X-API-Key", "nope");
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
