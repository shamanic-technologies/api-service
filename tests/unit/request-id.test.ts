import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { requestId } from "../../src/middleware/request-id.js";

function createApp() {
  const app = express();
  app.use(requestId);
  app.get("/x", (req, res) => res.json({ seen: (req as { requestId?: string }).requestId }));
  return app;
}

describe("x-request-id", () => {
  it("echoes a caller-supplied correlation id verbatim", async () => {
    const res = await request(createApp()).get("/x").set("x-request-id", "agent-run-42.step_7");
    expect(res.headers["x-request-id"]).toBe("agent-run-42.step_7");
    expect(res.body.seen).toBe("agent-run-42.step_7");
  });

  it("generates one when the caller sends none, so the header is always present", async () => {
    const res = await request(createApp()).get("/x");
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("replaces a value that is not a safe header token", async () => {
    const res = await request(createApp()).get("/x").set("x-request-id", "bad value with spaces");
    expect(res.headers["x-request-id"]).not.toBe("bad value with spaces");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("replaces an over-long value", async () => {
    const res = await request(createApp()).get("/x").set("x-request-id", "a".repeat(200));
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
