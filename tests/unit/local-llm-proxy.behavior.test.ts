import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the routers import.
const { CHAT_BASE } = vi.hoisted(() => {
  const CHAT_BASE = "http://chat.test.local";
  process.env.CHAT_SERVICE_URL = CHAT_BASE;
  process.env.CHAT_SERVICE_API_KEY = "chat-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  process.env.CRM_SERVICE_URL = "http://crm.test";
  process.env.CRM_SERVICE_API_KEY = "test-crm-key";
  return { CHAT_BASE };
});

/**
 * LOCAL-CLAUDE-1116: the org's LLM on the user's own Claude Code. The four /v1/local-llm routes are byte
 * pipes to chat-service /orgs/local-llm* with the caller's org, user and run; status and body come back
 * verbatim (409 / 410 included). No auth mock: the real authenticate + requireOrg + requireUser.
 */
vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

import router from "../../src/routes/local-llm.js";
import { buildDocument } from "../../src/openapi/document.js";
import { isLocalLlmWorkCall, recordCustomerCalls, _queuedCalls, _resetCallLog } from "../../src/lib/call-log.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
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

describe("GET /v1/local-llm", () => {
  it("pipes chat-service GET /orgs/local-llm with the caller's identity, body byte-for-byte", async () => {
    const raw = '{"declared":true,"runner":{"connected":false},"pendingCalls":0}';
    upstream(200, raw);
    const res = await request(buildApp()).get("/v1/local-llm").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CHAT_BASE}/orgs/local-llm`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
    expectIdentity(calls[0].options);
  });

  it("refuses an unauthenticated caller before any downstream call", async () => {
    upstream(200, "{}");
    const res = await request(buildApp()).get("/v1/local-llm");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("PUT /v1/local-llm", () => {
  it("forwards the body as is to chat-service PUT /orgs/local-llm; the state comes back verbatim", async () => {
    const raw = '{"declared":true}';
    upstream(200, raw);
    const res = await request(buildApp()).put("/v1/local-llm").set(AUTH).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls[0].url).toBe(`${CHAT_BASE}/orgs/local-llm`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual({ enabled: true });
    expectIdentity(calls[0].options);
  });

  it("a refusal keeps chat-service's 400 and body field-for-field", async () => {
    upstream(400, '{"error":"Invalid request","details":{"fieldErrors":{"enabled":["Required"]}}}');
    const res = await request(buildApp()).put("/v1/local-llm").set(AUTH).send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid request", details: { fieldErrors: { enabled: ["Required"] } } });
  });
});

describe("POST /v1/local-llm/work/claim", () => {
  it("forwards the claim body to chat-service POST /orgs/local-llm/work/claim; items byte-for-byte", async () => {
    const raw = `{"items":[{"id":"${JOB}","leaseId":"l-1"}]}`;
    upstream(200, raw);
    const body = { waitMs: 25000, max: 2, runner: { name: "mac-app", version: "1.2.0" } };
    const res = await request(buildApp()).post("/v1/local-llm/work/claim").set(AUTH).send(body);
    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls[0].url).toBe(`${CHAT_BASE}/orgs/local-llm/work/claim`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expectIdentity(calls[0].options);
    // Long poll: no per-call abort timer of our own (the default undici timeouts, 300 s, cover 25 s).
    expect(calls[0].options.dispatcher).toBeUndefined();
  });

  it("an undeclared org keeps chat-service's 409 with its code", async () => {
    upstream(409, '{"error":"This org has not declared its LLM local: PUT /orgs/local-llm {enabled: true} first.","code":"local_llm_not_declared"}');
    const res = await request(buildApp()).post("/v1/local-llm/work/claim").set(AUTH).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("local_llm_not_declared");
  });
});

describe("POST /v1/local-llm/work/:id/result", () => {
  const RESULT = { leaseId: "l-1", ok: true, model: "claude-x", text: "hello", usage: { inputTokens: 10, outputTokens: 2 } };

  it("forwards the result to chat-service POST /orgs/local-llm/work/{id}/result", async () => {
    const raw = '{"stored":true,"status":"done"}';
    upstream(200, raw);
    const res = await request(buildApp()).post(`/v1/local-llm/work/${JOB}/result`).set(AUTH).send(RESULT);
    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls[0].url).toBe(`${CHAT_BASE}/orgs/local-llm/work/${JOB}/result`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(RESULT);
    expectIdentity(calls[0].options);
  });

  it.each([
    [404, { error: "No such work item for this org" }],
    [409, { error: "This call belongs to another claim (leaseId does not match).", code: "lease_mismatch" }],
    [410, { error: "The caller stopped waiting for this call: drop it.", code: "local_job_expired" }],
  ])("keeps chat-service's %i and body", async (status, body) => {
    upstream(status, JSON.stringify(body));
    const res = await request(buildApp()).post(`/v1/local-llm/work/${JOB}/result`).set(AUTH).send(RESULT);
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
  });

  it("an id carrying slashes stays ONE encoded segment: never another chat-service path", async () => {
    upstream(404, '{"error":"No such work item for this org"}');
    await request(buildApp()).post("/v1/local-llm/work/..%2F..%2Finternal%2Fx/result").set(AUTH).send(RESULT);
    for (const c of calls) {
      expect(c.url.startsWith(`${CHAT_BASE}/orgs/local-llm/work/`)).toBe(true);
      expect(c.url).not.toContain("/internal/");
      expect(c.url.endsWith("/result")).toBe(true);
    }
  });
});

describe("call log: the runner's work traffic is never recorded", () => {
  beforeEach(() => _resetCallLog());
  afterEach(() => _resetCallLog());

  it("matches the work routes only", () => {
    expect(isLocalLlmWorkCall("/v1/local-llm/work/claim")).toBe(true);
    expect(isLocalLlmWorkCall(`/v1/local-llm/work/${JOB}/result?x=1`)).toBe(true);
    expect(isLocalLlmWorkCall("/v1/local-llm")).toBe(false);
  });

  it("a user-key claim and result leave no record; the declaration read does", async () => {
    const app = express();
    app.use(express.json());
    app.use(recordCustomerCalls);
    const fakeAuth = (req: any, _res: any, next: any) => {
      req.authType = "user_key";
      req.userId = USER;
      req.orgId = ORG;
      req.runId = "run-1";
      req.userKeyScope = { isStaff: false, memberships: [], email: "client@acme.com", displayName: "Ada" };
      next();
    };
    app.post("/v1/local-llm/work/claim", fakeAuth, (_req, res) => res.json({ items: [{ prompt: "customer content" }] }));
    app.post("/v1/local-llm/work/:id/result", fakeAuth, (_req, res) => res.json({ stored: true }));
    app.get("/v1/local-llm", fakeAuth, (_req, res) => res.json({ declared: true }));
    const key = "Bearer distrib.usr_abcdefghijklmnopqrstuvwxyz0123456789";
    await request(app).post("/v1/local-llm/work/claim").set("Authorization", key).send({});
    await request(app).post(`/v1/local-llm/work/${JOB}/result`).set("Authorization", key).send({ text: "secret answer" });
    await request(app).get("/v1/local-llm").set("Authorization", key);
    await new Promise((r) => setTimeout(r, 20));
    const recs = _queuedCalls();
    expect(recs).toHaveLength(1);
    expect(recs[0].path).toBe("/v1/local-llm");
  });
});

describe("published document", () => {
  const doc = buildDocument() as any;

  it("a customer reads all four operations, with the producer's bodies documented", () => {
    expect(doc.paths["/v1/local-llm"].get).toBeDefined();
    expect(doc.paths["/v1/local-llm"].put).toBeDefined();
    expect(doc.paths["/v1/local-llm/work/claim"].post).toBeDefined();
    expect(doc.paths["/v1/local-llm/work/{id}/result"].post).toBeDefined();
    const putBody = JSON.stringify(doc.paths["/v1/local-llm"].put.requestBody);
    expect(putBody).toContain("enabled");
    const resultBody = JSON.stringify(doc.paths["/v1/local-llm/work/{id}/result"].post.requestBody);
    expect(resultBody).toContain("leaseId");
  });

  it("no operation asks for the user's yes: a runner claims and answers without a token", () => {
    for (const [path, method] of [
      ["/v1/local-llm", "put"],
      ["/v1/local-llm/work/claim", "post"],
      ["/v1/local-llm/work/{id}/result", "post"],
    ] as const) {
      expect(doc.paths[path][method]["x-needs-user-yes"], `${method} ${path}`).toBeUndefined();
    }
  });
});
