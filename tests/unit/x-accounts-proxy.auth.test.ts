import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// No auth mock: exercises the real `authenticate` / `requireOrg` gate.
vi.hoisted(() => {
  process.env.SOCIAL_SERVICE_URL = "http://social.test.local";
  process.env.SOCIAL_SERVICE_API_KEY = "social-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import xAccountsRouter from "../../src/routes/x-accounts.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", xAccountsRouter);
  return app;
}

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const ROUTES: Array<["get" | "post" | "patch" | "delete", string]> = [
  ["post", "/v1/orgs/x/auth/start"],
  ["post", "/v1/orgs/x/auth/callback"],
  ["get", "/v1/orgs/x/accounts"],
  ["patch", `/v1/orgs/x/accounts/${ID}`],
  ["delete", `/v1/orgs/x/accounts/${ID}`],
];

describe("x accounts proxy — auth gate", () => {
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

  it("does not expose social-service /internal/x-accounts* routes", async () => {
    const app = buildApp();
    expect((await request(app).post("/v1/internal/x-accounts/refresh")).status).toBe(404);
    expect((await request(app).get("/v1/internal/x-accounts/access-token")).status).toBe(404);
    expect((await request(app).get("/v1/internal/x-accounts")).status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
