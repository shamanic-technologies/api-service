import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Own file, deliberately WITHOUT the auth mock the behaviour test uses: this exercises
// the real `authenticate` / `requireOrg` / `requireUser` chain, so "a caller from another
// org cannot read a brand that is not theirs" is a real assertion about the shipped gate
// and not a property of a stub.
vi.hoisted(() => {
  process.env.FEATURES_SERVICE_URL = "http://features.test.local";
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const PATH = "/v1/features/sales-cold-email-outreach/goal-arbitration?brandId=8a7c4f2e-1d3b-4a5c-9e6f-0b1c2d3e4f5a";

describe("GET /v1/features/:slug/goal-arbitration — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past auth, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a call with no credentials", async () => {
    const res = await request(buildApp()).get(PATH);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing authentication");
  });

  it("refuses a call carrying a wrong platform key", async () => {
    const res = await request(buildApp()).get(PATH).set("X-API-Key", "not-the-admin-key");
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an admin-keyed call that names an org it did not authenticate as", async () => {
    // The platform key is shared with the dashboard's server-side proxy, so it is not an
    // identity: naming another org in a header does not grant that org's brands.
    const res = await request(buildApp())
      .get(PATH)
      .set("X-API-Key", "admin-test-key")
      .set("x-org-id", "someone-elses-org");
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
