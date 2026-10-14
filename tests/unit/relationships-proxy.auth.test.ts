import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// No auth mock: the real authenticate / requireOrg gate runs.
vi.hoisted(() => {
  process.env.LEAD_SERVICE_URL = "http://lead.test.local";
  process.env.LEAD_SERVICE_API_KEY = "lead-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import relationshipsRouter from "../../src/routes/relationships.js";
import leadsRouter from "../../src/routes/leads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", relationshipsRouter);
  app.use("/v1", leadsRouter);
  return app;
}

const BRAND = "f4d73dab-1f9d-49b2-b16e-63ecde76a5eb";
const HUMAN = "11111111-1111-1111-1111-111111111111";

describe("relationship routes: auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  for (const [method, path] of [
    ["get", `/v1/brands/${BRAND}/relationships/review`],
    ["put", `/v1/brands/${BRAND}/relationships/${HUMAN}/tags/personal`],
    ["delete", `/v1/brands/${BRAND}/relationships/${HUMAN}/tags/personal`],
    ["put", `/v1/brands/${BRAND}/relationships/${HUMAN}/company`],
    ["post", `/v1/brands/${BRAND}/relationships/merges/x/undo`],
    ["get", `/v1/leads/${HUMAN}/relationship`],
  ] as const) {
    it(`${method.toUpperCase()} ${path} refuses a call with no credentials`, async () => {
      const res = await request(buildApp())[method](path);
      expect(res.status).toBe(401);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it(`${method.toUpperCase()} ${path} refuses a wrong platform key`, async () => {
      const res = await request(buildApp())[method](path).set("X-API-Key", "nope");
      expect(res.status).toBe(401);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  }
});
