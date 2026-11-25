import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the routers import.
const { CHAT_BASE } = vi.hoisted(() => {
  const CHAT_BASE = "http://chat.test.local";
  process.env.CHAT_SERVICE_URL = CHAT_BASE;
  process.env.CHAT_SERVICE_API_KEY = "chat-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { CHAT_BASE };
});

/**
 * COPILOT-HANDOFF-GATEWAY-1125: the signed-in founder hands themselves to Distry on a channel.
 * /v1/copilot/handoff is a byte pipe to chat-service /orgs/copilot/handoff with the AUTHENTICATED org + user;
 * status and body come back verbatim. No auth mock: the real authenticate + requireOrg + requireUser.
 */
vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

import router from "../../src/routes/copilot-handoff.js";
import { buildDocument } from "../../src/openapi/document.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const AUTH = { "X-API-Key": "admin-test-key", "x-org-id": ORG, "x-user-id": USER };
let calls: Array<{ url: string; options: any }>;

function upstream(status: number, raw: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(raw, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  });
}

function expectIdentity(options: any) {
  expect(options.headers["X-API-Key"]).toBe("chat-test-key");
  expect(options.headers["x-org-id"]).toBe(ORG);
  expect(options.headers["x-user-id"]).toBe(USER);
  expect(options.headers["x-run-id"]).toBeTruthy();
}

beforeEach(() => {
  calls = [];
});

describe("POST /v1/copilot/handoff", () => {
  it("forwards the body verbatim with the caller's org + user; 202 and body come back byte-for-byte", async () => {
    const raw = `{"handoff":{"campaignId":"${CAMPAIGN}","sayHelloOn":"whatsapp","status":"pending"}}`;
    upstream(202, raw);
    const body = { campaignId: CAMPAIGN, sayHelloOn: "whatsapp", idempotencyKey: "k-1" };
    const res = await request(buildApp()).post("/v1/copilot/handoff").set(AUTH).send(body);
    expect(res.status).toBe(202);
    expect(res.text).toBe(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CHAT_BASE}/orgs/copilot/handoff`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expectIdentity(calls[0].options);
  });

  it("an org or user in the BODY never replaces the authenticated identity", async () => {
    upstream(200, "{}");
    const body = { sayHelloOn: "email", orgId: "evil-org", userId: "evil-user" };
    await request(buildApp()).post("/v1/copilot/handoff").set(AUTH).send(body);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expectIdentity(calls[0].options);
  });

  it.each([
    [400, '{"error":"campaignId or sayHelloOn required","code":"invalid_request"}'],
    [409, '{"error":"Already handed off on email","code":"handoff_conflict"}'],
    [502, '{"error":"WhatsApp send failed","code":"hello_failed"}'],
  ])("keeps chat-service's %i and body field-for-field", async (status, raw) => {
    upstream(status, raw);
    const res = await request(buildApp()).post("/v1/copilot/handoff").set(AUTH).send({});
    expect(res.status).toBe(status);
    expect(res.body).toEqual(JSON.parse(raw));
  });

  it("refuses an unauthenticated caller before any downstream call", async () => {
    upstream(200, "{}");
    const res = await request(buildApp()).post("/v1/copilot/handoff").send({ sayHelloOn: "email" });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("GET /v1/copilot/handoff", () => {
  it("pipes chat-service GET /orgs/copilot/handoff with no body, state byte-for-byte", async () => {
    const raw = '{"handoff":null}';
    upstream(200, raw);
    const res = await request(buildApp()).get("/v1/copilot/handoff").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls[0].url).toBe(`${CHAT_BASE}/orgs/copilot/handoff`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
    expectIdentity(calls[0].options);
  });
});

describe("openapi", () => {
  it("publishes both operations on the customer document, the POST with no user-yes", () => {
    const doc: any = buildDocument();
    const op = doc.paths["/v1/copilot/handoff"];
    expect(op.post.operationId).toBeTruthy();
    expect(op.get.operationId).toBeTruthy();
    expect(op.post["x-needs-user-yes"]).toBeUndefined();
    const schema = op.post.requestBody.content["application/json"].schema;
    const resolved = schema.$ref ? doc.components.schemas[schema.$ref.split("/").pop()] : schema;
    expect(Object.keys(resolved.properties ?? {})).toEqual(
      expect.arrayContaining(["campaignId", "sayHelloOn", "idempotencyKey"]),
    );
  });
});
