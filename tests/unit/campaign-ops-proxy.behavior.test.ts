import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { CAMPAIGN_BASE } = vi.hoisted(() => {
  const CAMPAIGN_BASE = "http://campaign.test.local";
  process.env.CAMPAIGN_SERVICE_URL = CAMPAIGN_BASE;
  process.env.CAMPAIGN_SERVICE_API_KEY = "campaign-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { CAMPAIGN_BASE };
});

/**
 * /v1/campaigns/ops/{stuck-occurrences,trigger-health} — staff byte passthrough to campaign-service
 * (REACTIVE-THROUGHPUT-1028, TRIGGER-SILENCE-NO-EMAIL-1028). Real gate, no auth mock.
 */
import campaignOpsRouter from "../../src/routes/campaign-ops.js";
import campaignsRouter from "../../src/routes/campaigns.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignOpsRouter);
  app.use("/v1", campaignsRouter);
  return app;
}

const STAFF = { "x-api-key": "platform-test-key", "x-email": "kevin.lourd@gmail.com" };
for (const [suffix, sample] of [
  ["stuck-occurrences", '{"status":"red", "stuck":2,"queued":5,"stuckByReason":[{"reason":"x","count":2}],"byDay":[],"someNewField":true}'],
  ["trigger-health", '{"status":"red", "triggers":[{"triggerId":"t","verdict":"red","reason":"never_fired","sentence":"s","byDay":[]}],"someNewField":true}'],
] as const) {
const PATH = `/v1/campaigns/ops/${suffix}`;

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

  it("forwards the query verbatim to campaign-service and returns its body byte-equal", async () => {
    // Odd spacing + unknown field on purpose: byte-for-byte means NOT re-serialized.
    const body = sample;
    stub(200, body);
    const res = await request(buildApp()).get(`${PATH}?days=7&x=a&x=b`).set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CAMPAIGN_BASE}/internal/ops/${suffix}?days=7&x=a&x=b`);
    expect(calls[0].options.method ?? "GET").toBe("GET");
    expect(calls[0].options.headers["X-API-Key"] ?? calls[0].options.headers["x-api-key"]).toBe("campaign-test-key");
    expect(calls[0].options.headers["x-email"]).toBe("kevin.lourd@gmail.com");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("relays campaign-service's 400 status and body", async () => {
    const body = JSON.stringify({ error: "days must be an integer from 1 to 90", code: "invalid_days" });
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
    const res = await request(buildApp()).get(PATH).set("x-api-key", "platform-test-key").set("x-email", "someone@customer.example");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Staff access required");
    expect(calls).toHaveLength(0);
  });

  it("refuses a Bearer user key (401)", async () => {
    const res = await request(buildApp()).get(PATH).set("authorization", "Bearer distrib.usr_abc");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
}
