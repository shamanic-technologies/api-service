import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/** Real auth middleware (no mock): an unauthenticated report never reaches features-service. */
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

describe("POST /v1/features/unit-reports — auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a report with no credentials", async () => {
    const res = await request(buildApp()).post("/v1/features/unit-reports").send({ kind: "reported" });
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a report carrying a wrong platform key", async () => {
    const res = await request(buildApp())
      .post("/v1/features/unit-reports")
      .set("X-API-Key", "not-the-admin-key")
      .send({ kind: "reported" });
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
