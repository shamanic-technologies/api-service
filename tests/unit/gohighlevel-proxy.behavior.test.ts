import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/gohighlevel/* must forward to crm-service's own /orgs/gohighlevel/*
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

describe("/v1/orgs/gohighlevel/* → crm-service", () => {
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

  it("POST /orgs/gohighlevel/connections forwards the body byte-identical + x-user-id", async () => {
    const body = { brandId: "4f1c0e60-8c2a-4f7e-8a1b-2c3d4e5f6071", locationId: "loc_abc" };
    const res = await request(buildApp()).post("/v1/orgs/gohighlevel/connections").send(body);

    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/gohighlevel/connections`);
    expect(call.options.method).toBe("POST");
    expect(JSON.parse(call.options.body)).toEqual(body);
    expect(call.options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("PATCH /orgs/gohighlevel/connections/:id forwards the id in the path + the body", async () => {
    const res = await request(buildApp())
      .patch("/v1/orgs/gohighlevel/connections/conn-uuid-1")
      .send({ status: "paused" });

    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/gohighlevel/connections/conn-uuid-1`);
    expect(call.options.method).toBe("PATCH");
    expect(JSON.parse(call.options.body)).toEqual({ status: "paused" });
  });

  it("PATCH forwards a resume exactly as it forwards a pause — no status vocabulary here", async () => {
    await request(buildApp())
      .patch("/v1/orgs/gohighlevel/connections/conn-uuid-1")
      .send({ status: "active" });
    expect(JSON.parse(calls[0].options.body)).toEqual({ status: "active" });
  });

  it("DELETE /orgs/gohighlevel/connections/:id forwards the id in the path", async () => {
    const res = await request(buildApp()).delete("/v1/orgs/gohighlevel/connections/conn-uuid-1");

    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/gohighlevel/connections/conn-uuid-1`);
    expect(call.options.method).toBe("DELETE");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
  });

  it("GET /orgs/gohighlevel/connections forwards brandId", async () => {
    const res = await request(buildApp()).get("/v1/orgs/gohighlevel/connections?brandId=b1");
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/gohighlevel/connections?brandId=b1`);
  });

  it("GET /orgs/gohighlevel/contacts forwards brandId, limit and offset unchanged", async () => {
    const res = await request(buildApp()).get(
      "/v1/orgs/gohighlevel/contacts?brandId=b1&limit=1000&offset=200",
    );
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(
      `${CRM_BASE}/orgs/gohighlevel/contacts?brandId=b1&limit=1000&offset=200`,
    );
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("GET /orgs/gohighlevel/contacts forwards a param the gateway knows nothing about", async () => {
    // Byte-copied query string: a filter crm-service adds later needs no change here.
    await request(buildApp()).get(
      "/v1/orgs/gohighlevel/contacts?brandId=b1&unsubscribed=false&tags=a&tags=b",
    );
    expect(calls[0].url).toBe(
      `${CRM_BASE}/orgs/gohighlevel/contacts?brandId=b1&unsubscribed=false&tags=a&tags=b`,
    );
  });

  it("GET /orgs/gohighlevel/opportunities forwards brandId", async () => {
    const res = await request(buildApp()).get("/v1/orgs/gohighlevel/opportunities?brandId=b1");
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/gohighlevel/opportunities?brandId=b1`);
  });

  it("returns the upstream pipeline body untransformed", async () => {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            pipelines: [{ id: "p1", name: "Sales", stages: [{ id: "s1", opportunities: [] }] }],
            ungrouped: [],
          }),
      };
    });
    const res = await request(buildApp()).get("/v1/orgs/gohighlevel/opportunities?brandId=b1");
    expect(res.body).toEqual({
      pipelines: [{ id: "p1", name: "Sales", stages: [{ id: "s1", opportunities: [] }] }],
      ungrouped: [],
    });
  });

  it("a credential GoHighLevel refuses reaches the caller with the VENDOR's own reason", async () => {
    // This body is the only thing telling the customer which field to fix, so every
    // field survives — rebuilding it into `{ error: "<stringified body>" }` would
    // destroy `vendorStatus` / `vendorError` and render the raw JSON to the user.
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            '{"type":"vendor","error":"GoHighLevel refused the credential: The token is not authorized for this location","vendorStatus":401,"vendorError":"The token is not authorized for this location"}',
          ),
      };
    });
    const res = await request(buildApp())
      .post("/v1/orgs/gohighlevel/connections")
      .send({ brandId: "b1", locationId: "loc_wrong" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      type: "vendor",
      error: "GoHighLevel refused the credential: The token is not authorized for this location",
      vendorStatus: 401,
      vendorError: "The token is not authorized for this location",
    });
  });

  it("propagates a missing-credential refusal with its own status and fields", async () => {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            '{"type":"validation","error":"no gohighlevel credential stored for this brand"}',
          ),
      };
    });
    const res = await request(buildApp())
      .post("/v1/orgs/gohighlevel/connections")
      .send({ brandId: "b1", locationId: "loc_abc" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      type: "validation",
      error: "no gohighlevel credential stored for this brand",
    });
  });

  it("propagates a non-JSON upstream error body verbatim", async () => {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: false, status: 404, text: () => Promise.resolve("connection not found") };
    });
    const res = await request(buildApp()).delete("/v1/orgs/gohighlevel/connections/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("connection not found");
  });

  it("returns 502 when CRM_SERVICE_URL is not configured", async () => {
    delete process.env.CRM_SERVICE_URL;
    const res = await request(buildApp()).get("/v1/orgs/gohighlevel/connections?brandId=b1");
    expect(res.status).toBe(502);
  });

  it("exposes no gohighlevel /internal/* path", async () => {
    // crm-service's sync + rebuild triggers belong to the cron on the box.
    const app = buildApp();
    for (const path of [
      "/v1/internal/gohighlevel/sync",
      "/v1/internal/gohighlevel/rebuild",
      "/v1/orgs/gohighlevel/sync",
      "/v1/orgs/gohighlevel/rebuild",
    ]) {
      const res = await request(app).post(path).send({});
      expect(res.status, path).toBe(404);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("leaves every pre-existing crm sibling on its own downstream path", async () => {
    // Same-file siblings under /v1/orgs/*: a new route must not swallow them.
    const app = buildApp();
    await request(app).get("/v1/orgs/contacts?brandId=b1");
    await request(app).get("/v1/orgs/matrix/leads?brandId=b1");
    expect(calls.map((c) => c.url)).toEqual([
      `${CRM_BASE}/orgs/contacts?brandId=b1`,
      `${CRM_BASE}/orgs/matrix/leads?brandId=b1`,
    ]);
  });
});
