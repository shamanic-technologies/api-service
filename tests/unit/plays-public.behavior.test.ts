import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the routers import.
const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { FEATURES_BASE };
});

/**
 * Tactics, strategies and plays for any authenticated caller — byte passthrough to
 * features-service /internal/catalogue/{tactics,strategies,plays}:
 *   GET  /v1/<object>      → GET  /internal/catalogue/<object>
 *   GET  /v1/<object>/:id  → GET  /internal/catalogue/<object>/:id
 *   POST /v1/<object>      → POST /internal/catalogue/<object>, `createdBy` = the caller's identity
 *
 * No auth mock: the real `authenticateUser` runs (platform-key path with internal ids, which needs no
 * network), so the identity the producer records is the one the gateway authenticated.
 */
vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

import router, { PLAY_OBJECTS } from "../../src/routes/plays.js";
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
const RAW = '{"object":"play","total":1,"truncated":false,"rows":[{"id":"x"}],"someNewField":true}';

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

it("serves tactics, strategies and plays", () => {
  expect([...PLAY_OBJECTS]).toEqual(["tactics", "strategies", "plays"]);
});

for (const object of PLAY_OBJECTS) {
  describe(`/v1/${object}`, () => {
    it("list: exact downstream path, query verbatim, body byte-for-byte", async () => {
      upstream(200, RAW);
      const res = await request(buildApp()).get(`/v1/${object}?pipe=a%7Cb&limit=5&future=1`).set(AUTH);
      expect(res.status).toBe(200);
      expect(res.text).toBe(RAW);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/${object}?pipe=a%7Cb&limit=5&future=1`);
      expect(calls[0].options.method).toBe("GET");
      expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
    });

    it("read one: id re-encoded (a play id carries | and ~)", async () => {
      upstream(200, RAW);
      const res = await request(buildApp()).get(`/v1/${object}/${encodeURIComponent("sales-cold-email-outreach|lead_found_to_website_visit~valid-catch-all")}`).set(AUTH);
      expect(res.status).toBe(200);
      expect(res.text).toBe(RAW);
      expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/${object}/sales-cold-email-outreach%7Clead_found_to_website_visit~valid-catch-all`);
    });

    it("create: body forwarded, createdBy forced to the authenticated identity (a sent one is overwritten)", async () => {
      upstream(201, RAW);
      const sent = { name: "X", description: "Y", requires: ["catch-all"], pipeId: "p", strategyId: "s", createdBy: "someone-else" };
      const res = await request(buildApp()).post(`/v1/${object}`).set(AUTH).send(sent);
      expect(res.status).toBe(201);
      expect(res.text).toBe(RAW);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/${object}`);
      expect(calls[0].options.method).toBe("POST");
      expect(JSON.parse(calls[0].options.body)).toEqual({ ...sent, createdBy: `org:${ORG}/user:${USER}` });
    });

    it("create: an idempotent 200 stays a 200", async () => {
      upstream(200, '{"created":false}');
      const res = await request(buildApp()).post(`/v1/${object}`).set(AUTH).send({ pipeId: "p", strategyId: "s" });
      expect(res.status).toBe(200);
      expect(res.text).toBe('{"created":false}');
    });

    it("producer 400 / 404 / 409 reach the caller with status and named body", async () => {
      for (const [status, body] of [
        [400, { error: "no default play", reason: "pipe_has_no_default_play" }],
        [404, { error: "no tactic", reason: "tactic_not_found" }],
        [409, { error: "taken", reason: "tactic_name_taken" }],
      ] as const) {
        upstream(status, JSON.stringify(body));
        const res = await request(buildApp()).post(`/v1/${object}`).set(AUTH).send({ name: "X" });
        expect(res.status).toBe(status);
        expect(res.body).toEqual(body);
      }
    });

    it("no credentials: 401, nothing reaches features-service", async () => {
      upstream(200, RAW);
      const list = await request(buildApp()).get(`/v1/${object}`);
      const create = await request(buildApp()).post(`/v1/${object}`).send({ name: "X", createdBy: "forged" });
      expect(list.status).toBe(401);
      expect(create.status).toBe(401);
      expect(calls).toHaveLength(0);
    });
  });
}

describe("published customer document", () => {
  const doc = buildDocument() as any;
  const ops: Array<[string, string]> = [
    ["/v1/tactics", "get"], ["/v1/tactics/{id}", "get"], ["/v1/tactics", "post"],
    ["/v1/strategies", "get"], ["/v1/strategies/{id}", "get"], ["/v1/strategies", "post"],
    ["/v1/plays", "get"], ["/v1/plays/{id}", "get"], ["/v1/plays", "post"],
  ];
  for (const [path, method] of ops) {
    it(`lists ${method.toUpperCase()} ${path} with bearer auth`, () => {
      const op = doc.paths[path]?.[method];
      expect(op).toBeDefined();
      expect(op.tags).toEqual(["Plays"]);
      expect(JSON.stringify(op.security)).toContain("bearerAuth");
    });
  }
  it("never documents createdBy as a request field", () => {
    for (const path of ["/v1/tactics", "/v1/strategies", "/v1/plays"]) {
      expect(JSON.stringify(doc.paths[path].post.requestBody)).not.toContain("createdBy");
    }
  });
});
