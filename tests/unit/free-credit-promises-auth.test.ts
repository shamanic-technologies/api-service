import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Own file, deliberately WITHOUT the auth mock the behaviour test uses: this exercises
// the real `authenticate` middleware, so "an unauthenticated call is refused" is a real
// assertion about the shipped gate and not a property of a stub.
vi.hoisted(() => {
  process.env.BILLING_SERVICE_URL = "http://billing.test.local";
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import creditsRouter from "../../src/routes/credits.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", creditsRouter);
  return app;
}

describe("GET /v1/billing/free-credit-promises — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past auth, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a call with no credentials", async () => {
    const res = await request(buildApp()).get("/v1/billing/free-credit-promises");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing authentication");
  });

  it("refuses a call carrying a wrong platform key", async () => {
    const res = await request(buildApp())
      .get("/v1/billing/free-credit-promises")
      .set("X-API-Key", "not-the-admin-key");
    expect(res.status).toBe(401);
  });

  it("refuses an admin-keyed call that names an org it did not authenticate as", async () => {
    // The platform key is shared with the dashboard's server-side proxy, so it is not
    // an identity: without resolvable identity headers the request never reaches billing.
    const res = await request(buildApp())
      .get("/v1/billing/free-credit-promises")
      .set("X-API-Key", "admin-test-key")
      .set("x-org-id", "someone-elses-org");
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
