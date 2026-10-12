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
 * Public AI-agent signup: no middleware is mocked here on purpose — the routes
 * must work with NO credentials at all (CLAUDE.md rule #3, public tier).
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
let keyCounter: number;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ACCOUNT = {
  orgId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  email: "agent@example.com",
  contactPhone: "+33612345678",
  clerkOrgId: "org_x",
  clerkUserId: "user_x",
  created: true,
};

function stubFetch(handlers: Record<string, (call: Call) => Response>) {
  global.fetch = vi.fn(async (input: any, init: any) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const handler = handlers[call.url];
    if (!handler) throw new Error(`unexpected fetch ${call.url}`);
    return handler(call);
  }) as any;
}

beforeEach(() => {
  calls = [];
  keyCounter = 0;
});

describe("POST /v1/agent-signups/start", () => {
  it("forwards the body to client-service with no identity headers and returns its answer verbatim", async () => {
    const upstream = { email: "agent@example.com", expiresAt: "2026-10-12T12:15:00.000Z", codeTtlMinutes: 15, maxAttempts: 5 };
    stubFetch({ [`${CLIENT_BASE}/internal/agent-signups/start`]: () => jsonResponse(200, upstream) });

    const res = await request(buildApp())
      .post("/v1/agent-signups/start")
      .send({ email: "agent@example.com", phone: "+33612345678" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ email: "agent@example.com", phone: "+33612345678" });
    expect(calls[0].headers["x-org-id"]).toBeUndefined();
    expect(calls[0].headers["x-user-id"]).toBeUndefined();
    expect(calls[0].headers["X-API-Key"]).toBe("client-test-key");
  });

  it("forwards client-service's named refusal with its status and body", async () => {
    const refusal = { error: "invalid_request", message: "phone: Invalid phone number" };
    stubFetch({ [`${CLIENT_BASE}/internal/agent-signups/start`]: () => jsonResponse(400, refusal) });

    const res = await request(buildApp()).post("/v1/agent-signups/start").send({ email: "a@b.co", phone: "x" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(refusal);
  });
});

describe("POST /v1/agent-signups/complete", () => {
  const handlers = {
    [`${CLIENT_BASE}/internal/agent-signups/complete`]: () => jsonResponse(200, ACCOUNT),
    [`${KEY_BASE}/api-keys`]: (call: Call) => {
      keyCounter += 1;
      return jsonResponse(200, {
        id: `key-id-${keyCounter}`,
        key: `distrib.usr_secret${keyCounter}`,
        name: call.body.name,
        orgId: ACCOUNT.orgId,
        userId: ACCOUNT.userId,
      });
    },
  };

  it("verifies the code, then mints a key for the returned org + user", async () => {
    stubFetch(handlers);

    const res = await request(buildApp())
      .post("/v1/agent-signups/complete")
      .send({ email: "agent@example.com", code: "123456", keyName: "my agent" });

    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      `${CLIENT_BASE}/internal/agent-signups/complete`,
      `${KEY_BASE}/api-keys`,
    ]);
    expect(calls[0].body).toEqual({ email: "agent@example.com", code: "123456" });
    expect(calls[1].method).toBe("POST");
    expect(calls[1].headers["x-org-id"]).toBe(ACCOUNT.orgId);
    expect(calls[1].headers["x-user-id"]).toBe(ACCOUNT.userId);
    expect(calls[1].body).toEqual({ userId: ACCOUNT.userId, createdBy: ACCOUNT.userId, name: "my agent" });
    expect(res.body).toMatchObject({
      apiKey: "distrib.usr_secret1",
      apiKeyId: "key-id-1",
      apiKeyName: "my agent",
      orgId: ACCOUNT.orgId,
      userId: ACCOUNT.userId,
      email: ACCOUNT.email,
      contactPhone: ACCOUNT.contactPhone,
      created: true,
    });
    expect(res.body.prepay).toMatchObject({
      method: "POST",
      path: "/v1/billing/accounts/prepaid_checkout",
      minimums_cents: { topup_amount_cents: 1000, auto_topup_amount_cents: 1500, auto_topup_threshold_cents: 500 },
    });
  });

  it("mints a NEW, different key on every completion", async () => {
    stubFetch(handlers);
    const app = buildApp();

    const first = await request(app).post("/v1/agent-signups/complete").send({ email: "agent@example.com", code: "123456" });
    const second = await request(app).post("/v1/agent-signups/complete").send({ email: "agent@example.com", code: "123456" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.apiKey).not.toBe(second.body.apiKey);
    expect(calls.filter((c) => c.url === `${KEY_BASE}/api-keys`)).toHaveLength(2);
    expect(first.body.apiKeyName).toMatch(/^Agent key /);
  });

  it("forwards a wrong-code refusal verbatim (attemptsLeft kept) and mints nothing", async () => {
    const refusal = { error: "code_invalid", message: "Wrong code", attemptsLeft: 4 };
    stubFetch({ [`${CLIENT_BASE}/internal/agent-signups/complete`]: () => jsonResponse(400, refusal) });

    const res = await request(buildApp()).post("/v1/agent-signups/complete").send({ email: "agent@example.com", code: "000000" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(refusal);
    expect(calls).toHaveLength(1);
  });

  it.each([
    [404, "no_pending_code"],
    [410, "code_expired"],
    [429, "too_many_attempts"],
    [502, "billing_unavailable"],
  ])("forwards %i %s verbatim", async (status, code) => {
    const refusal = { error: code, message: "m" };
    stubFetch({ [`${CLIENT_BASE}/internal/agent-signups/complete`]: () => jsonResponse(status, refusal) });

    const res = await request(buildApp()).post("/v1/agent-signups/complete").send({ email: "agent@example.com", code: "1" });

    expect(res.status).toBe(status);
    expect(res.body).toEqual(refusal);
  });

  it("says the account is ready and to retry when the key cannot be minted", async () => {
    stubFetch({
      [`${CLIENT_BASE}/internal/agent-signups/complete`]: () => jsonResponse(200, ACCOUNT),
      [`${KEY_BASE}/api-keys`]: () => jsonResponse(500, { error: "Internal server error" }),
    });

    const res = await request(buildApp()).post("/v1/agent-signups/complete").send({ email: "agent@example.com", code: "123456" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "key_minting_failed", orgId: ACCOUNT.orgId, userId: ACCOUNT.userId });
  });

  it("refuses an empty keyName before calling anything", async () => {
    stubFetch({});
    const res = await request(buildApp()).post("/v1/agent-signups/complete").send({ email: "a@b.co", code: "1", keyName: " " });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
