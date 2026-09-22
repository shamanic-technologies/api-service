import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Own file, deliberately WITHOUT the auth mock the behaviour test uses: this exercises
// the real `authenticate` / `requireOrg` middleware, so "an unauthenticated call is
// refused" is a real assertion about the shipped gate and not a property of a stub.
// It matters more on these two than on a read: they RECORD a human's verdict, so an
// unauthenticated caller reaching them would be putting words in somebody's mouth.
vi.hoisted(() => {
  process.env.LEAD_SERVICE_URL = "http://lead.test.local";
  process.env.LEAD_SERVICE_API_KEY = "lead-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import leadsRouter from "../../src/routes/leads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", leadsRouter);
  return app;
}

const BRAND = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";
const RULING = { brandId: BRAND, crmContactId: "crm_contact_9", leadId: LEAD, ruling: "accepted" };

describe("CRM pairing rulings — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past auth, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a POST with no credentials", async () => {
    const res = await request(buildApp()).post("/v1/leads/crm-pairings/rulings").send(RULING);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a DELETE with no credentials", async () => {
    const res = await request(buildApp()).delete(
      `/v1/leads/crm-pairings/rulings?brandId=${BRAND}&crmContactId=c&leadId=${LEAD}`
    );
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a POST carrying a wrong platform key", async () => {
    const res = await request(buildApp())
      .post("/v1/leads/crm-pairings/rulings")
      .set("X-API-Key", "not-the-admin-key")
      .send(RULING);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an admin-keyed POST that names an org it did not authenticate as", async () => {
    // The platform key is shared with the dashboard's server-side proxy, so it is not
    // an identity: without resolvable identity headers the request never reaches
    // lead-service, so a caller cannot rule on another org's pairing by naming it.
    const res = await request(buildApp())
      .post("/v1/leads/crm-pairings/rulings")
      .set("X-API-Key", "admin-test-key")
      .set("x-org-id", "someone-elses-org")
      .send(RULING);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
