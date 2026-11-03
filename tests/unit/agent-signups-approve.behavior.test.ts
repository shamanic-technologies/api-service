import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { CLIENT_BASE, KEY_BASE } = vi.hoisted(() => {
  const CLIENT_BASE = "http://client.test.local";
  const KEY_BASE = "http://key.test.local";
  process.env.CLIENT_SERVICE_URL = CLIENT_BASE;
  process.env.CLIENT_SERVICE_API_KEY = "client-test-key";
  process.env.KEY_SERVICE_URL = KEY_BASE;
  process.env.KEY_SERVICE_API_KEY = "key-test-key";
  return { CLIENT_BASE, KEY_BASE };
});

/**
 * Agent signup for an agent with no inbox access (CLIENT-FRICTION-API-1103,
 * client-service #202): the emailed approval link is served through this
 * gateway, and complete forwards the agent's pollToken. Public tier: nothing
 * is mocked, the routes must answer with no credentials at all.
 */
import agentSignupsRouter from "../../src/routes/agent-signups.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", agentSignupsRouter);
  return app;
}

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
let calls: Call[];

function stubFetch(handler: (call: Call) => Response) {
  global.fetch = vi.fn(async (input: any, init: any) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  }) as any;
}

beforeEach(() => {
  calls = [];
});

const PAGE = "<!doctype html><form method=\"post\"><button>Confirm</button></form>";

describe("GET /v1/agent-signups/approve", () => {
  it("pipes client-service's HTML page byte-identical, query string verbatim, no identity headers", async () => {
    stubFetch(() => new Response(PAGE, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
    const res = await request(buildApp()).get("/v1/agent-signups/approve?token=abc%2Bdef").set("accept", "text/html");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toBe(PAGE);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CLIENT_BASE}/internal/agent-signups/approve?token=abc%2Bdef`);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.accept).toBe("text/html");
    expect(calls[0].headers["x-org-id"]).toBeUndefined();
    expect(calls[0].headers["x-user-id"]).toBeUndefined();
  });

  it("forwards client-service's refusal status and body", async () => {
    const refusal = { error: "invalid_request", message: "token: the approval link's token is required" };
    stubFetch(() => new Response(JSON.stringify(refusal), { status: 400, headers: { "content-type": "application/json" } }));
    const res = await request(buildApp()).get("/v1/agent-signups/approve");
    expect(res.status).toBe(400);
    expect(res.body).toEqual(refusal);
  });
});

describe("POST /v1/agent-signups/approve", () => {
  it("carries the form's token to client-service and pipes its page back", async () => {
    stubFetch(() => new Response("<p>Confirmed</p>", { status: 200, headers: { "content-type": "text/html" } }));
    const res = await request(buildApp())
      .post("/v1/agent-signups/approve?token=tok123")
      .type("form")
      .send({ token: "tok123" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("<p>Confirmed</p>");
    expect(calls[0].url).toBe(`${CLIENT_BASE}/internal/agent-signups/approve?token=tok123`);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ token: "tok123" });
  });
});

describe("POST /v1/agent-signups/complete with a pollToken", () => {
  it("forwards the pollToken (not keyName) and forwards authorization_pending verbatim", async () => {
    const pending = { error: "authorization_pending", message: "The inbox owner has not confirmed yet." };
    stubFetch(() => new Response(JSON.stringify(pending), { status: 400, headers: { "content-type": "application/json" } }));
    const res = await request(buildApp())
      .post("/v1/agent-signups/complete")
      .send({ email: "agent@example.com", pollToken: "pt_1", keyName: "mine" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(pending);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CLIENT_BASE}/internal/agent-signups/complete`);
    expect(calls[0].body).toEqual({ email: "agent@example.com", pollToken: "pt_1" });
    expect(calls.some((c) => c.url.startsWith(KEY_BASE))).toBe(false);
  });
});
