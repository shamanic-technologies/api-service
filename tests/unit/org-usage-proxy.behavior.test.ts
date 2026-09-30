import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { FEATURES_BASE };
});

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

describe("GET /v1/features/orgs/usage", () => {
  let calls: { url: string; headers: Record<string, string> }[];
  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      return new Response(JSON.stringify({ basis: "billed", totalBilledUsd: 30.78, categories: [{ key: "setup", billedUsd: 7.4 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as any;
  });

  it("forwards to features-service /orgs/usage under the authenticated org, body byte-identical", async () => {
    const res = await request(buildApp()).get("/v1/features/orgs/usage").set("x-org-id", "org_attacker");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ basis: "billed", totalBilledUsd: 30.78, categories: [{ key: "setup", billedUsd: 7.4 }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/orgs/usage`);
    expect(calls[0].headers["x-org-id"]).toBe("org_test456");
  });

  it("forwards an upstream error body verbatim under its status", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "Failed to compute usage" }), { status: 502, headers: { "content-type": "application/json" } })) as any;
    const res = await request(buildApp()).get("/v1/features/orgs/usage");
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Failed to compute usage" });
  });
});
