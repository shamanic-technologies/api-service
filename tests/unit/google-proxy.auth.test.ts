import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// No auth mock: exercises the real `authenticate` / `requireOrg` gate. 401 (route
// present) vs 404 (route absent) is also what proves the #808 removal is undone.
vi.hoisted(() => {
  process.env.GOOGLE_SERVICE_URL = "http://google.test.local";
  process.env.GOOGLE_SERVICE_API_KEY = "google-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import googleRouter from "../../src/routes/google.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", googleRouter);
  return app;
}

const ROUTES: Array<["get" | "post" | "put" | "delete", string]> = [
  ["post", "/v1/orgs/google/auth/start"],
  ["get", "/v1/orgs/google/auth/callback?code=c&state=s"],
  ["get", "/v1/orgs/google/accounts"],
  ["delete", "/v1/orgs/google/accounts/a%40b.com"],
  ["post", "/v1/orgs/google/sync"],
  ["get", "/v1/orgs/google/sync/j1"],
  ["get", "/v1/orgs/google/messages"],
  ["get", "/v1/orgs/google/contacts"],
  ["get", "/v1/orgs/google/conversation?email=a%40b.com"],
  ["get", "/v1/orgs/google/correspondents"],
  ["put", "/v1/orgs/google/contact-links"],
];

describe("google proxy — auth gate", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("unexpected outbound call from an unauthenticated request");
    });
  });

  it("answers 401 (route present), not 404, on every route", async () => {
    const app = buildApp();
    for (const [method, path] of ROUTES) {
      const res = await request(app)[method](path).send({});
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an admin-keyed call with no resolvable org identity", async () => {
    const res = await request(buildApp())
      .get("/v1/orgs/google/accounts")
      .set("X-API-Key", "admin-test-key")
      .set("x-org-id", "someone-elses-org");
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not expose google-service /internal/* routes", async () => {
    const res = await request(buildApp()).get("/v1/internal/staff-mailboxes/conversation?email=a%40b.com");
    expect(res.status).toBe(404);
  });
});
