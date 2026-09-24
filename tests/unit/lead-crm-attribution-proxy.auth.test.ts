import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Own file, deliberately WITHOUT the auth mock: exercises the real `authenticate` /
 * `requireOrg` / `requireUser`, so "an unauthenticated call is refused" is a claim about
 * the shipped gate (CLAUDE.md rule #7, corollary 3).
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

describe("CRM attribution routes — auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  const cases: Array<[string, (a: request.SuperTest<request.Test>) => request.Test]> = [
    ["GET crm-attribution", (a) => a.get(`/v1/leads/${LEAD}/crm-attribution`)],
    ["PUT crm-attribution/:step", (a) => a.put(`/v1/leads/${LEAD}/crm-attribution/sale`).send({ causedByOutreach: true })],
    ["DELETE crm-attribution/:step", (a) => a.delete(`/v1/leads/${LEAD}/crm-attribution/sale`)],
    ["POST crm-evidence/sync", (a) => a.post(`/v1/leads/crm-evidence/sync?brandId=x`)],
  ];

  for (const [name, call] of cases) {
    it(`refuses ${name} with no credentials`, async () => {
      const res = await call(request(buildApp()) as any);
      expect(res.status).toBe(401);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it(`refuses ${name} with a wrong platform key`, async () => {
      const res = await call(request(buildApp()) as any).set("X-API-Key", "not-the-admin-key");
      expect(res.status).toBe(401);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  }
});
