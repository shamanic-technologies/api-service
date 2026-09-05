import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Own file, deliberately WITHOUT the auth mock `lead-followups-proxy.test.ts` uses: it
 * exercises the real `authenticate` / `requireOrg` / `requireUser`, so "an
 * unauthenticated call is refused" is an assertion about the shipped gate and not a
 * property of a stub (CLAUDE.md rule #7, corollary 3). It matters on this route because
 * the write moves a real campaign's next action: an ungated caller could pull another
 * org's prospects to the front of their queue.
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
const NOW = { kind: "scheduled", dueAt: "2026-09-05T09:00:00.000Z" };

describe("/v1/leads/:id/followups — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past auth, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a POST with no credentials", async () => {
    const res = await request(buildApp()).post(`/v1/leads/${LEAD}/followups`).send(NOW);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a GET with no credentials", async () => {
    const res = await request(buildApp()).get(`/v1/leads/${LEAD}/followups`);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a POST carrying a wrong platform key", async () => {
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/followups`)
      .set("X-API-Key", "not-the-admin-key")
      .send(NOW);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an admin-keyed POST that names an org it did not authenticate as", async () => {
    // The platform key is shared with the dashboard's server-side proxy, so it is not
    // an identity: without resolvable identity headers the request never reaches
    // lead-service, so a caller cannot reschedule another org's lead by naming it.
    const res = await request(buildApp())
      .post(`/v1/leads/${LEAD}/followups`)
      .set("X-API-Key", "admin-test-key")
      .set("x-org-id", "someone-elses-org")
      .send(NOW);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
