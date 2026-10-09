import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/chat/sessions/latest?configKey=… — pass-through to chat-service
 * GET /sessions/latest. Driven through the real router with a stubbed `fetch`, so
 * these assert what goes over the wire (path, query, identity, body, status).
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_authenticated";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import chatRouter from "../../src/routes/chat.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", chatRouter);
  return app;
}

const SESSION_BODY = JSON.stringify({
  session: { id: "sess-1", configKey: "staff-copilot", unknownDownstreamField: 7 },
  messages: [{ role: "assistant", content: "hi", choices: ["a"], openPages: [] }],
});

describe("GET /v1/chat/sessions/latest — latest session pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  function stub(status: number, body: string) {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
  }

  beforeEach(() => stub(200, SESSION_BODY));

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("reaches chat-service GET /sessions/latest with the query verbatim, not the :sessionId route", async () => {
    const res = await request(buildApp()).get("/v1/chat/sessions/latest?configKey=staff-copilot&x=a%20b");
    expect(res.status).toBe(200);
    const { url, init } = upstream();
    expect(url.endsWith("/sessions/latest?configKey=staff-copilot&x=a%20b")).toBe(true);
    expect(init.method ?? "GET").toBe("GET");
  });

  it("returns the upstream body untouched", async () => {
    const res = await request(buildApp()).get("/v1/chat/sessions/latest?configKey=staff-copilot");
    expect(res.body).toEqual(JSON.parse(SESSION_BODY));
  });

  it("sends the AUTHENTICATED org and user, not ones the caller named", async () => {
    await request(buildApp())
      .get("/v1/chat/sessions/latest?configKey=staff-copilot")
      .set("x-org-id", "org_someone_else")
      .set("x-user-id", "user_someone_else");
    const { init } = upstream();
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
    expect(init.headers["x-user-id"]).toBe("user_authenticated");
  });

  it("forwards chat-service's 404 (no session yet) with its body, not a 500", async () => {
    stub(404, '{"error":"No session for configKey=\\"staff-copilot\\" for this user."}');
    const res = await request(buildApp()).get("/v1/chat/sessions/latest?configKey=staff-copilot");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No session for configKey="staff-copilot" for this user.' });
  });

  it("forwards chat-service's 400 (configKey missing) with its body", async () => {
    stub(400, '{"error":"Invalid request","details":{"configKey":["Required"]}}');
    const res = await request(buildApp()).get("/v1/chat/sessions/latest");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid request", details: { configKey: ["Required"] } });
    expect(upstream().url.endsWith("/sessions/latest")).toBe(true);
  });

  it("leaves the per-id route reaching GET /sessions/{id}", async () => {
    const res = await request(buildApp()).get("/v1/chat/sessions/sess-123");
    expect(res.status).toBe(200);
    expect(upstream().url.endsWith("/sessions/sess-123")).toBe(true);
  });
});
