import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Regression: deprecated brand endpoints return 404.
 * POST /v1/brands/:id/extract-fields was removed (use POST /v1/brands/extract-fields instead).
 * Old sales-profile endpoints were removed long ago.
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

describe("deprecated brand endpoints return 404", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("POST /v1/brands/:id/extract-fields returns 404 (use POST /v1/brands/extract-fields)", async () => {
    const res = await request(app)
      .post("/v1/brands/some-brand-id/extract-fields")
      .send({ fields: [{ key: "industry", description: "Brand sector" }] });
    expect(res.status).toBe(404);
  });

  it("POST /v1/brands/:id/extract-images returns 404 (use POST /v1/brands/extract-images)", async () => {
    const res = await request(app)
      .post("/v1/brands/some-brand-id/extract-images")
      .send({ categories: [{ key: "logo", description: "Logo" }] });
    expect(res.status).toBe(404);
  });

  it("GET /v1/brands/:id/sales-profile returns 404", async () => {
    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");
    expect(res.status).toBe(404);
  });
});
