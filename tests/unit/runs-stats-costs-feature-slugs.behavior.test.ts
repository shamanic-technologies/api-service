import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load, so set it before the router imports.
const { RUNS_BASE } = vi.hoisted(() => {
  const RUNS_BASE = "http://runs.test.local";
  process.env.RUNS_SERVICE_URL = RUNS_BASE;
  process.env.RUNS_SERVICE_API_KEY = "runs-test-key";
  return { RUNS_BASE };
});

/**
 * GET /v1/runs/stats/costs forwards runs-service's multi-slug feature filter
 * (`featureSlugs`, comma-separated, `IN (...)`). Before, the allowlist dropped it and a
 * caller asking for `a,b` silently got the whole-brand total with a 200.
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
      req.authType = "admin";
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

let calls: string[];

beforeEach(() => {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ groups: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

describe("GET /v1/runs/stats/costs featureSlugs passthrough", () => {
  it("forwards featureSlugs to runs-service /v1/stats/costs", async () => {
    const res = await request(buildApp())
      .get("/v1/runs/stats/costs")
      .query({
        groupBy: "costName",
        brandId: "b-1",
        featureSlugs: "sales-cold-email-outreach,sourcing-apollo-cold-filters",
      });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(`${url.origin}${url.pathname}`).toBe(`${RUNS_BASE}/v1/stats/costs`);
    expect(url.searchParams.get("featureSlugs")).toBe(
      "sales-cold-email-outreach,sourcing-apollo-cold-filters",
    );
    expect(url.searchParams.get("brandId")).toBe("b-1");
    expect(url.searchParams.get("groupBy")).toBe("costName");
    expect(url.searchParams.get("orgId")).toBe("org_test456");
  });

  it("leaves the single featureSlug filter unchanged and sends no featureSlugs when absent", async () => {
    await request(buildApp())
      .get("/v1/runs/stats/costs")
      .query({ groupBy: "brandId", featureSlug: "sales-cold-email-outreach" });

    const url = new URL(calls[0]);
    expect(url.searchParams.get("featureSlug")).toBe("sales-cold-email-outreach");
    expect(url.searchParams.has("featureSlugs")).toBe(false);
  });
});
