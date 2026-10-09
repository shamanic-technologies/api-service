import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the router imports.
const { CHAT_BASE } = vi.hoisted(() => {
  const CHAT_BASE = "http://chat.test.local";
  process.env.CHAT_SERVICE_URL = CHAT_BASE;
  process.env.CHAT_SERVICE_API_KEY = "chat-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { CHAT_BASE };
});

/**
 * Staff Copilot skills + staff requests — byte passthrough to chat-service:
 *   GET /v1/chat/skills                              → GET /internal/skills
 *   GET /v1/chat/skills/:slug                        → GET /internal/skills/:slug
 *   PUT /v1/chat/skills/:slug                        → PUT /internal/skills/:slug (editedBy = staff email)
 *   GET /v1/chat/skills/:slug/versions               → GET /internal/skills/:slug/versions
 *   GET /v1/chat/skills/:slug/versions/:version      → GET /internal/skills/:slug/versions/:version
 *   GET /v1/chat/staff-requests                      → GET /internal/staff-requests
 *
 * No auth mock: the real authenticatePlatform + requireStaff run, and every refusal
 * asserts ZERO outbound calls. Bodies are fixtures — chat-service owns the shape.
 */
import router from "../../src/routes/chat-skills-staff.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

const STAFF = { "X-API-Key": "admin-test-key", "x-email": "Kevin@Distribute.you" };
const RAW = '{"skills":[{"slug":"index", "parentSlug":null}],"someNewField":true}';

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

const ROUTES: Array<{ method: "get" | "put"; path: string; downstream: string; body?: object }> = [
  { method: "get", path: "/v1/chat/skills", downstream: `${CHAT_BASE}/internal/skills` },
  { method: "get", path: "/v1/chat/skills/campaigns", downstream: `${CHAT_BASE}/internal/skills/campaigns` },
  { method: "put", path: "/v1/chat/skills/campaigns", downstream: `${CHAT_BASE}/internal/skills/campaigns`, body: { content: "# x" } },
  { method: "get", path: "/v1/chat/skills/campaigns/versions", downstream: `${CHAT_BASE}/internal/skills/campaigns/versions` },
  { method: "get", path: "/v1/chat/skills/campaigns/versions/3", downstream: `${CHAT_BASE}/internal/skills/campaigns/versions/3` },
  { method: "get", path: "/v1/chat/staff-requests", downstream: `${CHAT_BASE}/internal/staff-requests` },
];

for (const r of ROUTES) {
  describe(`staff — ${r.method.toUpperCase()} ${r.path}`, () => {
    it("reaches the exact downstream path with the chat key and returns the body byte-for-byte", async () => {
      upstream(200, RAW);
      const res = await request(buildApp())[r.method](r.path).set(STAFF).send(r.body);
      expect(res.status).toBe(200);
      expect(res.text).toBe(RAW);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(r.downstream);
      expect(calls[0].options.method).toBe(r.method.toUpperCase());
      expect(calls[0].options.headers["X-API-Key"]).toBe("chat-test-key");
      expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
    });

    it("passes a downstream 404 through with its body", async () => {
      const raw = '{"error":"Skill \\"nope\\" not found."}';
      upstream(404, raw);
      const res = await request(buildApp())[r.method](r.path).set(STAFF).send(r.body);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(JSON.parse(raw));
    });

    it("refuses the platform key without a staff email (403) and calls nothing", async () => {
      upstream(200, RAW);
      const res = await request(buildApp())[r.method](r.path)
        .set("X-API-Key", "admin-test-key")
        .set("x-email", "customer@example.com")
        .send(r.body);
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it("refuses a wrong platform key (401) and calls nothing", async () => {
      upstream(200, RAW);
      const res = await request(buildApp())[r.method](r.path).set("X-API-Key", "nope").set("x-email", "kevin@distribute.you").send(r.body);
      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    it("refuses a customer bearer key (401) and calls nothing", async () => {
      upstream(200, RAW);
      const res = await request(buildApp())[r.method](r.path)
        .set("Authorization", "Bearer distrib.usr_customer")
        .set("x-email", "kevin@distribute.you")
        .send(r.body);
      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });
  });
}

describe("staff — PUT /v1/chat/skills/:slug sets editedBy from auth", () => {
  it("forwards the body with editedBy = the signed-in staff email, replacing the browser's value", async () => {
    upstream(200, "{}");
    const sent = { content: "# Campaigns", title: "Campaigns", description: "d", parentSlug: "index", position: 2, futureField: 1, editedBy: "seed" };
    await request(buildApp()).put("/v1/chat/skills/campaigns").set(STAFF).send(sent);
    expect(JSON.parse(calls[0].options.body)).toEqual({ ...sent, editedBy: "kevin@distribute.you" });
  });

  it("forwards editedBy even when the browser sends none", async () => {
    upstream(200, "{}");
    await request(buildApp()).put("/v1/chat/skills/campaigns").set(STAFF).send({ content: "x" });
    expect(JSON.parse(calls[0].options.body)).toEqual({ content: "x", editedBy: "kevin@distribute.you" });
  });

  it("refuses a non-object body (400) and calls nothing", async () => {
    upstream(200, "{}");
    const res = await request(buildApp()).put("/v1/chat/skills/campaigns").set(STAFF).send([{ content: "x" }]);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("staff — GET /v1/chat/staff-requests query", () => {
  it("forwards the query string verbatim", async () => {
    upstream(200, RAW);
    const q = "?orgId=0b2d6f1e-3c4a-4d5e-8f60-718293a4b5c6&limit=20&x=a&x=b";
    await request(buildApp()).get(`/v1/chat/staff-requests${q}`).set(STAFF);
    expect(calls[0].url).toBe(`${CHAT_BASE}/internal/staff-requests${q}`);
  });
});

describe("staff — slug is encoded, never a path escape", () => {
  it("encodes a slash-carrying slug into one segment", async () => {
    upstream(200, "{}");
    await request(buildApp()).get("/v1/chat/skills/a%2Fb").set(STAFF);
    expect(calls[0].url).toBe(`${CHAT_BASE}/internal/skills/a%2Fb`);
  });
});
