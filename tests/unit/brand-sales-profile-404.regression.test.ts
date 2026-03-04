import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Regression: GET /v1/brands/:id/sales-profile returned 500 when brand-service
 * returned 404 with a JSON error body (e.g. { "error": "Sales profile not found" }).
 *
 * Root cause: callExternalService threw an Error whose message was the JSON
 * `error` field (no status code). The route handler checked
 * `error.message.includes("404")` — which was false — so it fell through to
 * the generic 500 handler.
 *
 * Fix: callExternalService now attaches `statusCode` to the Error object, and
 * the handler checks `error.statusCode === 404` first.
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

describe("GET /v1/brands/:id/sales-profile – 404 handling", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should return 404 (not 500) when brand-service returns 404 with JSON error body", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"Sales profile not found"}'),
    }));

    const res = await request(app).get("/v1/brands/51b35f30-2d44-4492-9af8-df14ebafc9cd/sales-profile");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Sales profile not found");
  });

  it("should return 404 when brand-service returns 404 with plain text body", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    }));

    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(404);
  });

  it("should return 200 when brand-service returns a sales profile", async () => {
    const profile = { id: "sp-1", brandId: "b-1", valueProposition: "Test" };
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(profile),
    }));

    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(profile);
  });

  it("should return 500 for genuine server errors from brand-service", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"Internal server error"}'),
    }));

    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(500);
  });
});
