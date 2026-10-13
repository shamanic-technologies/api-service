import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the router import.
const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { BILLING_BASE };
});

/**
 * GET /v1/billing/absorbed-costs — staff-only, byte passthrough to billing-service
 * GET /internal/absorbed-costs. Real authenticatePlatform + requireStaff run; each
 * refusal asserts ZERO outbound calls. The body is a fixture — billing owns the shape.
 */
import billingRouter from "../../src/routes/billing.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", billingRouter);
  return app;
}

const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" };
// Odd spacing + key order on purpose: byte-for-byte means NOT re-serialized.
const RAW = '{"months":[{"month":"2026-10", "orgs":[]}],"generatedAt":"2026-10-13T00:00:00Z"}';

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

describe("staff — GET /v1/billing/absorbed-costs", () => {
  it("forwards the query verbatim and returns billing's body byte-for-byte", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get("/v1/billing/absorbed-costs?fresh=true&x=a&x=b").set(STAFF);

    expect(res.status).toBe(200);
    expect(res.text).toBe(RAW);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/internal/absorbed-costs?fresh=true&x=a&x=b`);
    expect(calls[0].options.headers["X-API-Key"]).toBe("billing-test-key");
  });

  it("forwards no query string when none is sent", async () => {
    upstream(200, RAW);
    await request(buildApp()).get("/v1/billing/absorbed-costs").set(STAFF);
    expect(calls[0].url).toBe(`${BILLING_BASE}/internal/absorbed-costs`);
  });

  it("passes billing's error status through with its body", async () => {
    upstream(404, '{"error":"Not found"}');
    const res = await request(buildApp()).get("/v1/billing/absorbed-costs").set(STAFF);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("refuses the platform key without a staff email (403) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp())
      .get("/v1/billing/absorbed-costs")
      .set("X-API-Key", "admin-test-key")
      .set("x-email", "customer@example.com");
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a customer bearer key (401) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp())
      .get("/v1/billing/absorbed-costs")
      .set("Authorization", "Bearer distrib.usr_customer")
      .set("x-email", "kevin@distribute.you");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
