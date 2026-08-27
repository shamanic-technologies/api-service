import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Own file, deliberately WITHOUT the auth mock the behaviour test uses: this exercises
// the real `authenticate` middleware, so "an unauthenticated call is refused" is a real
// assertion about the shipped gate and not a property of a stub.
vi.hoisted(() => {
  process.env.CAMPAIGN_SERVICE_URL = "http://campaign.test.local";
  process.env.CAMPAIGN_SERVICE_API_KEY = "campaign-test-key";
});

import brandSpendableBudgetRouter from "../../src/routes/brand-spendable-budget.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandSpendableBudgetRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";

describe("GET /v1/brands/:brandId/spendable-budget — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past auth, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a call with no credentials", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/spendable-budget`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing authentication");
  });

  it("refuses a call that names an org in a header without authenticating", async () => {
    const res = await request(buildApp())
      .get(`/v1/brands/${BRAND_ID}/spendable-budget`)
      .set("x-org-id", "org_someone_else");
    expect(res.status).toBe(401);
  });
});
