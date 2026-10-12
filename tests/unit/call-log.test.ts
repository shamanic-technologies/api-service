import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  BODY_CAP_BYTES,
  REDACTED,
  _queuedCalls,
  _resetCallLog,
  flushCalls,
  isSecretName,
  keyFingerprint,
  recordCustomerCalls,
  redactJson,
  redactText,
} from "../../src/lib/call-log.js";
import type { AuthenticatedRequest } from "../../src/middleware/auth.js";

process.env.CRM_SERVICE_URL = "http://crm.test";
process.env.CRM_SERVICE_API_KEY = "test-crm-key";

const USER_KEY = "distrib.usr_abcdefghijklmnopqrstuvwxyz0123456789";
const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

/** Stand-in for the route-level `authenticate`: a Bearer key resolves to USER; the platform key is the dashboard. */
function fakeAuth(req: AuthenticatedRequest, _res: express.Response, next: express.NextFunction) {
  if (req.headers.authorization === `Bearer ${USER_KEY}`) {
    req.authType = "user_key";
    req.userId = USER;
    req.orgId = ORG;
    req.runId = "run-1";
    req.userKeyScope = { isStaff: false, memberships: [], email: "client@acme.com", displayName: "Ada Client" };
  } else if (req.headers["x-api-key"]) {
    req.authType = "admin";
    req.userId = USER;
    req.orgId = ORG;
  }
  next();
}

function app() {
  const a = express();
  a.use(express.json());
  a.use(recordCustomerCalls);
  a.get("/v1/emails", fakeAuth, (_req, res) => res.json({ emails: [{ id: "e1", subject: "Hi" }, { id: "e2", subject: "Yo" }] }));
  a.post("/v1/keys", fakeAuth, (_req, res) => res.json({ provider: "anthropic", apiKey: "sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZZZ", created: true }));
  a.post("/v1/api-keys", fakeAuth, (_req, res) => res.json({ id: "k2", key: "distrib.usr_newlycreatedkey0000000000" }));
  a.get("/v1/big", fakeAuth, (_req, res) => res.json({ blob: "x".repeat(BODY_CAP_BYTES + 5000) }));
  a.get("/v1/stream", fakeAuth, (_req, res) => {
    res.setHeader("content-type", "text/plain");
    res.write("part one, ");
    res.end("part two");
  });
  return a;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("call log: redaction (pure)", () => {
  it("names secret fields on their snake form, and leaves counts alone", () => {
    for (const n of ["password", "apiKey", "api_key", "x-api-key", "accessToken", "refresh_token", "clientSecret", "authorization", "cookie", "credentials"]) {
      expect(isSecretName(n), n).toBe(true);
    }
    for (const n of ["inputTokens", "brandId", "key", "subject", "tokenCount", "status"]) {
      expect(isSecretName(n), n).toBe(false);
    }
  });

  it("redacts secret-named fields and secret-looking values anywhere in JSON", () => {
    const out = redactJson({
      password: "hunter2",
      nested: { apiKey: { a: 1 }, note: `use ${USER_KEY} please`, list: ["Bearer abc.def.ghi"] },
      inputTokens: 1200,
    }) as Record<string, any>;
    expect(out.password).toBe(REDACTED);
    expect(out.nested.apiKey).toBe(REDACTED);
    expect(out.nested.note).toBe(`use ${REDACTED} please`);
    expect(out.nested.list[0]).toBe(REDACTED);
    expect(out.inputTokens).toBe(1200);
  });

  it("redacts secret fields inside text that is not parseable JSON (a cut body)", () => {
    expect(redactText('{"token":"abc123","name":"x"')).toBe(`{"token":"${REDACTED}","name":"x"`);
  });

  it("fingerprints the key one-way and never returns it", () => {
    const fp = keyFingerprint(`Bearer ${USER_KEY}`);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(USER_KEY.includes(fp!)).toBe(false);
  });
});

describe("call log: capture middleware", () => {
  beforeEach(() => _resetCallLog());
  afterEach(() => _resetCallLog());

  it("records a user-key call: who, channel api, request and response; the client gets the exact body", async () => {
    const res = await request(app())
      .get("/v1/emails?brandId=33333333-3333-4333-8333-333333333333&limit=5")
      .set("Authorization", `Bearer ${USER_KEY}`)
      .set("User-Agent", "my-assistant/1.0");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ emails: [{ id: "e1", subject: "Hi" }, { id: "e2", subject: "Yo" }] });
    await settle();
    const [rec] = _queuedCalls();
    expect(rec).toMatchObject({
      channel: "api",
      mcpTool: null,
      orgId: ORG,
      userId: USER,
      email: "client@acme.com",
      displayName: "Ada Client",
      method: "GET",
      path: "/v1/emails",
      query: { brandId: "33333333-3333-4333-8333-333333333333", limit: "5" },
      brandIds: ["33333333-3333-4333-8333-333333333333"],
      status: 200,
      responseBodyTruncated: false,
      runId: "run-1",
    });
    expect(JSON.parse(rec.responseBody!)).toEqual(res.body);
    expect(rec.requestHeaders["user-agent"]).toBe("my-assistant/1.0");
  });

  it("never stores the Authorization header, the key, or a secret the call carried or got back", async () => {
    const a = app();
    await request(a).post("/v1/keys").set("Authorization", `Bearer ${USER_KEY}`).send({ provider: "anthropic", apiKey: "sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZZZ", password: "hunter2" });
    await request(a).post("/v1/api-keys").set("Authorization", `Bearer ${USER_KEY}`).set("Cookie", "session=abc").send({ name: "mine" });
    await settle();
    const recs = _queuedCalls();
    expect(recs).toHaveLength(2);
    const stored = JSON.stringify(recs);
    expect(stored).not.toContain(USER_KEY);
    expect(stored).not.toContain("distrib.usr_");
    expect(stored).not.toContain("sk-ant-api03");
    expect(stored).not.toContain("hunter2");
    expect(stored).not.toContain("session=abc");
    expect(stored.toLowerCase()).not.toContain('"authorization"');
    expect(stored.toLowerCase()).not.toContain('"cookie"');
    for (const r of recs) expect(Object.keys(r.requestHeaders).sort()).toEqual(Object.keys(r.requestHeaders).filter((h) => !/auth|cookie|api-key/.test(h)).sort());
  });

  it("marks a call made by our MCP server as channel mcp, with its tool", async () => {
    await request(app())
      .get("/v1/emails")
      .set("Authorization", `Bearer ${USER_KEY}`)
      .set("x-distribute-client", "mcp")
      .set("x-distribute-mcp-tool", "distribute_list_emails");
    await settle();
    expect(_queuedCalls()[0]).toMatchObject({ channel: "mcp", mcpTool: "distribute_list_emails" });
  });

  it("does not record the dashboard (platform key) nor a call whose key never resolved", async () => {
    const a = app();
    await request(a).get("/v1/emails").set("x-api-key", "platform");
    await request(a).get("/v1/emails").set("Authorization", "Bearer distrib.usr_unknownkey");
    await request(a).get("/v1/emails");
    await settle();
    expect(_queuedCalls()).toHaveLength(0);
  });

  it("caps a huge body, says it was cut, and keeps its real size", async () => {
    const res = await request(app()).get("/v1/big").set("Authorization", `Bearer ${USER_KEY}`);
    expect(res.body.blob.length).toBe(BODY_CAP_BYTES + 5000);
    await settle();
    const [rec] = _queuedCalls();
    expect(rec.responseBodyTruncated).toBe(true);
    expect(rec.responseBodyBytes).toBe(Buffer.byteLength(JSON.stringify(res.body)));
    expect(Buffer.byteLength(rec.responseBody!)).toBeLessThanOrEqual(BODY_CAP_BYTES);
  });

  it("captures a body written in several chunks", async () => {
    const res = await request(app()).get("/v1/stream").set("Authorization", `Bearer ${USER_KEY}`);
    expect(res.text).toBe("part one, part two");
    await settle();
    expect(_queuedCalls()[0].responseBody).toBe("part one, part two");
  });
});

describe("call log: push to crm-service", () => {
  const realFetch = global.fetch;
  beforeEach(() => _resetCallLog());
  afterEach(() => {
    global.fetch = realFetch;
    _resetCallLog();
  });

  it("posts queued records to crm-service POST /internal/api-calls with its key", async () => {
    await request(app()).get("/v1/emails").set("Authorization", `Bearer ${USER_KEY}`);
    await settle();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ stored: 1, duplicates: 0 }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await flushCalls();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://crm.test/internal/api-calls");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("test-crm-key");
    const body = JSON.parse(init.body);
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0].path).toBe("/v1/emails");
    expect(_queuedCalls()).toHaveLength(0);
  });

  it("re-queues a refused batch once, then drops it, loud both times", async () => {
    await request(app()).get("/v1/emails").set("Authorization", `Bearer ${USER_KEY}`);
    await settle();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn().mockResolvedValue(new Response("down", { status: 503 })) as unknown as typeof fetch;
    await flushCalls();
    expect(_queuedCalls()).toHaveLength(1);
    await flushCalls();
    expect(_queuedCalls()).toHaveLength(0);
    expect(err.mock.calls.some((c) => String(c[0]).includes("[call-log] crm-service refused"))).toBe(true);
    err.mockRestore();
  });
});

describe("call log: batch size", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    _resetCallLog();
  });

  it("keeps each batch under the byte budget crm-service accepts", async () => {
    _resetCallLog();
    const a = app();
    for (let i = 0; i < 30; i++) await request(a).get("/v1/big").set("Authorization", `Bearer ${USER_KEY}`);
    await settle();
    expect(_queuedCalls()).toHaveLength(30);
    const sizes: number[] = [];
    global.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      sizes.push(Buffer.byteLength(String(init.body)));
      return new Response(JSON.stringify({ stored: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    await flushCalls();
    expect(sizes.length).toBeGreaterThan(1);
    for (const s of sizes) expect(s).toBeLessThan(8 * 1024 * 1024);
    expect(_queuedCalls()).toHaveLength(0);
  });
});
