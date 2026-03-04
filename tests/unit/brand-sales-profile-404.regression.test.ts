import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/brands/:id/sales-profile is now a get-or-create endpoint.
 * brand-service automatically triggers extraction if no profile exists,
 * so this endpoint no longer returns 404.
 *
 * Tests cover:
 *  - 200 on success (with cached/brandId fields)
 *  - 400 when Anthropic key is missing (extraction triggered but no key)
 *  - 500 for genuine server errors
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

describe("GET /v1/brands/:id/sales-profile – get-or-create", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should return 200 with sales profile", async () => {
    const profile = { cached: true, brandId: "b-1", profile: { valueProposition: "Test" } };
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(profile),
    }));

    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(profile);
  });

  it("should return 200 when extraction is triggered (not cached)", async () => {
    const profile = { cached: false, brandId: "b-1", profile: { valueProposition: "Freshly extracted" } };
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(profile),
    }));

    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.profile.valueProposition).toBe("Freshly extracted");
  });

  it("should return 400 when Anthropic key is missing", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"No Anthropic API key found"}'),
    }));

    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Anthropic API key not configured");
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
