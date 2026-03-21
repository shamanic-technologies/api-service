import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Sales profile endpoints (refactored):
 *   GET  /v1/brands/:id/sales-profile  → 200 if exists, 404 if not
 *   POST /v1/brands/:id/sales-profile  → 200 on extraction, 409 if exists, 400 on missing key
 *   PUT  /v1/brands/:id/sales-profile  → 200 on refresh, 400 on missing key
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

describe("GET /v1/brands/:id/sales-profile – read only", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should return 200 with profile when it exists", async () => {
    const profile = { cached: true, brandId: "b-1", profile: { valueProposition: "Test" } };
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(profile),
    }));

    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(profile);
  });

  it("should return 404 when no profile exists", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"Sales profile not found"}'),
    }));

    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });

  it("should return 500 for genuine server errors", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"Internal server error"}'),
    }));

    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(500);
  });
});

describe("POST /v1/brands/:id/sales-profile – create", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should return 200 on successful extraction", async () => {
    const profile = { cached: false, brandId: "b-1", profile: { valueProposition: "New" } };
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(profile),
    }));

    const res = await request(app).post("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(profile);
  });

  it("should return 409 when profile already exists", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 409,
      text: () => Promise.resolve('{"error":"Sales profile already exists"}'),
    }));

    const res = await request(app).post("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already exists");
  });

  it("should return 400 when Anthropic key is missing", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"No Anthropic API key found"}'),
    }));

    const res = await request(app).post("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Anthropic API key not configured");
  });
});

describe("PUT /v1/brands/:id/sales-profile – refresh", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should return 200 on successful refresh and pass ?force=true to brand-service", async () => {
    const profile = { cached: false, brandId: "b-1", profile: { valueProposition: "Refreshed" } };
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(profile),
    }));

    const res = await request(app).put("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(profile);

    // Verify ?force=true is sent to brand-service
    const fetchCall = (global.fetch as any).mock.calls[0];
    const url = typeof fetchCall[0] === "string" ? fetchCall[0] : fetchCall[0].url;
    expect(url).toContain("/brands/some-brand-id/sales-profile?force=true");
  });

  it("should return 400 when Anthropic key is missing", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"No Anthropic API key found"}'),
    }));

    const res = await request(app).put("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Anthropic API key not configured");
  });

  it("should return 500 for genuine server errors", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"Internal server error"}'),
    }));

    const res = await request(app).put("/v1/brands/some-brand-id/sales-profile");

    expect(res.status).toBe(500);
  });
});
