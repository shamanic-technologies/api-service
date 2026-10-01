import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/{posthog,stripe}/connections* must forward to crm-service's own /orgs/{posthog,stripe}/connections*
 * — path preserved, query string byte-copied, body forwarded verbatim, response
 * and error body returned untransformed.
 *
 * Every assertion drives the real router through supertest and reads the captured
 * `fetch` call: a source-substring test cannot see what a template literal
 * interpolates to (CLAUDE.md rule #7, corollaries 2 and 3).
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

const BRAND = "bbbbbbbb-1111-4111-8111-000000000001";

describe.each([
  ["posthog", { brandId: BRAND, projectId: "12345", region: "eu" }],
  ["stripe", { brandId: BRAND }],
] as const)("/v1/orgs/%s/connections* → crm-service", (provider, createBody) => {
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

  it("POST create forwards the body byte-identical + identity headers", async () => {
    const res = await request(buildApp()).post(`/v1/orgs/${provider}/connections`).send(createBody);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/${provider}/connections`);
    expect(call.options.method).toBe("POST");
    expect(JSON.parse(call.options.body)).toEqual(createBody);
    expect(call.options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("a crm-service 400 vendor body reaches the caller field-for-field", async () => {
    const upstream = {
      type: "vendor",
      error: `${provider} refused the credential: invalid key`,
      vendorStatus: 401,
      vendorError: "invalid key",
    };
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: false, status: 400, text: () => Promise.resolve(JSON.stringify(upstream)) };
    });
    const res = await request(buildApp()).post(`/v1/orgs/${provider}/connections`).send(createBody);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(upstream);
  });

  it("GET forwards the whole query string verbatim", async () => {
    const res = await request(buildApp()).get(
      `/v1/orgs/${provider}/connections?brandId=${BRAND}&extra=a&extra=b`,
    );
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/${provider}/connections?brandId=${BRAND}&extra=a&extra=b`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("PATCH forwards the id in the path + the body", async () => {
    const res = await request(buildApp())
      .patch(`/v1/orgs/${provider}/connections/conn-uuid-1`)
      .send({ status: "paused" });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/${provider}/connections/conn-uuid-1`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ status: "paused" });
  });

  it("DELETE forwards the id in the path", async () => {
    const res = await request(buildApp()).delete(`/v1/orgs/${provider}/connections/conn-uuid-1`);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/${provider}/connections/conn-uuid-1`);
    expect(calls[0].options.method).toBe("DELETE");
  });

  it("propagates a 404 upstream body verbatim", async () => {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: false, status: 404, text: () => Promise.resolve("connection not found") };
    });
    const res = await request(buildApp()).delete(`/v1/orgs/${provider}/connections/nope`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("connection not found");
  });

  it("exposes no /internal sync path", async () => {
    const app = buildApp();
    for (const path of [`/v1/internal/${provider}/sync`, `/v1/orgs/${provider}/sync`]) {
      const res = await request(app).post(path).send({});
      expect(res.status, path).toBe(404);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
