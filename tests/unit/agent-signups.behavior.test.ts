import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

const { CLIENT_BASE, KEY_BASE, BILLING_BASE } = vi.hoisted(() => {
  const CLIENT_BASE = "http://client.test.local";
  const KEY_BASE = "http://key.test.local";
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  process.env.CLIENT_SERVICE_URL = CLIENT_BASE;
  process.env.CLIENT_SERVICE_API_KEY = "client-test-key";
  process.env.KEY_SERVICE_URL = KEY_BASE;
  process.env.KEY_SERVICE_API_KEY = "key-test-key";
  return { CLIENT_BASE, KEY_BASE, BILLING_BASE };
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

/** `raw` = the exact bytes sent downstream: an allowed body must arrive byte-equal. */
type Call = { url: string; method: string; headers: Record<string, string>; body: any; raw: string | undefined };
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
      raw: init?.body,
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
    [`${BILLING_BASE}/internal/accounts/by-org/${ACCOUNT.orgId}/reload-rules`]: () =>
      jsonResponse(200, {
        org_id: ACCOUNT.orgId,
        first_topup_minimum_cents: 1000,
        reload_amount_minimum_cents: 1000,
        default_reload_amount_cents: 1000,
      }),
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
      `${BILLING_BASE}/internal/accounts/by-org/${ACCOUNT.orgId}/reload-rules`,
      `${KEY_BASE}/api-keys`,
    ]);
    expect(calls[0].body).toEqual({ email: "agent@example.com", code: "123456" });
    expect(calls[2].method).toBe("POST");
    expect(calls[2].headers["x-org-id"]).toBe(ACCOUNT.orgId);
    expect(calls[2].headers["x-user-id"]).toBe(ACCOUNT.userId);
    expect(calls[2].body).toEqual({ userId: ACCOUNT.userId, createdBy: ACCOUNT.userId, name: "my agent" });
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
      rules_path: "/v1/billing/accounts/reload_rules",
      minimums_cents: { topup_amount_cents: 1000, auto_topup_amount_cents: 1000 },
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

/**
 * Security hotfix DISTRY-ONE-AI-1118: both routes are PUBLIC (no key), and client-service's
 * completion also accepts fields only a trusted channel may set (`whatsappPhone` moves a WhatsApp
 * number onto the proven account, `claimOrgId` + `claimOrgExternalId` hand an unclaimed org over).
 * A public caller states an email and its proof, nothing else.
 */
describe("public agent signup forwards only what a public agent may state", () => {
  const COMPLETE_URL = `${CLIENT_BASE}/internal/agent-signups/complete`;
  const START_URL = `${CLIENT_BASE}/internal/agent-signups/start`;
  const completeHandlers = {
    [COMPLETE_URL]: () => jsonResponse(200, ACCOUNT),
    [`${BILLING_BASE}/internal/accounts/by-org/${ACCOUNT.orgId}/reload-rules`]: () =>
      jsonResponse(200, { org_id: ACCOUNT.orgId, first_topup_minimum_cents: 1000, reload_amount_minimum_cents: 1000, default_reload_amount_cents: 1000 }),
    [`${KEY_BASE}/api-keys`]: (call: Call) => jsonResponse(200, { id: "key-id", key: "distrib.usr_secret", name: call.body.name }),
  };
  const startHandlers = { [START_URL]: () => jsonResponse(200, { email: "agent@example.com" }) };
  const INTERNAL = {
    whatsappPhone: "+33612345678",
    claimOrgId: "7f0c5b1e-3a52-4c9e-9a51-0d6f6c1f2a10",
    claimOrgExternalId: "anon_0b9c2f6e-6d1a-4f0e-9d5b-8a3f1c7e2b44",
  };
  const sentTo = (url: string) => calls.find((c) => c.url === url)!;

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("complete: whatsappPhone, claimOrgId and claimOrgExternalId never reach client-service", async () => {
    stubFetch(completeHandlers);

    const res = await request(buildApp())
      .post("/v1/agent-signups/complete")
      .send({ email: "agent@example.com", code: "123456", ...INTERNAL });

    expect(res.status).toBe(200);
    const forwarded = sentTo(COMPLETE_URL);
    expect(forwarded.raw).toBe(JSON.stringify({ email: "agent@example.com", code: "123456" }));
    for (const field of Object.keys(INTERNAL)) expect(forwarded.body).not.toHaveProperty(field);
    for (const value of Object.values(INTERNAL)) expect(forwarded.raw).not.toContain(value);
  });

  it.each([
    ["email + code", { email: "agent@example.com", code: "123456" }],
    ["email + pollToken", { email: "agent@example.com", pollToken: "pt_0123456789abcdefghij" }],
    ["the caller's own key order", { code: "123456", email: "agent@example.com" }],
  ])("complete: %s passes through byte-equal, with no warning", async (_name, sent) => {
    stubFetch(completeHandlers);

    const res = await request(buildApp()).post("/v1/agent-signups/complete").send(sent);

    expect(res.status).toBe(200);
    expect(sentTo(COMPLETE_URL).raw).toBe(JSON.stringify(sent));
    expect(warn).not.toHaveBeenCalled();
  });

  it("complete: keyName stays the gateway's (names the key, not forwarded, not reported as dropped)", async () => {
    stubFetch(completeHandlers);

    const res = await request(buildApp())
      .post("/v1/agent-signups/complete")
      .send({ email: "agent@example.com", code: "123456", keyName: "my agent" });

    expect(res.status).toBe(200);
    expect(sentTo(COMPLETE_URL).raw).toBe(JSON.stringify({ email: "agent@example.com", code: "123456" }));
    expect(sentTo(`${KEY_BASE}/api-keys`).body.name).toBe("my agent");
    expect(res.body.apiKeyName).toBe("my agent");
    expect(warn).not.toHaveBeenCalled();
  });

  it("complete: one warn line names the dropped keys, never their values", async () => {
    stubFetch(completeHandlers);

    await request(buildApp())
      .post("/v1/agent-signups/complete")
      .send({ email: "agent@example.com", code: "123456", keyName: "my agent", ...INTERNAL });

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0].join(" ");
    expect(line).toContain("[agent-signups]");
    expect(line).toContain("complete");
    for (const field of Object.keys(INTERNAL)) expect(line).toContain(field);
    for (const value of Object.values(INTERNAL)) expect(line).not.toContain(value);
    expect(line).not.toContain("agent@example.com");
    expect(line).not.toContain("123456");
    expect(line).not.toContain("keyName");
  });

  it("the warn line stays short and on one line whatever the caller names its keys", async () => {
    stubFetch(completeHandlers);
    // The forged line and the long name come first so they are among the names actually printed.
    const hostile: Record<string, string> = { "forged\n[agent-signups] line": "v", [`long${"x".repeat(5000)}`]: "v" };
    hostile.email = "agent@example.com";
    hostile.code = "123456";
    for (let i = 0; i < 300; i++) hostile[`junk${i}`] = "v";

    const res = await request(buildApp()).post("/v1/agent-signups/complete").send(hostile);

    expect(res.status).toBe(200);
    expect(sentTo(COMPLETE_URL).raw).toBe(JSON.stringify({ email: "agent@example.com", code: "123456" }));
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0].join(" ");
    expect(line.length).toBeLessThan(1000);
    expect(line).not.toContain("\n");
    expect(line).toContain("302");
  });

  it("complete: a `__proto__` key is dropped like any other", async () => {
    stubFetch(completeHandlers);

    const res = await request(buildApp())
      .post("/v1/agent-signups/complete")
      .set("content-type", "application/json")
      .send('{"email":"agent@example.com","code":"123456","__proto__":{"whatsappPhone":"+33612345678"}}');

    expect(res.status).toBe(200);
    expect(sentTo(COMPLETE_URL).raw).toBe(JSON.stringify({ email: "agent@example.com", code: "123456" }));
    expect(({} as Record<string, unknown>).whatsappPhone).toBeUndefined();
  });

  it("start: only email and phone reach client-service", async () => {
    stubFetch(startHandlers);

    const res = await request(buildApp())
      .post("/v1/agent-signups/start")
      .send({ email: "agent@example.com", phone: "+33612345678", ...INTERNAL, verified: true });

    expect(res.status).toBe(200);
    expect(sentTo(START_URL).raw).toBe(JSON.stringify({ email: "agent@example.com", phone: "+33612345678" }));
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0].join(" ");
    expect(line).toContain("start");
    expect(line).toContain("verified");
    for (const value of Object.values(INTERNAL)) expect(line).not.toContain(value);
  });

  it.each([
    ["email + phone", { email: "agent@example.com", phone: "+33612345678" }],
    ["email alone", { email: "agent@example.com" }],
    ["the caller's own key order", { phone: "+33612345678", email: "agent@example.com" }],
  ])("start: %s passes through byte-equal, with no warning", async (_name, sent) => {
    stubFetch(startHandlers);

    const res = await request(buildApp()).post("/v1/agent-signups/start").send(sent);

    expect(res.status).toBe(200);
    expect(sentTo(START_URL).raw).toBe(JSON.stringify(sent));
    expect(warn).not.toHaveBeenCalled();
  });

  it("start: a body that is not an object carries nothing downstream", async () => {
    stubFetch({ [START_URL]: () => jsonResponse(400, { error: "invalid_request", message: "email: Required" }) });

    const res = await request(buildApp())
      .post("/v1/agent-signups/start")
      .send([{ email: "agent@example.com", whatsappPhone: "+33612345678" }]);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_request", message: "email: Required" });
    expect(sentTo(START_URL).raw).toBe("{}");
  });
});
