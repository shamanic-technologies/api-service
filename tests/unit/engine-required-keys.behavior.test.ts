import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the routers import.
const { WF_BASE } = vi.hoisted(() => {
  const WF_BASE = "http://workflow.test.local";
  process.env.WORKFLOW_SERVICE_URL = WF_BASE;
  process.env.WORKFLOW_SERVICE_API_KEY = "workflow-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { WF_BASE };
});

/**
 * SOLO-PLAN-1125: GET /v1/engines/:outcome/required-keys is a byte pipe to workflow-service
 * /internal/engines/{outcome}/required-keys with the AUTHENTICATED org + user; query verbatim,
 * status and body verbatim. No auth mock: the real authenticate + requireOrg + requireUser.
 */
vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

import router from "../../src/routes/engines.js";
import { buildDocument } from "../../src/openapi/document.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const AUTH = { "X-API-Key": "admin-test-key", "x-org-id": ORG, "x-user-id": USER };
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

describe("GET /v1/engines/:outcome/required-keys", () => {
  it("pipes to workflow-service with the caller's org + user and the query verbatim; body byte-for-byte", async () => {
    const raw = `{"outcome":"meeting_booked","campaignId":"${CAMPAIGN}","keys":[{"provider":"anthropic","held":false,"required":true}],"ready":false}`;
    upstream(200, raw);
    const res = await request(buildApp()).get(`/v1/engines/meeting_booked/required-keys?campaignId=${CAMPAIGN}&orgId=evil-org`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${WF_BASE}/internal/engines/meeting_booked/required-keys?campaignId=${CAMPAIGN}&orgId=evil-org`);
    expect(calls[0].options.method ?? "GET").toBe("GET");
    expect(calls[0].options.headers["X-API-Key"]).toBe("workflow-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe(ORG);
    expect(calls[0].options.headers["x-user-id"]).toBe(USER);
  });

  it.each([
    [400, '{"error":"x is not an outcome key"}'],
    [502, '{"code":"required_keys_unreadable","error":"key-service answered 503"}'],
  ])("keeps workflow-service's %i and body field-for-field", async (status, raw) => {
    upstream(status, raw);
    const res = await request(buildApp()).get("/v1/engines/meeting_booked/required-keys").set(AUTH);
    expect(res.status).toBe(status);
    expect(res.body).toEqual(JSON.parse(raw));
  });

  it("refuses an unauthenticated caller before any downstream call", async () => {
    upstream(200, "{}");
    const res = await request(buildApp()).get("/v1/engines/meeting_booked/required-keys");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("is on the customer document with workflow-service's answer", () => {
    const doc: any = buildDocument();
    const op = doc.paths["/v1/engines/{outcome}/required-keys"]?.get;
    expect(op).toBeTruthy();
    expect(op.operationId).toBeTruthy();
    const ok = op.responses["200"].content["application/json"].schema;
    const resolved = ok.$ref ? doc.components.schemas[ok.$ref.split("/").pop()] : ok;
    expect(Object.keys(resolved.properties ?? {}).length + (resolved.allOf?.length ?? 0)).toBeGreaterThan(0);
  });
});
