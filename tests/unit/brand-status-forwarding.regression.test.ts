import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Regression test: all brand endpoints must forward the downstream HTTP status
 * code instead of always returning 500. Previously, a 404 from brand-service
 * was converted to 500 by api-service, causing retry loops on the frontend.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import brandRouter from "../../src/routes/brand.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

/** Simulate a downstream service returning a specific HTTP error. */
function mockFetchError(status: number, message: string) {
  global.fetch = vi.fn().mockImplementation(async () => ({
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify({ error: message })),
  }));
}

describe("brand routes – downstream status code forwarding", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("GET /v1/brands/:id should forward 404 from brand-service", async () => {
    mockFetchError(404, "Brand not found");
    const res = await request(app).get("/v1/brands/non-existent-id");
    expect(res.status).toBe(404);
  });

  it("GET /v1/brands/:id should forward 500 from brand-service", async () => {
    mockFetchError(500, "Internal server error");
    const res = await request(app).get("/v1/brands/some-id");
    expect(res.status).toBe(500);
  });

  it("GET /v1/brands/:id/runs should forward 404 from brand-service", async () => {
    mockFetchError(404, "Brand not found");
    const res = await request(app).get("/v1/brands/non-existent-id/runs");
    expect(res.status).toBe(404);
  });

  it("GET /v1/brands should forward 403 from brand-service", async () => {
    mockFetchError(403, "Forbidden");
    const res = await request(app).get("/v1/brands");
    expect(res.status).toBe(403);
  });

  it("GET /v1/brands/costs should forward 404 from runs-service", async () => {
    mockFetchError(404, "Not found");
    const res = await request(app).get("/v1/brands/costs");
    expect(res.status).toBe(404);
  });

  it("GET /v1/brands/:id/cost-breakdown should forward 404", async () => {
    mockFetchError(404, "Not found");
    const res = await request(app).get("/v1/brands/some-id/cost-breakdown");
    expect(res.status).toBe(404);
  });
});
