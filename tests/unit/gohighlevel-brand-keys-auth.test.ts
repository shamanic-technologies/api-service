import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Own file, deliberately WITHOUT the auth mock the behaviour tests use: this drives
 * the real `authenticate` / `requireOrg` middleware, so "an unauthenticated call is
 * refused" is a real assertion about the shipped gate rather than a property of a
 * stub. It also distinguishes "the route is present" (401) from "the route is
 * absent" (404) — which is what makes the decrypt/internal 404s below meaningful.
 */
vi.hoisted(() => {
  process.env.CRM_SERVICE_URL = "http://crm.test.local";
  process.env.CRM_SERVICE_API_KEY = "crm-test-key";
  process.env.KEY_SERVICE_URL = "http://key.test.local";
  process.env.KEY_SERVICE_API_KEY = "key-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import crmRouter from "../../src/routes/crm.js";
import keysRouter from "../../src/routes/keys.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", crmRouter);
  app.use("/v1", keysRouter);
  return app;
}

describe("gohighlevel + brand-key proxies — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past auth, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("answers 401 (route present) on every gohighlevel read path", async () => {
    const app = buildApp();
    for (const path of [
      "/v1/orgs/gohighlevel/connections?brandId=b1",
      "/v1/orgs/gohighlevel/contacts?brandId=b1",
      "/v1/orgs/gohighlevel/opportunities?brandId=b1",
    ]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error).toBe("Missing authentication");
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("answers 401 on every gohighlevel write path", async () => {
    const app = buildApp();
    const created = await request(app).post("/v1/orgs/gohighlevel/connections").send({});
    expect(created.status).toBe(401);
    const patched = await request(app).patch("/v1/orgs/gohighlevel/connections/c1").send({});
    expect(patched.status).toBe(401);
    const deleted = await request(app).delete("/v1/orgs/gohighlevel/connections/c1");
    expect(deleted.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("answers 401 on every brand-key path", async () => {
    const app = buildApp();
    const listed = await request(app).get("/v1/keys/brands/b1");
    expect(listed.status).toBe(401);
    const stored = await request(app).post("/v1/keys/brands/b1").send({});
    expect(stored.status).toBe(401);
    const removed = await request(app).delete("/v1/keys/brands/b1/gohighlevel");
    expect(removed.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("answers 404 (route ABSENT, not merely gated) on the decrypt route", async () => {
    // A 401 here would mean the route exists and only needs credentials. It must not
    // exist at all: it resolves the customer's credential in clear.
    const res = await request(buildApp()).get("/v1/keys/brands/b1/gohighlevel/decrypt");
    expect(res.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("answers 404 on crm-service's internal gohighlevel triggers", async () => {
    const app = buildApp();
    for (const path of ["/v1/internal/gohighlevel/sync", "/v1/internal/gohighlevel/rebuild"]) {
      const res = await request(app).post(path).send({});
      expect(res.status, path).toBe(404);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an admin-keyed gohighlevel call with no resolvable org identity", async () => {
    // The platform key is shared with the dashboard's server-side proxy, so it is
    // not an identity: the caller cannot name whose pipeline to read.
    const res = await request(buildApp())
      .get("/v1/orgs/gohighlevel/contacts?brandId=b1")
      .set("X-API-Key", "admin-test-key")
      .set("x-org-id", "someone-elses-org");
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
