import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { CRM_BASE } = vi.hoisted(() => {
  const CRM_BASE = "http://crm.test.local";
  process.env.CRM_SERVICE_URL = CRM_BASE;
  process.env.CRM_SERVICE_API_KEY = "crm-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { CRM_BASE };
});

/**
 * /v1/crm/ops/whatsapp-lines[/check] — staff byte passthrough to crm-service
 * (WA-LINE-HEALTH-1023). Real gate, no auth mock: refusal and over-the-wire
 * behaviour are both asserted against the shipped middleware.
 */
import crmOpsRouter from "../../src/routes/crm-ops.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", crmOpsRouter);
  return app;
}

const STAFF = { "x-api-key": "platform-test-key", "x-email": "kevin.lourd@gmail.com" };

describe("/v1/crm/ops/whatsapp-lines", () => {
  let calls: Array<{ url: string; options: any }>;

  function stub(status: number, body: string) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
  }

  beforeEach(() => {
    calls = [];
    stub(200, JSON.stringify({ lines: [{ phone: "+77776879632", days: [{ day: "2026-10-19", state: "logged_out" }] }] }));
  });

  it("GET forwards the query verbatim to crm-service and returns its body byte-equal", async () => {
    const body = JSON.stringify({ lines: [{ phone: "+77776879632", days: [{ day: "2026-10-19", state: "logged_out" }] }] });
    stub(200, body);
    const res = await request(buildApp()).get("/v1/crm/ops/whatsapp-lines?days=7&x=a&x=b").set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CRM_BASE}/internal/ops/whatsapp-lines?days=7&x=a&x=b`);
    expect(calls[0].options.method ?? "GET").toBe("GET");
    expect(calls[0].options.headers["X-API-Key"] ?? calls[0].options.headers["x-api-key"]).toBe("crm-test-key");
    expect(calls[0].options.headers["x-email"]).toBe("kevin.lourd@gmail.com");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("GET relays crm-service's 400 status and body", async () => {
    const body = JSON.stringify({ error: "days must be between 1 and 90" });
    stub(400, body);
    const res = await request(buildApp()).get("/v1/crm/ops/whatsapp-lines?days=999").set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "days must be between 1 and 90" });
  });

  it("POST /check reaches crm-service's check route and returns its body byte-equal", async () => {
    const body = JSON.stringify({ checked: 3, down: 1 });
    stub(200, body);
    const res = await request(buildApp()).post("/v1/crm/ops/whatsapp-lines/check").set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(body);
    expect(calls[0].url).toBe(`${CRM_BASE}/internal/ops/whatsapp-lines/check`);
    expect(calls[0].options.method).toBe("POST");
  });

  it("GET /trigger-reports forwards the query verbatim to crm-service and returns its body byte-equal", async () => {
    // Odd spacing + unknown field on purpose: byte-for-byte means NOT re-serialized.
    const body = '{"triggers":[{"trigger":"whatsapp_number_given", "status":"red","stuck":{"no_greeting":1}}],"someNewField":true}';
    stub(200, body);
    const res = await request(buildApp()).get("/v1/crm/ops/trigger-reports?days=7&x=a&x=b").set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CRM_BASE}/internal/ops/trigger-reports?days=7&x=a&x=b`);
    expect(calls[0].options.method ?? "GET").toBe("GET");
    expect(calls[0].options.headers["X-API-Key"] ?? calls[0].options.headers["x-api-key"]).toBe("crm-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  it("GET /trigger-reports relays crm-service's 400 status and body", async () => {
    const body = JSON.stringify({ type: "validation", error: "days must be an integer from 1 to 90" });
    stub(400, body);
    const res = await request(buildApp()).get("/v1/crm/ops/trigger-reports?days=999").set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(JSON.parse(body));
  });

  it("GET /connector-intake forwards the query verbatim to crm-service and returns its body byte-equal", async () => {
    const body = '{"status":"red","connections":[{"source":"gohighlevel", "status":"red","quietDays":8}],"someNewField":true}';
    stub(200, body);
    const res = await request(buildApp()).get("/v1/crm/ops/connector-intake?days=30").set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CRM_BASE}/internal/ops/connector-intake?days=30`);
    expect(calls[0].options.method ?? "GET").toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
  });

  for (const [method, path] of [["get", "/v1/crm/ops/whatsapp-lines"], ["post", "/v1/crm/ops/whatsapp-lines/check"], ["get", "/v1/crm/ops/trigger-reports"], ["get", "/v1/crm/ops/connector-intake"]] as const) {
    it(`${method.toUpperCase()} ${path} refuses no credentials (401)`, async () => {
      const res = await (request(buildApp()) as any)[method](path);
      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    it(`${method.toUpperCase()} ${path} refuses the platform key with a non-staff email (403)`, async () => {
      const res = await (request(buildApp()) as any)[method](path)
        .set("x-api-key", "platform-test-key")
        .set("x-email", "someone@customer.example");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Staff access required");
      expect(calls).toHaveLength(0);
    });

    it(`${method.toUpperCase()} ${path} refuses a Bearer user key (401)`, async () => {
      const res = await (request(buildApp()) as any)[method](path).set("authorization", "Bearer distrib.usr_abc");
      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });
  }
});
