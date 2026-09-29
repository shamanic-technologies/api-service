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
 * GET /v1/billing/revenue/fleet and /v1/billing/revenue/by-org/:orgId — staff-only
 * cross-org financials, byte passthrough to billing-service /internal/revenue/*.
 *
 * No auth mock: the real authenticatePlatform + requireStaff run, so the refusals are
 * facts about the shipped gate, and each refusal asserts ZERO outbound calls.
 * The bodies below are fixtures — billing owns the shape (CLAUDE.md #6/#8).
 */
import billingRouter from "../../src/routes/billing.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", billingRouter);
  return app;
}

const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" };
const ORG = "0b2d6f1e-3c4a-4d5e-8f60-718293a4b5c6";
// Odd spacing + key order on purpose: byte-for-byte means NOT re-serialized.
const FLEET_RAW = '{"recurring":{"mrrCents":123400, "arrCents":1480800},"cashHorizonDays":30,"orgs":[]}';

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

describe("staff — GET /v1/billing/revenue/fleet", () => {
  it("forwards the query verbatim and returns billing's body byte-for-byte", async () => {
    upstream(200, FLEET_RAW);
    const res = await request(buildApp()).get("/v1/billing/revenue/fleet?cashHorizonDays=30&x=a&x=b").set(STAFF);

    expect(res.status).toBe(200);
    expect(res.text).toBe(FLEET_RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/internal/revenue/fleet?cashHorizonDays=30&x=a&x=b`);
    expect(calls[0].options.headers["X-API-Key"]).toBe("billing-test-key");
  });

  it("forwards no query string when none is sent", async () => {
    upstream(200, FLEET_RAW);
    await request(buildApp()).get("/v1/billing/revenue/fleet").set(STAFF);
    expect(calls[0].url).toBe(`${BILLING_BASE}/internal/revenue/fleet`);
  });

  it("passes billing's 400 through with its body", async () => {
    const raw = '{"error":"cashHorizonDays must be an integer from 90 to 365"}';
    upstream(400, raw);
    const res = await request(buildApp()).get("/v1/billing/revenue/fleet?cashHorizonDays=5").set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(JSON.parse(raw));
  });

  it("refuses the platform key without a staff email (403) and calls nothing", async () => {
    upstream(200, FLEET_RAW);
    const res = await request(buildApp())
      .get("/v1/billing/revenue/fleet")
      .set("X-API-Key", "admin-test-key")
      .set("x-email", "customer@example.com");
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a wrong platform key (401) and calls nothing", async () => {
    upstream(200, FLEET_RAW);
    const res = await request(buildApp())
      .get("/v1/billing/revenue/fleet")
      .set("X-API-Key", "nope")
      .set("x-email", "kevin@distribute.you");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a customer bearer key (401) and calls nothing", async () => {
    upstream(200, FLEET_RAW);
    const res = await request(buildApp())
      .get("/v1/billing/revenue/fleet")
      .set("Authorization", "Bearer distrib.usr_customer")
      .set("x-email", "kevin@distribute.you");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("staff — GET /v1/billing/revenue/by-org/:orgId", () => {
  it("forwards to billing's by-org path with the query verbatim, body byte-for-byte", async () => {
    const raw = '{"orgId":"' + ORG + '", "recurring":{}}';
    upstream(200, raw);
    const res = await request(buildApp()).get(`/v1/billing/revenue/by-org/${ORG}?cashHorizonDays=7`).set(STAFF);

    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls[0].url).toBe(`${BILLING_BASE}/internal/revenue/by-org/${ORG}?cashHorizonDays=7`);
  });

  it("passes billing's 404 through", async () => {
    upstream(404, '{"error":"No billing account"}');
    const res = await request(buildApp()).get(`/v1/billing/revenue/by-org/${ORG}`).set(STAFF);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No billing account" });
  });

  it("refuses a non-staff caller (403) and calls nothing", async () => {
    upstream(200, "{}");
    const res = await request(buildApp())
      .get(`/v1/billing/revenue/by-org/${ORG}`)
      .set("X-API-Key", "admin-test-key")
      .set("x-email", "customer@example.com");
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
