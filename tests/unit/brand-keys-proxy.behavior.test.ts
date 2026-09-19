import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/keys/brands/* must forward to key-service's own /keys/brands/* — path
 * preserved, body forwarded verbatim, response and error body untransformed, and
 * the org identity that reaches key-service the AUTHENTICATED one.
 *
 * The file also pins the security boundary this surface exists inside: key-service
 * serves `GET /keys/brands/{brandId}/{provider}/decrypt`, which resolves the
 * customer's credential in CLEAR. It is service-to-service only and must never be
 * reachable from a browser, so the gateway does not proxy it.
 */

// `externalServices.key` captures its URL/api-key at MODULE LOAD (not lazily like
// crm), so the env must be set before the import below evaluates.
vi.hoisted(() => {
  process.env.KEY_SERVICE_URL = "http://key.test.local";
  process.env.KEY_SERVICE_API_KEY = "key-test-key";
});

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

import keysRouter from "../../src/routes/keys.js";

const KEY_BASE = "http://key.test.local";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", keysRouter);
  return app;
}

describe("/v1/keys/brands/* → key-service", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
    });
  });

  it("GET /keys/brands/:brandId forwards the brand in the path + the authenticated org", async () => {
    const res = await request(buildApp()).get("/v1/keys/brands/brand-uuid-1");

    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${KEY_BASE}/keys/brands/brand-uuid-1`);
    expect(call.options.method ?? "GET").toBe("GET");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("returns the masked list untransformed", async () => {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            keys: [{ provider: "gohighlevel", maskedKey: "pit-...9f2", updatedAt: null }],
          }),
      };
    });
    const res = await request(buildApp()).get("/v1/keys/brands/brand-uuid-1");
    expect(res.body).toEqual({
      keys: [{ provider: "gohighlevel", maskedKey: "pit-...9f2", updatedAt: null }],
    });
  });

  it("POST /keys/brands/:brandId forwards the body byte-identical", async () => {
    const body = { provider: "gohighlevel", apiKey: "pit-secret-token" };
    const res = await request(buildApp()).post("/v1/keys/brands/brand-uuid-1").send(body);

    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${KEY_BASE}/keys/brands/brand-uuid-1`);
    expect(call.options.method).toBe("POST");
    expect(JSON.parse(call.options.body)).toEqual(body);
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
  });

  it("POST forwards a field the gateway does not declare", async () => {
    // The request body is a passthrough: key-service owns its shape.
    await request(buildApp())
      .post("/v1/keys/brands/brand-uuid-1")
      .send({ provider: "gohighlevel", apiKey: "t", label: "prod sub-account" });
    expect(JSON.parse(calls[0].options.body)).toEqual({
      provider: "gohighlevel",
      apiKey: "t",
      label: "prod sub-account",
    });
  });

  it("DELETE /keys/brands/:brandId/:provider forwards both path segments", async () => {
    const res = await request(buildApp()).delete("/v1/keys/brands/brand-uuid-1/gohighlevel");

    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${KEY_BASE}/keys/brands/brand-uuid-1/gohighlevel`);
    expect(call.options.method).toBe("DELETE");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
  });

  it("propagates an upstream error status + its JSON body field-for-field", async () => {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () => Promise.resolve('{"error":"provider and apiKey are required","code":"INVALID"}'),
      };
    });
    const res = await request(buildApp()).post("/v1/keys/brands/brand-uuid-1").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "provider and apiKey are required", code: "INVALID" });
  });

  it("does NOT proxy the decrypt route", async () => {
    // key-service GET /keys/brands/{brandId}/{provider}/decrypt resolves the
    // customer's credential in CLEAR. Service-to-service only — crm-service calls
    // it — and unreachable from a browser by construction. Adding it here would be
    // a credential disclosure, not a convenience.
    const app = buildApp();
    for (const path of [
      "/v1/keys/brands/brand-uuid-1/gohighlevel/decrypt",
      "/v1/keys/brands/brand-uuid-1/decrypt",
    ]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("leaves the org-wide key routes on their own downstream paths", async () => {
    // `/keys/brands/...` must not swallow `/keys/:provider` or `/keys/:provider/source`.
    const app = buildApp();
    await request(app).get("/v1/keys");
    await request(app).delete("/v1/keys/openai");
    await request(app).get("/v1/keys/sources");
    await request(app).get("/v1/keys/openai/source");
    expect(calls.map((c) => c.url)).toEqual([
      `${KEY_BASE}/keys`,
      `${KEY_BASE}/keys/openai`,
      `${KEY_BASE}/keys/sources`,
      `${KEY_BASE}/keys/openai/source`,
    ]);
  });
});
