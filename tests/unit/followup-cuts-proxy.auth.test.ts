import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Real authenticate (no auth mock): an unauthenticated cut is refused before anything
// leaves the gateway.
vi.hoisted(() => {
  process.env.INSTANTLY_SERVICE_URL = "http://instantly.test.local";
  process.env.INSTANTLY_SERVICE_API_KEY = "instantly-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import conversationsRouter from "../../src/routes/conversations.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", conversationsRouter);
  return app;
}

describe("/v1/followup-cuts — auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a cut with no credentials", async () => {
    const res = await request(buildApp()).post("/v1/followup-cuts").send({ campaignId: "c", leadEmails: ["a@x.com"], reason: "r" });
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a list with no credentials", async () => {
    const res = await request(buildApp()).get("/v1/followup-cuts?campaignId=c");
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
