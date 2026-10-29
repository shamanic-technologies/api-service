import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { WORKFLOW_BASE } = vi.hoisted(() => {
  const WORKFLOW_BASE = "http://workflow.test.local";
  process.env.WORKFLOW_SERVICE_URL = WORKFLOW_BASE;
  process.env.WORKFLOW_SERVICE_API_KEY = "workflow-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { WORKFLOW_BASE };
});

/**
 * /v1/scripts/ops/monitoring — staff byte passthrough to workflow-service GET /internal/scripts/monitoring
 * (FACTORY-P3). Real gate, no auth mock. Mounted like src/index.ts: before the customer scripts router.
 */
import scriptsOpsRouter from "../../src/routes/scripts-ops.js";
import scriptsRouter from "../../src/routes/scripts.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", scriptsOpsRouter);
  app.use("/v1", scriptsRouter);
  return app;
}

const PATH = "/v1/scripts/ops/monitoring";
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

  it("forwards the query verbatim to workflow-service and returns its body byte-equal", async () => {
    // Odd spacing + unknown field on purpose: byte-for-byte means NOT re-serialized.
    const body = '{"status":"red", "outcomes":[{"outcome":"x","byDay":[{"day":"2026-10-28","script":3,"service":4}]}],"rollbackGuard":{"status":"ok"},"someNewField":true}';
    stub(200, body);
    const res = await request(buildApp()).get(`${PATH}?days=7&x=a&x=b`).set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/internal/scripts/monitoring?days=7&x=a&x=b`);
    expect(calls[0].options.method ?? "GET").toBe("GET");
    expect(calls[0].options.headers["X-API-Key"] ?? calls[0].options.headers["x-api-key"]).toBe("workflow-test-key");
    expect(calls[0].options.headers["x-email"]).toBe("kevin.lourd@gmail.com");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("forwards no query string when none is sent", async () => {
    const res = await request(buildApp()).get(PATH).set(STAFF);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/internal/scripts/monitoring`);
  });

  it("relays workflow-service's 400 status and body", async () => {
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
