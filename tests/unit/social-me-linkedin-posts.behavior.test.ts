import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the router imports.
const { SOCIAL_BASE, CLIENT_BASE } = vi.hoisted(() => {
  const SOCIAL_BASE = "http://social.test.local";
  const CLIENT_BASE = "http://client.test.local";
  process.env.SOCIAL_SERVICE_URL = SOCIAL_BASE;
  process.env.SOCIAL_SERVICE_API_KEY = "social-test-key";
  process.env.CLIENT_SERVICE_URL = CLIENT_BASE;
  process.env.CLIENT_SERVICE_API_KEY = "client-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { SOCIAL_BASE, CLIENT_BASE };
});

// authenticate opens a request run in runs-service; stub it so `calls` holds only real
// outbound requests. Every refusal asserts createRun was NOT called: the staff gate runs
// before identity resolution.
const { createRun } = vi.hoisted(() => ({ createRun: vi.fn() }));
vi.mock("@distribute/runs-client", () => ({
  createRun,
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

/**
 * GET /v1/social/me/linkedin-posts → social-service GET /internal/users/{userId}/linkedin-posts.
 * Staff-only, and the user is the AUTHENTICATED one: no auth mock, the real
 * authenticatePlatform + requireStaff + authenticateUser chain runs.
 */
import socialRouter from "../../src/routes/social.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(socialRouter);
  return app;
}

const ORG = "2c2c1c9f-9a7b-4a0b-8b2f-8d2a3a4b5c6d";
const USER = "7d7d6c9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const RESOLVED_USER = "1b1b1c9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const PATH = "/v1/social/me/linkedin-posts";
const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" };
const RAW = '{"userId":"7d7d6c9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f", "status":"no_linkedin_profile","posts":[],"someNewField":true}';

let calls: Array<{ url: string; options: any }>;

function upstream(status: number, raw: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    if (url.startsWith(CLIENT_BASE)) {
      return new Response(JSON.stringify({ orgId: ORG, userId: RESOLVED_USER }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(raw, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  });
}

const socialCalls = () => calls.filter((c) => c.url.startsWith(SOCIAL_BASE));

beforeEach(() => {
  calls = [];
  createRun.mockReset();
  createRun.mockResolvedValue({ id: "run-1" });
});

describe("staff — GET /v1/social/me/linkedin-posts", () => {
  it("forwards to the AUTHENTICATED user's path, query verbatim, identity headers, body byte-for-byte", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(`${PATH}?limit=5&cursor=10&x=a&x=b`).set({ ...STAFF, "x-org-id": ORG, "x-user-id": USER });
    expect(res.status).toBe(200);
    expect(res.text).toBe(RAW);
    expect(socialCalls()).toHaveLength(1);
    expect(socialCalls()[0].url).toBe(`${SOCIAL_BASE}/internal/users/${USER}/linkedin-posts?limit=5&cursor=10&x=a&x=b`);
    expect(socialCalls()[0].options.headers["X-API-Key"]).toBe("social-test-key");
    expect(socialCalls()[0].options.headers["x-user-id"]).toBe(USER);
    expect(socialCalls()[0].options.headers["x-run-id"]).toBe("run-1");
  });

  it("a dashboard call (external ids) reads the user client-service resolved", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(PATH).set({ ...STAFF, "x-external-org-id": "org_abc", "x-external-user-id": "user_abc" });
    expect(res.status).toBe(200);
    expect(socialCalls()[0].url).toBe(`${SOCIAL_BASE}/internal/users/${RESOLVED_USER}/linkedin-posts`);
    expect(socialCalls()[0].options.headers["x-user-id"]).toBe(RESOLVED_USER);
  });

  it("a user id in the query names nothing: the path is always the authenticated user", async () => {
    upstream(200, RAW);
    await request(buildApp()).get(`${PATH}?userId=someone-else`).set({ ...STAFF, "x-org-id": ORG, "x-user-id": USER });
    expect(socialCalls()[0].url).toBe(`${SOCIAL_BASE}/internal/users/${USER}/linkedin-posts?userId=someone-else`);
  });

  it("passes a downstream 404 / 502 through with its body", async () => {
    upstream(404, '{"type":"not_found","error":"client-service answered 404 for user x"}');
    const res = await request(buildApp()).get(PATH).set({ ...STAFF, "x-org-id": ORG, "x-user-id": USER });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ type: "not_found", error: "client-service answered 404 for user x" });
    upstream(502, '{"type":"upstream","error":"treg down"}');
    const r2 = await request(buildApp()).get(PATH).set({ ...STAFF, "x-org-id": ORG, "x-user-id": USER });
    expect(r2.status).toBe(502);
    expect(r2.body).toEqual({ type: "upstream", error: "treg down" });
  });

  it("staff without identity headers: 400, nothing called downstream", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(PATH).set(STAFF);
    expect(res.status).toBe(400);
    expect(socialCalls()).toHaveLength(0);
  });

  it("refuses the platform key without a staff email (403) before any identity resolution", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(PATH).set({ "X-API-Key": "admin-test-key", "x-email": "customer@example.com", "x-external-org-id": "org_abc", "x-external-user-id": "user_abc" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("refuses a wrong platform key (401) and a customer bearer key (401), calling nothing", async () => {
    upstream(200, RAW);
    expect((await request(buildApp()).get(PATH).set({ "X-API-Key": "nope", "x-email": "kevin@distribute.you", "x-org-id": ORG, "x-user-id": USER })).status).toBe(401);
    expect((await request(buildApp()).get(PATH).set({ Authorization: "Bearer distrib.usr_customer", "x-email": "kevin@distribute.you" })).status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(createRun).not.toHaveBeenCalled();
  });
});
