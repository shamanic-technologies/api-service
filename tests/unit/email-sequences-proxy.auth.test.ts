import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Real authenticate / requireOrg (no auth mock): an unauthenticated call is refused
// before anything leaves the gateway.
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

const QUERY = "?brandId=44444444-4444-4444-4444-444444444444";

describe("GET /v1/email-sequences — auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a call with no credentials", async () => {
    const res = await request(buildApp()).get(`/v1/email-sequences${QUERY}`);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a call carrying a wrong platform key", async () => {
    const res = await request(buildApp())
      .get(`/v1/email-sequences${QUERY}`)
      .set("X-API-Key", "not-the-admin-key");
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
