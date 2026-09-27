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
 * GET /v1/runs/:id — driven over the wire. runs-service reads one run by id without
 * scoping to an org, so the gateway 404s a run of another org. Field names below are
 * a fixture (rules #6/#8), except `organizationId`, the one field the gateway reads.
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

const RUN_ID = "c376867e-f94f-435b-8833-355affca0a4b";
const OWN_RUN = {
  id: RUN_ID,
  organizationId: "org_test456",
  taskName: "execute-workflow",
  totalCostInUsdCents: "12.5000000000",
  descendantRuns: [{ id: "child-1", costs: [] }],
};

function stubFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; options: any }> = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return {
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  });
  return calls;
}

describe("GET /v1/runs/:id — over the wire", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("forwards to runs-service GET /v1/runs/:id with the authenticated org and returns the body byte-identical", async () => {
    const calls = stubFetch(OWN_RUN);
    const res = await request(buildApp()).get(`/v1/runs/${RUN_ID}`);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${RUNS_BASE}/v1/runs/${RUN_ID}`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["X-API-Key"]).toBe("runs-test-key");
    expect(res.body).toEqual(OWN_RUN);
  });

  it("answers 404 for a run of another org, the same body as an unknown id", async () => {
    stubFetch({ ...OWN_RUN, organizationId: "someone-elses-org" });
    const res = await request(buildApp()).get(`/v1/runs/${RUN_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Run not found" });
  });

  it("answers 404 for a run carrying no org at all", async () => {
    stubFetch({ ...OWN_RUN, organizationId: null });
    const res = await request(buildApp()).get(`/v1/runs/${RUN_ID}`);
    expect(res.status).toBe(404);
  });

  it("does not let a caller-supplied x-org-id pick the org compared against", async () => {
    stubFetch({ ...OWN_RUN, organizationId: "someone-elses-org" });
    const res = await request(buildApp())
      .get(`/v1/runs/${RUN_ID}`)
      .set("x-org-id", "someone-elses-org");
    expect(res.status).toBe(404);
  });

  it("forwards runs-service's own 404 body field-for-field", async () => {
    stubFetch({ error: "Run not found" }, 404);
    const res = await request(buildApp()).get(`/v1/runs/${RUN_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Run not found" });
  });

  it("leaves the literal /runs/stats/* siblings on their own downstream paths", async () => {
    const calls = stubFetch({ groups: [] });
    await request(buildApp()).get("/v1/runs/stats/run-outcomes");
    expect(calls[0].url).toBe(`${RUNS_BASE}/v1/stats/run-outcomes`);
  });
});
