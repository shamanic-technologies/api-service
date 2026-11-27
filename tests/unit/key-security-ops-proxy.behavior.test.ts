import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { KEY_BASE } = vi.hoisted(() => {
  const KEY_BASE = "http://key.test.local";
  process.env.KEY_SERVICE_URL = KEY_BASE;
  process.env.KEY_SERVICE_API_KEY = "key-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { KEY_BASE };
});

/**
 * /v1/keys/ops/security-daily — staff byte passthrough to
 * key-service GET /internal/security/daily (SECURITY-ALERTS-1128-CHART). Real gate, no auth mock.
 */
import router from "../../src/routes/key-security-ops.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", router);
  return app;
}

const PATH = "/v1/keys/ops/security-daily";
const STAFF = { "x-api-key": "platform-test-key", "x-email": "kevin.lourd@gmail.com" };

describe(PATH, () => {
  let calls: Array<{ url: string; options: any }>;

  function stub(status: number, body: string) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
  }

  beforeEach(() => {
    calls = [];
    stub(200, "{}");
  });

  it("staff GET forwards the query verbatim and returns the producer's body byte-equal (200)", async () => {
    // Odd spacing + unknown field on purpose: byte-for-byte means NOT re-serialized.
    const body = '{"red":false,"days":[{"day":"2026-11-27", "secretReads":12}],"incidents":[],"someNewField":true}';
    stub(200, body);
    const res = await request(buildApp()).get(`${PATH}?days=7&x=a&x=b`).set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${KEY_BASE}/internal/security/daily?days=7&x=a&x=b`);
    expect(calls[0].options.method ?? "GET").toBe("GET");
    expect(calls[0].options.headers["X-API-Key"] ?? calls[0].options.headers["x-api-key"]).toBe("key-test-key");
    expect(calls[0].options.headers["x-email"]).toBe("kevin.lourd@gmail.com");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("relays the producer's 400 status and body", async () => {
    const body = JSON.stringify({ error: "days must be an integer between 1 and 90" });
    stub(400, body);
    const res = await request(buildApp()).get(`${PATH}?days=999`).set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(JSON.parse(body));
  });

  it("refuses no credentials (401)", async () => {
    const res = await request(buildApp()).get(PATH);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses the platform key with a non-staff email (403)", async () => {
    const res = await request(buildApp()).get(PATH)
      .set("x-api-key", "platform-test-key")
      .set("x-email", "someone@customer.example");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Staff access required");
    expect(calls).toHaveLength(0);
  });

  it("refuses a Bearer customer key (401)", async () => {
    const res = await request(buildApp()).get(PATH).set("authorization", "Bearer distrib.usr_abc");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
