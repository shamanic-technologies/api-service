import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the routers import.
const { CHAT, CLIENT, KEY } = vi.hoisted(() => {
  const CHAT = "http://chat.test.local";
  const CLIENT = "http://client.test.local";
  const KEY = "http://key.test.local";
  process.env.CHAT_SERVICE_URL = CHAT;
  process.env.CHAT_SERVICE_API_KEY = "chat-test-key";
  process.env.CLIENT_SERVICE_URL = CLIENT;
  process.env.CLIENT_SERVICE_API_KEY = "client-test-key";
  process.env.KEY_SERVICE_URL = KEY;
  process.env.KEY_SERVICE_API_KEY = "key-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { CHAT, CLIENT, KEY };
});

/**
 * LOCAL-CLAUDE-ORGS-1116: GET /v1/local-llm/orgs answers, in ONE call, which of the caller's
 * organizations declared local Claude. The gateway decides the reach: the user's MEMBERSHIPS
 * (client-service), staff included (a staff key acts in every org but lists only its own). No auth
 * mock: the real authenticateUser drives key-service + client-service through a stubbed fetch.
 */
vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

import router from "../../src/routes/local-llm.js";
import { buildDocument } from "../../src/openapi/document.js";
import { isLocalLlmWorkCall } from "../../src/lib/call-log.js";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
// The pinned staff user row of kevin@distribute.you (SEC-STAFF-EMAIL-1120): staff = this id AND a staff email.
const USER = "7b417d70-29b5-471b-a8e1-20e75225c0af";
const CHAT_BODY = `{"orgs":[{"orgId":"${ORG_A}","declaredAt":"2026-11-16T10:00:00.000Z","declaredByUserId":"${USER}","runner":{"connected":true,"lastSeenAt":"2026-11-16T10:01:00.000Z","name":"mac","version":"1.0"},"pendingCalls":0}]}`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

let calls: string[];

function fleet(opts: { email: string; memberships: string[]; chatStatus?: number; chatBody?: string }) {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    calls.push(url);
    const json = (status: number, body: unknown) =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.startsWith(`${KEY}/validate`)) return json(200, { valid: true, orgId: ORG_B, userId: USER });
    if (url === `${CLIENT}/internal/users/${USER}`) return json(200, { user: { id: USER, email: opts.email } });
    if (url === `${CLIENT}/internal/users/${USER}/orgs`) {
      return json(200, { organizations: opts.memberships.map((orgId) => ({ orgId, name: `org ${orgId.slice(0, 4)}` })) });
    }
    if (url.startsWith(`${CLIENT}/internal/brands/all`)) return json(200, { brands: [] });
    if (url.startsWith(`${CHAT}/internal/local-llm/orgs`)) return json(opts.chatStatus ?? 200, opts.chatBody ?? CHAT_BODY);
    return json(404, { error: `unexpected ${url}` });
  });
}

const chatCalls = () => calls.filter((u) => u.startsWith(`${CHAT}/`));

beforeEach(() => {
  calls = [];
});

describe("GET /v1/local-llm/orgs with a client user key", () => {
  it("asks chat-service for the user's member orgs only, no org target needed, and pipes the answer byte-for-byte", async () => {
    fleet({ email: "founder@acme.com", memberships: [ORG_A, ORG_B] });
    const res = await request(buildApp()).get("/v1/local-llm/orgs").set({ Authorization: "Bearer distrib.usr_client" });
    expect(res.status).toBe(200);
    expect(res.text).toBe(CHAT_BODY);
    expect(chatCalls()).toEqual([`${CHAT}/internal/local-llm/orgs?orgIds=${ORG_A},${ORG_B}`]);
  });

  it("a caller-sent orgIds / x-org-id never widens the list", async () => {
    const STRANGER = "44444444-4444-4444-8444-444444444444";
    fleet({ email: "founder@acme.com", memberships: [ORG_A] });
    await request(buildApp())
      .get(`/v1/local-llm/orgs?orgIds=${STRANGER}`)
      .set({ Authorization: "Bearer distrib.usr_client" });
    expect(chatCalls()).toEqual([`${CHAT}/internal/local-llm/orgs?orgIds=${ORG_A}`]);
    expect(chatCalls()[0]).not.toContain(STRANGER);
  });

  it("a client with no membership is refused at auth (no_organization), never a fleet-wide read", async () => {
    fleet({ email: "founder@acme.com", memberships: [] });
    const res = await request(buildApp()).get("/v1/local-llm/orgs").set({ Authorization: "Bearer distrib.usr_client" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("no_organization");
    expect(chatCalls()).toEqual([]);
  });

  it("chat-service's refusal keeps its status and body", async () => {
    fleet({ email: "founder@acme.com", memberships: [ORG_A], chatStatus: 400, chatBody: '{"error":"orgIds: not an internal org id (UUID)"}' });
    const res = await request(buildApp()).get("/v1/local-llm/orgs").set({ Authorization: "Bearer distrib.usr_client" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "orgIds: not an internal org id (UUID)" });
  });
});

describe("GET /v1/local-llm/orgs with a staff key", () => {
  it("lists only the staff user's REAL memberships, never every org (orgIds always sent)", async () => {
    fleet({ email: "kevin@distribute.you", memberships: [ORG_B] });
    const res = await request(buildApp()).get("/v1/local-llm/orgs").set({ Authorization: "Bearer distrib.usr_staff" });
    expect(res.status).toBe(200);
    expect(chatCalls()).toEqual([`${CHAT}/internal/local-llm/orgs?orgIds=${ORG_B}`]);
  });
});

describe("GET /v1/local-llm/orgs with a staff key and no membership", () => {
  it("asks for none (empty orgIds), never the omitted-orgIds every-org read", async () => {
    fleet({ email: "kevin@distribute.you", memberships: [], chatBody: '{"orgs":[]}' });
    const res = await request(buildApp()).get("/v1/local-llm/orgs").set({ Authorization: "Bearer distrib.usr_staff" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orgs: [] });
    expect(chatCalls()).toEqual([`${CHAT}/internal/local-llm/orgs?orgIds=`]);
  });
});

describe("GET /v1/local-llm/orgs with the platform key (dashboard)", () => {
  it("reads the resolved user's memberships", async () => {
    fleet({ email: "founder@acme.com", memberships: [ORG_A, ORG_B] });
    const res = await request(buildApp())
      .get("/v1/local-llm/orgs")
      .set({ "X-API-Key": "admin-test-key", "x-org-id": ORG_A, "x-user-id": USER });
    expect(res.status).toBe(200);
    expect(res.text).toBe(CHAT_BODY);
    expect(chatCalls()).toEqual([`${CHAT}/internal/local-llm/orgs?orgIds=${ORG_A},${ORG_B}`]);
  });
});

describe("GET /v1/local-llm/orgs gate", () => {
  it("refuses an unauthenticated caller before any downstream call", async () => {
    fleet({ email: "founder@acme.com", memberships: [ORG_A] });
    const res = await request(buildApp()).get("/v1/local-llm/orgs");
    expect(res.status).toBe(401);
    expect(chatCalls()).toEqual([]);
  });

  it("is skipped by the call log (a 30 s machine refresh)", () => {
    expect(isLocalLlmWorkCall("/v1/local-llm/orgs")).toBe(true);
    expect(isLocalLlmWorkCall("/v1/local-llm/orgs?x=1")).toBe(true);
    expect(isLocalLlmWorkCall("/v1/local-llm")).toBe(false);
  });

  it("is in the customer document", () => {
    const doc = buildDocument() as any;
    expect(doc.paths["/v1/local-llm/orgs"]?.get).toBeTruthy();
  });
});
