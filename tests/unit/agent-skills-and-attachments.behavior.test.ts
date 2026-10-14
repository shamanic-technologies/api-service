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
 * A client's AI agent must be able to set up "attach the right PDF on replies" alone, from the
 * published document:
 *   - GET /v1/skills[/:slug]: the agent skill tree, read-only, any authenticated caller, byte
 *     passthrough to chat-service /internal/skills[/:slug] (no auth mock: the real authenticateUser).
 *   - the published document tells the truth about attachments and the play chain, lists a
 *     brand's offers, and documents `attachments` on POST /v1/replies.
 */
vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

import router from "../../src/routes/agent-skills.js";
import { buildDocument } from "../../src/openapi/document.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

const AUTH = {
  "X-API-Key": "admin-test-key",
  "x-org-id": "11111111-1111-4111-8111-111111111111",
  "x-user-id": "22222222-2222-4222-8222-222222222222",
};
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

describe("GET /v1/skills (agent skill tree, read-only)", () => {
  it("list: exact downstream path, query verbatim, body byte-for-byte", async () => {
    const raw = '{"skills":[{"slug":"index","parentSlug":null,"title":"Copilot method and map"}],"x":1}';
    upstream(200, raw);
    const res = await request(buildApp()).get("/v1/skills?a=1&a=2").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls[0].url).toBe(`${CHAT_BASE}/internal/skills?a=1&a=2`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["X-API-Key"]).toBe("chat-test-key");
  });

  it("read one: slug encoded into chat-service's own path", async () => {
    const raw = '{"slug":"offers","content":"# Offers"}';
    upstream(200, raw);
    const res = await request(buildApp()).get("/v1/skills/offers").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls[0].url).toBe(`${CHAT_BASE}/internal/skills/offers`);
  });

  it("unknown slug: chat-service's 404 reaches the caller with its body", async () => {
    upstream(404, '{"error":"Skill not found"}');
    const res = await request(buildApp()).get("/v1/skills/nope").set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Skill not found" });
  });

  it("no credentials: 401, nothing reaches chat-service", async () => {
    upstream(200, "{}");
    const res = await request(buildApp()).get("/v1/skills");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("no write route: PUT is not served here", async () => {
    upstream(200, "{}");
    const res = await request(buildApp()).put("/v1/skills/index").set(AUTH).send({ content: "x" });
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe("published document: an agent can find the whole attachment setup", () => {
  const doc = buildDocument() as any;
  const op = (method: string, path: string) => doc.paths[path]?.[method];

  it("lists the skill tree reads and a brand's offers", () => {
    for (const [m, p] of [
      ["get", "/v1/skills"],
      ["get", "/v1/skills/{slug}"],
      ["get", "/v1/brands/{id}/offers"],
      ["get", "/v1/brands/{id}/offers/{offerId}"],
    ]) {
      expect(op(m, p), `${m} ${p}`).toBeDefined();
    }
  });

  it("offer documents say how an attachment really happens, and point to the play chain", () => {
    const text = op("post", "/v1/brands/{id}/offers/{offerId}/documents").description as string;
    expect(text).toContain("attachment");
    expect(text).toContain("POST /v1/replies");
    expect(text).toContain("POST /v1/plays");
    expect(text).toContain("POST /v1/sales-funnel-campaigns");
    expect(text).not.toContain("The AI answering a prospect reads the list (fileName + description) to pick the one that helps and attaches it");
  });

  it("plays and sales funnel campaigns explain how to change a campaign's behaviour", () => {
    expect(op("post", "/v1/plays").description).toContain("GET /v1/offers/{offerId}/sales-funnels");
    expect(op("post", "/v1/sales-funnel-campaigns").description).toContain("status: stopped");
    const plays = doc.tags.find((t: any) => t.name === "Plays");
    expect(plays.description).toContain("attachment");
  });

  it("POST /v1/replies documents attachments", () => {
    const reply = op("post", "/v1/replies");
    expect(reply.description).toContain("attachments");
    const schema = JSON.stringify(reply.requestBody);
    expect(schema).toContain("document_id");
  });
});
