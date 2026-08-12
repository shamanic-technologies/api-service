import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Own file, deliberately WITHOUT the auth mock the behaviour test uses: this exercises
// the real `authenticate` / `requireOrg` middleware, so "an unauthenticated call is
// refused" is a real assertion about the shipped gate and not a property of a stub.
// It is also what distinguishes "the route is present" (401) from "the route is gone"
// (404) — the verification that the #808 removal has actually been undone.
vi.hoisted(() => {
  process.env.CRM_SERVICE_URL = "http://crm.test.local";
  process.env.CRM_SERVICE_API_KEY = "crm-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import crmRouter from "../../src/routes/crm.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", crmRouter);
  return app;
}

const READ_PATHS = [
  "/v1/orgs/contacts?brandId=b1",
  "/v1/orgs/contacts/uploads?brandId=b1",
  "/v1/orgs/contacts/serve-stats?brandId=b1",
  "/v1/orgs/matrix/connections?brandId=b1",
  "/v1/orgs/matrix/leads?brandId=b1",
];

const WRITE_PATHS = [
  "/v1/orgs/contacts/serve-next",
  "/v1/orgs/contacts/upload",
  "/v1/orgs/matrix/connections",
];

describe("crm proxy — auth gate", () => {
  beforeEach(() => {
    // Any outbound call from here means the request got past auth, which is the
    // failure this file exists to catch.
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("answers 401 (route present) — not 404 (route absent) — on every read path", async () => {
    const app = buildApp();
    for (const path of READ_PATHS) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error).toBe("Missing authentication");
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("answers 401 (route present) on every write path", async () => {
    const app = buildApp();
    for (const path of WRITE_PATHS) {
      const res = await request(app).post(path).send({});
      expect(res.status, path).toBe(401);
    }
    const patched = await request(app).patch("/v1/orgs/matrix/connections/c1").send({});
    expect(patched.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses a call carrying a wrong platform key", async () => {
    const res = await request(buildApp())
      .get("/v1/orgs/contacts?brandId=b1")
      .set("X-API-Key", "not-the-admin-key");
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an admin-keyed call with no resolvable org identity", async () => {
    // The platform key is shared with the dashboard's server-side proxy, so it is not
    // an identity on its own: the caller cannot name whose contacts to read.
    const res = await request(buildApp())
      .get("/v1/orgs/contacts?brandId=b1")
      .set("X-API-Key", "admin-test-key")
      .set("x-org-id", "someone-elses-org");
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
