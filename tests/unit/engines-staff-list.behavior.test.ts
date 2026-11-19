import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { WORKFLOW_BASE } = vi.hoisted(() => {
  const WORKFLOW_BASE = "http://workflow.test.local";
  process.env.WORKFLOW_SERVICE_URL = WORKFLOW_BASE;
  process.env.WORKFLOW_SERVICE_API_KEY = "workflow-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { WORKFLOW_BASE };
});

/**
 * GET /v1/engines → workflow-service GET /internal/engines (DISTRY-PRINCIPAL-1119), staff only.
 * No auth mock: the real authenticatePlatform + requireStaff run; refusals assert zero outbound calls.
 * The Engine CALL route is never exposed here.
 */
import router from "../../src/routes/engines.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

const STAFF = { "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" };
const RAW = '{"engines":[{"outcome":"meeting_booked","callable":false,"reason":"No live script"}],"callable":0,"total":1}';
let calls: Array<{ url: string; options: any }>;

function upstream(status: number, raw: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(raw, { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  calls = [];
});

describe("staff — GET /v1/engines", () => {
  it("reaches workflow-service /internal/engines and returns the body byte-for-byte", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get("/v1/engines").set(STAFF);
    expect(res.status).toBe(200);
    expect(res.text).toBe(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/internal/engines`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["X-API-Key"]).toBe("workflow-test-key");
  });

  it("passes the producer's 502 engine_list_unreadable through with its body", async () => {
    upstream(502, '{"code":"engine_list_unreadable","error":"x"}');
    const res = await request(buildApp()).get("/v1/engines").set(STAFF);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ code: "engine_list_unreadable", error: "x" });
  });

  it("refuses the platform key without a staff email (403) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get("/v1/engines").set({ "X-API-Key": "admin-test-key", "x-email": "customer@example.com" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a customer bearer key (401) and calls nothing", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get("/v1/engines").set("Authorization", "Bearer distrib.usr_customer");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("does not expose an Engine call (POST) route", async () => {
    upstream(200, "{}");
    const res = await request(buildApp()).post("/v1/engines/meeting_booked/calls").set(STAFF).send({});
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
