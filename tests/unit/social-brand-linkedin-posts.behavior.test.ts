import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the router imports.
const { SOCIAL_BASE } = vi.hoisted(() => {
  const SOCIAL_BASE = "http://social.test.local";
  process.env.SOCIAL_SERVICE_URL = SOCIAL_BASE;
  process.env.SOCIAL_SERVICE_API_KEY = "social-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { SOCIAL_BASE };
});

/**
 * GET /v1/social/brands/:brandId/linkedin-posts → social-service
 * GET /internal/brands/:brandId/linkedin-posts. Staff-only (platform spend), no org.
 * No auth mock: the real authenticatePlatform + requireStaff run; every refusal asserts
 * ZERO outbound calls. The body is a fixture — social-service owns the shape.
 */
import socialRouter from "../../src/routes/social.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(socialRouter);
  return app;
}

const BRAND = "9abe30d6-391c-445f-9efd-57a2ee5940dc";
const PATH = `/v1/social/brands/${BRAND}/linkedin-posts`;
const DOWNSTREAM = `${SOCIAL_BASE}/internal/brands/${BRAND}/linkedin-posts`;
const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" };
const RAW = '{"brandId":"9abe30d6-391c-445f-9efd-57a2ee5940dc", "status":"no_linkedin_page","posts":[],"someNewField":true}';

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

describe("staff — GET /v1/social/brands/:brandId/linkedin-posts", () => {
  it("forwards to the exact downstream path with the query verbatim and the social key, body byte-for-byte", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(`${PATH}?limit=5&cursor=10&x=a&x=b`).set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DOWNSTREAM}?limit=5&cursor=10&x=a&x=b`);
    expect(calls[0].options.headers["X-API-Key"]).toBe("social-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("forwards no query string when none is sent", async () => {
    upstream(200, RAW);
    await request(buildApp()).get(PATH).set(STAFF);
    expect(calls[0].url).toBe(DOWNSTREAM);
  });

  it("keeps a slash-carrying brand id ONE encoded segment (never reaches another social-service route)", async () => {
    upstream(200, RAW);
    await request(buildApp()).get("/v1/social/brands/..%2F..%2Fdaily-runs/linkedin-posts").set(STAFF);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/internal/brands/..%2F..%2Fdaily-runs/linkedin-posts`);
  });

  it("passes a downstream 404 / 502 through with its body", async () => {
    const raw = '{"type":"not_found","error":"brand-service answered 404 for brand x"}';
    upstream(404, raw);
    const res = await request(buildApp()).get(PATH).set(STAFF);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(JSON.parse(raw));

    upstream(502, '{"type":"upstream","error":"treg down"}');
    const r2 = await request(buildApp()).get(PATH).set(STAFF);
    expect(r2.status).toBe(502);
    expect(r2.body).toEqual({ type: "upstream", error: "treg down" });
  });

  it("refuses the platform key without a staff email (403) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(PATH).set("X-API-Key", "admin-test-key").set("x-email", "customer@example.com");
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a wrong platform key (401) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(PATH).set("X-API-Key", "nope").set("x-email", "kevin@distribute.you");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a customer bearer key (401) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(PATH).set("Authorization", "Bearer distrib.usr_customer").set("x-email", "kevin@distribute.you");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
