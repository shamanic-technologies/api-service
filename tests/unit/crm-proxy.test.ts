import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/contacts/* and /v1/orgs/matrix/* must forward to crm-service's own
 * /orgs/contacts/* and /orgs/matrix/* (transparent proxy: path preserved, query
 * string byte-copied, body forwarded verbatim, response returned untransformed,
 * identity + x-api-key headers forwarded).
 *
 * Every assertion here drives the real router through supertest and reads the
 * captured `fetch` call — a source-substring test cannot see what a template
 * literal interpolates to (CLAUDE.md rule #7, corollaries 2 and 3). We assert the
 * downstream path, the forwarded identity, and the byte-identical body — NOT the
 * downstream response shape. crm-service base/key are read lazily from env at
 * request time, so setting/deleting them per-test is enough.
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

describe("/v1/orgs/contacts/* + /v1/orgs/matrix/* → crm-service", () => {
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

  it("POST /orgs/contacts/upload buffers multipart + forwards with identity + api-key headers", async () => {
    const res = await request(buildApp())
      .post("/v1/orgs/contacts/upload")
      .field("brandId", "brand-uuid-1")
      .attach("file", Buffer.from("email,name\na@b.com,Al\n"), "contacts.csv");

    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/contacts/upload`);
    expect(call.options.method).toBe("POST");
    // Multipart forwarded untouched: content-type carries the boundary, body is
    // the buffered raw bytes (a Buffer, NOT a JSON string). The inbound
    // content-length is NOT re-forwarded — undici derives it from the Buffer so
    // the declared length always matches the bytes sent (the fix for the
    // "Request body length does not match content-length" → fetch failed 500).
    expect(call.options.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(call.options.headers["content-length"]).toBeUndefined();
    expect(call.options.duplex).toBeUndefined();
    expect(Buffer.isBuffer(call.options.body)).toBe(true);
    expect(call.options.body.toString()).toContain("a@b.com,Al");
    expect(call.options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("GET /orgs/contacts forwards the query string + identity + api-key headers", async () => {
    const res = await request(buildApp()).get("/v1/orgs/contacts?brandId=brand-uuid-1");
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/contacts?brandId=brand-uuid-1`);
    expect(call.options.method ?? "GET").toBe("GET");
    expect(call.options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("GET /orgs/contacts forwards pagination params the gateway knows nothing about", async () => {
    // Byte-copied query string: a param crm-service adds later needs no change here.
    await request(buildApp()).get("/v1/orgs/contacts?brandId=b1&limit=5000&offset=100");
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/contacts?brandId=b1&limit=5000&offset=100`);
  });

  it("GET /orgs/contacts/uploads forwards brandId query", async () => {
    const res = await request(buildApp()).get("/v1/orgs/contacts/uploads?brandId=brand-uuid-1");
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/contacts/uploads?brandId=brand-uuid-1`);
  });

  it("GET /orgs/contacts/serve-stats forwards repeated uploadIds verbatim", async () => {
    // Repeated keys are exactly what re-serializing from req.query would mangle.
    const res = await request(buildApp()).get(
      "/v1/orgs/contacts/serve-stats?brandId=b1&uploadIds=u1&uploadIds=u2",
    );
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/contacts/serve-stats?brandId=b1&uploadIds=u1&uploadIds=u2`);
    expect(call.options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
  });

  it("POST /orgs/contacts/serve-next forwards the body byte-identical", async () => {
    const body = { brandId: "b1", limit: 250, uploadIds: ["u1", "u2"] };
    const res = await request(buildApp()).post("/v1/orgs/contacts/serve-next").send(body);
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/contacts/serve-next`);
    expect(call.options.method).toBe("POST");
    expect(JSON.parse(call.options.body)).toEqual(body);
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
  });

  it("POST /orgs/matrix/connections forwards the body byte-identical + x-user-id", async () => {
    const body = {
      brandId: "b1",
      channel: "whatsapp",
      matrixUserId: "@me:box",
      counterpartPrefix: "@whatsapp_",
    };
    const res = await request(buildApp()).post("/v1/orgs/matrix/connections").send(body);
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/matrix/connections`);
    expect(call.options.method).toBe("POST");
    expect(JSON.parse(call.options.body)).toEqual(body);
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("PATCH /orgs/matrix/connections/:id forwards the id in the path + the body", async () => {
    const res = await request(buildApp())
      .patch("/v1/orgs/matrix/connections/conn-uuid-1")
      .send({ status: "paused" });
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CRM_BASE}/orgs/matrix/connections/conn-uuid-1`);
    expect(call.options.method).toBe("PATCH");
    expect(JSON.parse(call.options.body)).toEqual({ status: "paused" });
  });

  it("GET /orgs/matrix/connections forwards brandId query", async () => {
    const res = await request(buildApp()).get("/v1/orgs/matrix/connections?brandId=b1");
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/matrix/connections?brandId=b1`);
  });

  it("GET /orgs/matrix/leads forwards status + pagination filters verbatim", async () => {
    const res = await request(buildApp()).get(
      "/v1/orgs/matrix/leads?brandId=b1&status=qualified&limit=1000&offset=20",
    );
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(
      `${CRM_BASE}/orgs/matrix/leads?brandId=b1&status=qualified&limit=1000&offset=20`,
    );
  });

  it("returns the upstream response body untransformed", async () => {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ leads: [{ id: "l1", status: "qualified" }] }),
      };
    });
    const res = await request(buildApp()).get("/v1/orgs/matrix/leads?brandId=b1");
    expect(res.body).toEqual({ leads: [{ id: "l1", status: "qualified" }] });
  });

  it("propagates an upstream error status + its JSON body field-for-field", async () => {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve('{"type":"validation","error":"brandId (uuid) query is required"}'),
      };
    });
    const res = await request(buildApp()).get("/v1/orgs/contacts");
    expect(res.status).toBe(400);
    // respondUpstreamError re-emits the object, so `type` survives for a consumer
    // to branch on instead of being flattened into an `error` string.
    expect(res.body).toEqual({ type: "validation", error: "brandId (uuid) query is required" });
  });

  it("propagates a non-JSON upstream error body verbatim", async () => {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: false, status: 404, text: () => Promise.resolve("connection not found") };
    });
    const res = await request(buildApp()).patch("/v1/orgs/matrix/connections/nope").send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("connection not found");
  });

  it("returns 502 when CRM_SERVICE_URL is not configured", async () => {
    delete process.env.CRM_SERVICE_URL;
    const res = await request(buildApp()).get("/v1/orgs/contacts?brandId=brand-uuid-1");
    expect(res.status).toBe(502);
  });

  it("exposes no /internal/* crm path", async () => {
    // crm-service's /internal tier (contacts/promote, matrix/sync, matrix/rebuild)
    // is cron-driven service-to-service and must never be reachable through here.
    const app = buildApp();
    for (const path of [
      "/v1/internal/contacts/promote",
      "/v1/internal/matrix/sync",
      "/v1/internal/matrix/rebuild",
      "/v1/orgs/contacts/promote",
    ]) {
      const res = await request(app).post(path).send({});
      expect(res.status).toBe(404);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
