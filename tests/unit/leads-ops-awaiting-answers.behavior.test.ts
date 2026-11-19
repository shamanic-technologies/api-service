import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { LEAD_BASE } = vi.hoisted(() => {
  const LEAD_BASE = "http://lead.test.local";
  process.env.LEAD_SERVICE_URL = LEAD_BASE;
  process.env.LEAD_SERVICE_API_KEY = "lead-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { LEAD_BASE };
});

/** /v1/leads/ops/awaiting-answers — staff byte passthrough to lead-service (REPLY-NO-BALANCE-1118). Real gate. */
import campaignOpsRouter from "../../src/routes/campaign-ops.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignOpsRouter);
  return app;
}

const STAFF = { "x-api-key": "platform-test-key", "x-email": "kevin.lourd@gmail.com" };

describe("/v1/leads/ops/awaiting-answers", () => {
  let calls: Array<{ url: string; options: any }>;
  beforeEach(() => {
    calls = [];
  });
  function stub(status: number, body: string) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
  }

  it("forwards the query verbatim to lead-service and returns its body byte-equal", async () => {
    const body = '{"status":"red",  "waiting":[{"email":"drcampbell@arcticchiropractic.com"}],"byDay":[],"someNewField":true}';
    stub(200, body);
    const res = await request(buildApp()).get("/v1/leads/ops/awaiting-answers?days=7").set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(body);
    expect(calls[0].url).toBe(`${LEAD_BASE}/internal/ops/awaiting-answers?days=7`);
  });

  it("refuses a non-staff caller without calling lead-service", async () => {
    stub(200, "{}");
    const res = await request(buildApp()).get("/v1/leads/ops/awaiting-answers").set({ "x-api-key": "platform-test-key", "x-email": "someone@example.com" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
