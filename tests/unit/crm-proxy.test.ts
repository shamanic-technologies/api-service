import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/contacts/* must forward to CRM-SERVICE /orgs/contacts/*
 * (transparent proxy: path preserved, body forwarded verbatim, response
 * returned untransformed, identity org+user headers + x-api-key forwarded).
 * Per CLAUDE.md rules #6/#8 we assert (a) the proxy hit the correct downstream
 * path, (b) the request was forwarded correctly (multipart streamed through,
 * query params passed), (c) the right headers were sent — NOT the downstream
 * response shape. The crm-service base/key are read lazily from env at request
 * time, so setting/deleting them per-test is enough.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "user_key";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import crmRouter from "../../src/routes/crm.js";

const CRM_BASE = "http://crm.test.local";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", crmRouter);
  return app;
}

describe("/v1/orgs/contacts/* → crm-service", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    process.env.CRM_SERVICE_URL = CRM_BASE;
    process.env.CRM_SERVICE_API_KEY = "crm-test-key";
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
    });
  });

  afterEach(() => {
    delete process.env.CRM_SERVICE_URL;
    delete process.env.CRM_SERVICE_API_KEY;
  });

  it("POST /orgs/contacts/upload streams multipart through with identity + api-key headers", async () => {
    const res = await request(buildApp())
      .post("/v1/orgs/contacts/upload")
      .field("brandId", "brand-uuid-1")
      .attach("file", Buffer.from("email,name\na@b.com,Al\n"), "contacts.csv");

    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/contacts/upload`);
    expect(call.options.method).toBe("POST");
    // Multipart streamed through untouched: content-type carries the boundary,
    // body is the raw request stream (NOT a JSON string), duplex is half.
    expect(call.options.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(call.options.duplex).toBe("half");
    expect(typeof call.options.body).not.toBe("string");
    expect(call.options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("GET /orgs/contacts forwards brandId + identity + api-key headers", async () => {
    const res = await request(buildApp()).get("/v1/orgs/contacts?brandId=brand-uuid-1");
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/contacts?brandId=brand-uuid-1`);
    expect(call.options.method ?? "GET").toBe("GET");
    expect(call.options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("GET /orgs/contacts/uploads forwards brandId query", async () => {
    const res = await request(buildApp()).get("/v1/orgs/contacts/uploads?brandId=brand-uuid-1");
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/contacts/uploads?brandId=brand-uuid-1`);
  });

  it("GET /orgs/contacts/serve-stats forwards brandId + identity + api-key headers", async () => {
    const res = await request(buildApp()).get("/v1/orgs/contacts/serve-stats?brandId=brand-uuid-1");
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/contacts/serve-stats?brandId=brand-uuid-1`);
    expect(call.options.method ?? "GET").toBe("GET");
    expect(call.options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("propagates upstream error status + verbatim body (no mask)", async () => {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: false, status: 400, text: () => Promise.resolve("brandId is required") };
    });
    const res = await request(buildApp()).get("/v1/orgs/contacts");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("brandId is required");
  });

  it("returns 502 when CRM_SERVICE_URL is not configured", async () => {
    delete process.env.CRM_SERVICE_URL;
    const res = await request(buildApp()).get("/v1/orgs/contacts?brandId=brand-uuid-1");
    expect(res.status).toBe(502);
  });
});
