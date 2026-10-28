import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// No auth mock: exercises the real `authenticate` / `requireOrg` gate.
vi.hoisted(() => {
  process.env.META_SERVICE_URL = "http://meta.test.local";
  process.env.META_SERVICE_API_KEY = "meta-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import threadsRouter from "../../src/routes/threads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", threadsRouter);
  return app;
}

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const ROUTES: Array<["get" | "post" | "patch" | "delete", string]> = [
  ["post", "/v1/orgs/threads/auth/start"],
  ["post", "/v1/orgs/threads/auth/callback"],
  ["get", "/v1/orgs/threads/accounts"],
  ["patch", `/v1/orgs/threads/accounts/${ID}`],
  ["delete", `/v1/orgs/threads/accounts/${ID}`],
  ["post", `/v1/orgs/threads/accounts/${ID}/posts`],
];

describe("threads proxy — auth gate", () => {
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

  it("does not expose meta-service /internal/threads/* routes", async () => {
    const res = await request(buildApp()).post("/v1/internal/threads/token-refresh");
    expect(res.status).toBe(404);
  });
});
