import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices reads *_SERVICE_URL lazily, but set them before the router import anyway.
const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { FEATURES_BASE };
});

/**
 * GET /v1/admin/brands/:brandId/sourcing-investment[/people|/companies] — staff-only
 * byte passthrough to features-service /brands/{brandId}/sourcing-investment*, under
 * the VIEWED org's identity headers. Carries our vendor cost (margin).
 *
 * No auth mock: the real authenticatePlatform + requireStaff + authenticate chain runs,
 * so each refusal is a fact about the shipped gate and asserts ZERO outbound calls
 * (runs-service createRun included). Bodies are fixtures, features-service owns the
 * shape (CLAUDE.md #6/#8).
 */
const { createRun } = vi.hoisted(() => ({ createRun: vi.fn() }));
vi.mock("@distribute/runs-client", () => ({
  createRun,
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

import adminBrandsRouter from "../../src/routes/admin-brands.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", adminBrandsRouter);
  return app;
}

const ORG = "fc600ac6-d6d4-4086-861d-fe12683d0637";
const USER = "7d7d6c9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const BRAND = "7d9cc3d9-15ec-4357-bfe9-49b17dadb90c";
const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you", "x-org-id": ORG, "x-user-id": USER };
// Odd spacing on purpose: byte-for-byte means NOT re-serialized.
const RAW = '{"total":{"billedUsd":"51.138225", "vendorUsd":null},"audiences":[]}';

let calls: Array<{ url: string; options: any }>;

function upstream(status: number, raw: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(raw, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  });
}

beforeEach(() => {
  calls = [];
  createRun.mockReset().mockResolvedValue({ id: "run-1" });
});

describe.each(["", "/people", "/companies"])("staff — GET /v1/admin/brands/:brandId/sourcing-investment%s", (suffix) => {
  const path = `/v1/admin/brands/${BRAND}/sourcing-investment${suffix}`;

  it("forwards to features-service's exact path with the viewed org's identity and the query verbatim, body byte-for-byte", async () => {
    upstream(200, RAW);
    const res = await request(buildApp())
      .get(`${path}?limit=500&offset=50&apolloPersonIds=a,b&domains=x.com`)
      .set(STAFF);

    expect(res.status).toBe(200);
    expect(res.text).toBe(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/brands/${BRAND}/sourcing-investment${suffix}?limit=500&offset=50&apolloPersonIds=a,b&domains=x.com`
    );
    expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe(ORG);
    expect(calls[0].options.headers["x-user-id"]).toBe(USER);
  });

  it("forwards no query string when none is sent", async () => {
    upstream(200, RAW);
    await request(buildApp()).get(path).set(STAFF);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/brands/${BRAND}/sourcing-investment${suffix}`);
  });

  it("passes features-service's 400 through with its status and body", async () => {
    const raw = '{"error":"limit must be 1..500","code":"INVALID_LIMIT"}';
    upstream(400, raw);
    const res = await request(buildApp()).get(`${path}?limit=9999`).set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(JSON.parse(raw));
  });

  it("refuses the platform key without a staff email (403) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(path).set({ ...STAFF, "x-email": "customer@example.com" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("refuses a wrong platform key (401) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(path).set({ ...STAFF, "X-API-Key": "nope" });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("refuses a customer bearer key (401) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp())
      .get(path)
      .set({ Authorization: "Bearer distrib.usr_customer", "x-email": "kevin@distribute.you", "x-org-id": ORG, "x-user-id": USER });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("refuses a staff call that names no org (400) and calls nothing downstream", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get(path).set({ "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
