import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// No auth mock: exercises the real `authenticate` gate.
vi.hoisted(() => {
  process.env.RUNS_SERVICE_URL = "http://runs.test.local";
  process.env.RUNS_SERVICE_API_KEY = "runs-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import runsRouter from "../../src/routes/runs.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", runsRouter);
  return app;
}

describe("GET /v1/runs/stats/run-outcomes — auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a call with no credentials", async () => {
    const res = await request(buildApp()).get("/v1/runs/stats/run-outcomes");
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an admin-keyed call that names an org without resolvable identity", async () => {
    const res = await request(buildApp())
      .get("/v1/runs/stats/run-outcomes")
      .set("X-API-Key", "admin-test-key")
      .set("x-org-id", "someone-elses-org");
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
