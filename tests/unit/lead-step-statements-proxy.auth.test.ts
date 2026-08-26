import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Own file, deliberately WITHOUT the auth mock `lead-step-statements-proxy.test.ts`
 * uses: it exercises the real `authenticate` / `requireOrg` / `requireUser`, so
 * "an unauthenticated call is refused" is an assertion about the shipped gate and not
 * a property of a stub (CLAUDE.md rule #7, corollary 3). It matters more on this route
 * than on a read: a statement is recorded downstream against whoever the gateway says
 * made it, so an ungated write would let a caller put words in another org's mouth.
 */
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

const LEAD = "44444444-4444-4444-4444-444444444444";

describe("/v1/leads/:id/step-statements — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past auth, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a POST with no credentials", async () => {
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/step-statements`)
      .send({ step: "sale", kind: "outcome" });
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a GET with no credentials", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/step-statements`);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a POST carrying a wrong platform key", async () => {
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/step-statements`)
      .set("X-API-Key", "not-the-admin-key")
      .send({ step: "sale", kind: "outcome" });
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an admin-keyed POST that names an org it did not authenticate as", async () => {
    // The platform key is shared with the dashboard's server-side proxy, so it is not
    // an identity: without resolvable identity headers the request never reaches
    // lead-service, so a caller cannot state a fact on another org's lead by naming it.
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/step-statements`)
      .set("X-API-Key", "admin-test-key")
      .set("x-org-id", "someone-elses-org")
      .send({ step: "sale", kind: "outcome" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
