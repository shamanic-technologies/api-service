import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/people* must forward to crm-service's own /orgs/people* — path
 * preserved, query string byte-copied (personKey carries `:` `@` `+`), body
 * forwarded verbatim, upstream status (202, 404) and body returned untransformed.
 *
 * `authenticate` is stubbed and driven per request; `requireOrg` / `requireUser`
 * are the REAL middleware, so "a call with no user is refused before crm-service"
 * is an assertion about the shipped chain (CLAUDE.md rule #7, corollary 3).
 */

vi.mock("../../src/middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/middleware/auth.js")>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.orgId = "org_test456";
      req.authType = "user_key";
      if (req.headers["x-test-no-user"] !== "1") req.userId = "user_test123";
      next();
    },
  };
});

import crmRouter from "../../src/routes/crm.js";

const CRM_BASE = "http://crm.test.local";
const BRAND = "4f1c0e60-8c2a-4f7e-8a1b-2c3d4e5f6071";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", crmRouter);
  return app;
}

type Reply = { status: number; body: unknown };

describe("/v1/orgs/people* → crm-service", () => {
  let calls: Array<{ url: string; options: any }>;
  let reply: Reply;

  beforeEach(() => {
    process.env.CRM_SERVICE_URL = CRM_BASE;
    process.env.CRM_SERVICE_API_KEY = "crm-test-key";
    calls = [];
    reply = { status: 200, body: { ok: true } };
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      const { status, body } = reply;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      };
    });
  });

  afterEach(() => {
    delete process.env.CRM_SERVICE_URL;
    delete process.env.CRM_SERVICE_API_KEY;
  });

  it("GET /orgs/people forwards the whole query string + identity headers", async () => {
    const res = await request(buildApp()).get(
      `/v1/orgs/people?brandId=${BRAND}&limit=50&offset=100&source=gohighlevel`,
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${CRM_BASE}/orgs/people?brandId=${BRAND}&limit=50&offset=100&source=gohighlevel`,
    );
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it("GET /orgs/people/timeline byte-copies an encoded personKey", async () => {
    const res = await request(buildApp()).get(
      `/v1/orgs/people/timeline?brandId=${BRAND}&personKey=email%3Aalice%40acme.com`,
    );
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(
      `${CRM_BASE}/orgs/people/timeline?brandId=${BRAND}&personKey=email%3Aalice%40acme.com`,
    );
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it("GET /orgs/people/timeline keeps an encoded `+` in a phone personKey", async () => {
    await request(buildApp()).get(
      `/v1/orgs/people/timeline?brandId=${BRAND}&personKey=phone%3A%2B33612345678`,
    );
    expect(calls[0].url).toBe(
      `${CRM_BASE}/orgs/people/timeline?brandId=${BRAND}&personKey=phone%3A%2B33612345678`,
    );
  });

  it("GET /orgs/people/timeline returns crm-service's 404 status and body verbatim", async () => {
    reply = { status: 404, body: { error: "person not found", reason: "person_not_found" } };
    const res = await request(buildApp()).get(
      `/v1/orgs/people/timeline?brandId=${BRAND}&personKey=email%3Anobody%40acme.com`,
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "person not found", reason: "person_not_found" });
  });

  it("POST /orgs/people/sync forwards the body verbatim and passes 202 through", async () => {
    reply = { status: 202, body: { status: "accepted", scopeId: "s1" } };
    const res = await request(buildApp()).post("/v1/orgs/people/sync").send({ brandId: BRAND });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "accepted", scopeId: "s1" });
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/people/sync`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual({ brandId: BRAND });
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it("POST /orgs/people/sync returns crm-service's 400 verbatim", async () => {
    reply = { status: 400, body: { type: "validation", error: "brandId (uuid) is required in the body" } };
    const res = await request(buildApp()).post("/v1/orgs/people/sync").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ type: "validation", error: "brandId (uuid) is required in the body" });
  });

  it("refuses every people route with no user identity, before reaching crm-service", async () => {
    const app = buildApp();
    const list = await request(app).get(`/v1/orgs/people?brandId=${BRAND}`).set("x-test-no-user", "1");
    const timeline = await request(app)
      .get(`/v1/orgs/people/timeline?brandId=${BRAND}&personKey=email%3Aa%40b.c`)
      .set("x-test-no-user", "1");
    const sync = await request(app).post("/v1/orgs/people/sync").set("x-test-no-user", "1").send({ brandId: BRAND });
    for (const res of [list, timeline, sync]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("User identity required");
    }
    expect(calls).toHaveLength(0);
  });

  it("does not proxy crm-service's /internal/people/sync cron tier", async () => {
    const res = await request(buildApp()).post("/v1/internal/people/sync").send({});
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
