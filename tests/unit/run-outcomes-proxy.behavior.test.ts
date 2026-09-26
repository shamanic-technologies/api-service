import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { RUNS_BASE } = vi.hoisted(() => {
  const RUNS_BASE = "http://runs.test.local";
  process.env.RUNS_SERVICE_URL = RUNS_BASE;
  process.env.RUNS_SERVICE_API_KEY = "runs-test-key";
  return { RUNS_BASE };
});

/**
 * GET /v1/runs/stats/run-outcomes — driven over the wire. Asserts the forwarded
 * path + query (verbatim), the authenticated org header, and the byte-identical
 * body. runs-service's field names are a fixture here, not a contract (rules #6/#8).
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
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

import runsRouter from "../../src/routes/runs.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", runsRouter);
  return app;
}

const UPSTREAM_BODY = {
  scope: "entry",
  groups: [
    {
      dimensions: { campaignId: "c1" },
      runCount: 1300,
      completedCount: 1262,
      failedCount: 38,
      runningCount: 0,
      successRate: 0.9707,
      medianDurationMs: 112000,
      minStartedAt: "2026-08-27T00:00:00.000Z",
      maxStartedAt: "2026-09-26T00:00:00.000Z",
    },
    {
      dimensions: { campaignId: "c2" },
      runCount: 2,
      completedCount: 0,
      failedCount: 0,
      runningCount: 2,
      successRate: null,
      medianDurationMs: null,
      minStartedAt: "2026-09-26T00:00:00.000Z",
      maxStartedAt: "2026-09-26T00:00:00.000Z",
    },
  ],
};

describe("GET /v1/runs/stats/run-outcomes — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(UPSTREAM_BODY) };
    });
  });

  it("forwards brandId + startedAfter verbatim to runs-service's real path with the authenticated org", async () => {
    const qs = "?brandId=b1&startedAfter=2026-08-27T00%3A00%3A00.000Z";
    const res = await request(buildApp()).get(`/v1/runs/stats/run-outcomes${qs}`);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${RUNS_BASE}/v1/stats/run-outcomes${qs}`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["X-API-Key"]).toBe("runs-test-key");
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("forwards a campaignIds family in one call, untouched", async () => {
    const qs = "?campaignIds=c1,c2,c3&groupBy=campaignId&scope=all";
    await request(buildApp()).get(`/v1/runs/stats/run-outcomes${qs}`);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${RUNS_BASE}/v1/stats/run-outcomes${qs}`);
  });

  it("forwards no query string when the caller sends none", async () => {
    await request(buildApp()).get("/v1/runs/stats/run-outcomes");
    expect(calls[0].url).toBe(`${RUNS_BASE}/v1/stats/run-outcomes`);
  });

  it("scopes on the authenticated org even when the caller names another", async () => {
    await request(buildApp())
      .get("/v1/runs/stats/run-outcomes?orgId=someone-elses-org")
      .set("x-org-id", "someone-elses-org");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("forwards a runs-service 400 body field-for-field under its status", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ error: "campaignIds: more than 500 ids" })),
      json: () => Promise.resolve({ error: "campaignIds: more than 500 ids" }),
    }));
    const res = await request(buildApp()).get("/v1/runs/stats/run-outcomes?campaignIds=");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "campaignIds: more than 500 ids" });
  });
});
