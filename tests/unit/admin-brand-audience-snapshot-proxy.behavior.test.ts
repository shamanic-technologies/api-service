import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices reads *_SERVICE_URL lazily, but set them before the router import anyway.
const { HUMAN_BASE } = vi.hoisted(() => {
  const HUMAN_BASE = "http://human.test.local";
  process.env.HUMAN_SERVICE_URL = HUMAN_BASE;
  process.env.HUMAN_SERVICE_API_KEY = "human-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { HUMAN_BASE };
});

/**
 * GET /v1/admin/brands/:brandId/audience-snapshot[/people|/companies] — staff-only
 * byte passthrough to human-service /internal/brands/{brandId}/audience-snapshot*.
 *
 * No auth mock: the real authenticatePlatform + requireStaff run, so each refusal is
 * a fact about the shipped gate and asserts ZERO outbound calls. Bodies are fixtures,
 * human-service owns the shape (CLAUDE.md #6/#8).
 */
import adminBrandsRouter from "../../src/routes/admin-brands.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", adminBrandsRouter);
  return app;
}

const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" };
const BRAND = "7d9cc3d9-15ec-4357-bfe9-49b17dadb90c";
// Odd spacing on purpose: byte-for-byte means NOT re-serialized.
const RAW = '{"brandId":"' + BRAND + '", "lists":[]}';

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

describe.each(["", "/people", "/companies"])("staff — GET /v1/admin/brands/:brandId/audience-snapshot%s", (suffix) => {
  const path = `/v1/admin/brands/${BRAND}/audience-snapshot${suffix}`;

  it("forwards to human-service's exact path with the query verbatim, body byte-for-byte", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(`${path}?orgId=o1&limit=500&offset=50&acceptedOnly=true`).set(STAFF);

    expect(res.status).toBe(200);
    expect(res.text).toBe(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${HUMAN_BASE}/internal/brands/${BRAND}/audience-snapshot${suffix}?orgId=o1&limit=500&offset=50&acceptedOnly=true`
    );
    expect(calls[0].options.headers["X-API-Key"]).toBe("human-test-key");
  });

  it("forwards no query string when none is sent", async () => {
    upstream(200, RAW);
    await request(buildApp()).get(path).set(STAFF);
    expect(calls[0].url).toBe(`${HUMAN_BASE}/internal/brands/${BRAND}/audience-snapshot${suffix}`);
  });

  it("passes human-service's 400 through with its body", async () => {
    const raw = '{"error":"Invalid brand id","code":"INVALID_BRAND_ID"}';
    upstream(400, raw);
    const res = await request(buildApp()).get(`/v1/admin/brands/nope/audience-snapshot${suffix}`).set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(JSON.parse(raw));
  });

  it("refuses the platform key without a staff email (403) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp())
      .get(path)
      .set("X-API-Key", "admin-test-key")
      .set("x-email", "customer@example.com");
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a wrong platform key (401) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(path).set("X-API-Key", "nope").set("x-email", "kevin@distribute.you");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a customer bearer key (401) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp())
      .get(path)
      .set("Authorization", "Bearer distrib.usr_customer")
      .set("x-email", "kevin@distribute.you");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
