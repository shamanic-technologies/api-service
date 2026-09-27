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

describe("GET /v1/runs/:id — auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a call with no credentials", async () => {
    const res = await request(buildApp()).get("/v1/runs/c376867e-f94f-435b-8833-355affca0a4b");
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
