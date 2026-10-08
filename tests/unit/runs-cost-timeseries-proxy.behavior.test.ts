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
 * GET /v1/runs/stats/costs/timeseries — driven over the wire. Asserts the forwarded
 * path + query (verbatim), the authenticated org header, the byte-identical body, and
 * that the staff-only margin/timeseries sibling is not shadowed. runs-service's field
 * names are a fixture here, not a contract (rules #6/#8).
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
  interval: "day",
  timezone: "Europe/Paris",
  buckets: [
    { bucket: "2026-10-07", groups: [{ dimensions: { campaignId: "c1" }, runCount: 12, totalCostInUsdCents: "40.1234567890" }] },
    { bucket: "2026-10-08", groups: [{ dimensions: { campaignId: "c1" }, runCount: 3, totalCostInUsdCents: "9.0000000000" }] },
  ],
};

const PATH = "/v1/runs/stats/costs/timeseries";

describe("GET /v1/runs/stats/costs/timeseries — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(UPSTREAM_BODY) };
    });
  });

  it("forwards the query verbatim to runs-service's real path with the authenticated identity", async () => {
    const qs = "?interval=day&tz=Europe%2FParis&groupBy=campaignId&brandId=b1&startedAfter=2026-10-01T22%3A00%3A00.000Z";
    const res = await request(buildApp()).get(`${PATH}${qs}`);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${RUNS_BASE}/v1/stats/costs/timeseries${qs}`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["X-API-Key"]).toBe("runs-test-key");
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("forwards no query string when the caller sends none", async () => {
    await request(buildApp()).get(PATH);
    expect(calls[0].url).toBe(`${RUNS_BASE}/v1/stats/costs/timeseries`);
  });

  it("scopes on the authenticated org even when the caller names another", async () => {
    await request(buildApp()).get(`${PATH}?orgId=someone-elses-org`).set("x-org-id", "someone-elses-org");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("forwards a runs-service 400 body field-for-field under its status", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ error: "Invalid tz value: Mars/Base" })),
      json: () => Promise.resolve({ error: "Invalid tz value: Mars/Base" }),
    }));
    const res = await request(buildApp()).get(`${PATH}?tz=Mars/Base`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid tz value: Mars/Base" });
  });

  it("does not shadow the staff-only margin/timeseries route", async () => {
    const res = await request(buildApp()).get("/v1/runs/stats/costs/margin/timeseries");
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
