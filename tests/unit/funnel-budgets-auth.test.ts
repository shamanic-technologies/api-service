import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Own file, deliberately WITHOUT the auth mock the behaviour test uses: this exercises
// the real `authenticate` + `requireOrg` middleware, so "an unauthenticated call is
// refused" is a real assertion about the shipped gate and not a property of a stub.
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

const BRAND_ID = "7f9c2b1e-3d4a-4c5b-9e6f-0a1b2c3d4e5f";

const ROUTES: Array<[string, string]> = [
  ["get", `/v1/brands/${BRAND_ID}/funnel-budgets`],
  ["put", `/v1/brands/${BRAND_ID}/funnel-budgets`],
  ["patch", `/v1/brands/${BRAND_ID}/funnel-budgets/visit_signup`],
];

describe("per-funnel daily budgets — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past auth, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it.each(ROUTES)("refuses %s %s with no credentials", async (method, path) => {
    const res = await (request(buildApp()) as any)[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing authentication");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("refuses %s %s carrying a wrong platform key", async (method, path) => {
    const res = await (request(buildApp()) as any)[method](path).set("X-API-Key", "nope").send({});
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(ROUTES)(
    "refuses %s %s when an admin-keyed call names an org it did not authenticate as",
    async (method, path) => {
      // The platform key is shared with the dashboard's server-side proxy, so it is not
      // an identity: without resolvable identity headers the request never reaches billing.
      const res = await (request(buildApp()) as any)
        [method](path)
        .set("X-API-Key", "admin-test-key")
        .set("x-org-id", "someone-elses-org")
        .send({});
      expect(res.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );
});
