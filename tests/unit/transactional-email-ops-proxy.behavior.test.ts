import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { TE_BASE } = vi.hoisted(() => {
  const TE_BASE = "http://transactional-email.test.local";
  process.env.TRANSACTIONAL_EMAIL_SERVICE_URL = TE_BASE;
  process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY = "te-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { TE_BASE };
});

/**
 * /v1/transactional-email/ops/monitoring-alerts — staff byte passthrough to
 * transactional-email-service GET /internal/monitoring-alerts
 * (SIGNUP-EMAILS-1111-MONITORING). Real gate, no auth mock.
 */
import router from "../../src/routes/transactional-email-ops.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", router);
  return app;
}

const PATH = "/v1/transactional-email/ops/monitoring-alerts";
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
    const body = '{"status":"red","alerts":[{"kind":"provider_out_of_credits", "raisedAt":"2026-11-11T08:00:00Z"}],"someNewField":true}';
    stub(200, body);
    const res = await request(buildApp()).get(`${PATH}?days=7&x=a&x=b`).set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${TE_BASE}/internal/monitoring-alerts?days=7&x=a&x=b`);
    expect(calls[0].options.method ?? "GET").toBe("GET");
    expect(calls[0].options.headers["X-API-Key"] ?? calls[0].options.headers["x-api-key"]).toBe("te-test-key");
    expect(calls[0].options.headers["x-email"]).toBe("kevin.lourd@gmail.com");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("relays the producer's 400 status and body", async () => {
    const body = JSON.stringify({ error: "days must be an integer from 1 to 90" });
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
