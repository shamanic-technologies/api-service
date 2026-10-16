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
 * An outside agent (MCP / API key) files a request to the team exactly like the Copilot's
 * request_staff (owner 2026-10-16): POST /v1/staff-requests is a byte passthrough to chat-service
 * POST /orgs/staff-requests with the caller's org, user and run; GET lists the org's requests.
 * No auth mock: the real authenticate + requireOrg + requireUser.
 */
vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

import router from "../../src/routes/agent-requests.js";
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
const AUTH = { "X-API-Key": "admin-test-key", "x-org-id": ORG, "x-user-id": USER };
let calls: Array<{ url: string; options: any }>;

function upstream(status: number, raw: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(raw, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  });
}

beforeEach(() => {
  calls = [];
});

const FEATURE = {
  kind: "feature",
  repo: "crm-service",
  title: "New step: Demo done",
  userRequest: "count a demo done as a result",
  missingPiece: "No step means a demo happened.",
  newStepOrTrigger: { kind: "step", name: "Demo done", tool: "HubSpot", event: "Deal stage moves to Demo done", example: "Jane at Acme" },
};

describe("POST /v1/staff-requests", () => {
  it("forwards the body as is to chat-service /orgs/staff-requests with the caller's identity; 201 and body byte-for-byte", async () => {
    const raw = '{"requestId":"r-1","kind":"feature","destination":"GitHub issue in crm-service + Telegram to the team","duplicate":false}';
    upstream(201, raw);
    const res = await request(buildApp()).post("/v1/staff-requests").set(AUTH).send(FEATURE);
    expect(res.status).toBe(201);
    expect(res.text).toBe(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CHAT_BASE}/orgs/staff-requests`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(FEATURE);
    expect(calls[0].options.headers["X-API-Key"]).toBe("chat-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe(ORG);
    expect(calls[0].options.headers["x-user-id"]).toBe(USER);
    expect(calls[0].options.headers["x-run-id"]).toBeTruthy();
  });

  it("a duplicate answers chat-service's 200, a refusal its 400 with the reason", async () => {
    upstream(200, '{"duplicate":true,"requestCount":2}');
    expect((await request(buildApp()).post("/v1/staff-requests").set(AUTH).send(FEATURE)).status).toBe(200);
    upstream(400, '{"error":"a new step or trigger is a \\"feature\\" request"}');
    const res = await request(buildApp()).post("/v1/staff-requests").set(AUTH).send({ ...FEATURE, kind: "bug" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("feature");
  });

  it("refuses an unauthenticated caller before any downstream call", async () => {
    upstream(201, "{}");
    const res = await request(buildApp()).post("/v1/staff-requests").send(FEATURE);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("GET /v1/staff-requests", () => {
  it("pipes chat-service GET /orgs/staff-requests for the caller's org", async () => {
    const raw = '{"requests":[{"requestId":"r-1","pieceKey":"new-step-demo-done"}]}';
    upstream(200, raw);
    const res = await request(buildApp()).get("/v1/staff-requests").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls[0].url).toBe(`${CHAT_BASE}/orgs/staff-requests`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBe(ORG);
  });
});

describe("published document", () => {
  it("a customer reads both operations, with newStepOrTrigger on the body", () => {
    const doc = buildDocument() as any;
    expect(doc.paths["/v1/staff-requests"].post).toBeDefined();
    expect(doc.paths["/v1/staff-requests"].get).toBeDefined();
    const body = doc.components.schemas.AgentStaffRequestBody;
    expect(body.properties.newStepOrTrigger).toBeDefined();
    expect(body.properties.kind.enum).toEqual(["bug", "feature", "skill_upgrade", "contact_human"]);
  });
});
