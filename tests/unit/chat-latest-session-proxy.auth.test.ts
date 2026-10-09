import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// No auth mock: exercises the real authenticate / requireOrg / requireUser gate.
vi.hoisted(() => {
  process.env.CHAT_SERVICE_URL = "http://chat.test.local";
  process.env.CHAT_SERVICE_API_KEY = "chat-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import chatRouter from "../../src/routes/chat.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", chatRouter);
  return app;
}

describe("GET /v1/chat/sessions/latest — auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("refuses a call with no credentials", async () => {
    const res = await request(buildApp()).get("/v1/chat/sessions/latest?configKey=k");
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a call carrying a wrong platform key", async () => {
    const res = await request(buildApp())
      .get("/v1/chat/sessions/latest?configKey=k")
      .set("X-API-Key", "not-the-admin-key");
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
