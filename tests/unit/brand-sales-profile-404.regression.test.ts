import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/brands/:id/extract-fields
 * Generic field extraction proxy to brand-service.
 * Replaces the old GET/POST/PUT sales-profile endpoints.
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

describe("POST /v1/brands/:id/extract-fields", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should return 200 with extracted results", async () => {
    const response = {
      brandId: "b-1",
      results: [
        { key: "industry", value: "SaaS", cached: true, extractedAt: "2026-03-01T00:00:00Z", expiresAt: "2026-03-31T00:00:00Z" },
        { key: "valueProposition", value: "All-in-one platform", cached: false, extractedAt: "2026-03-23T00:00:00Z", expiresAt: "2026-04-22T00:00:00Z" },
      ],
    };
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(response),
    }));

    const res = await request(app)
      .post("/v1/brands/some-brand-id/extract-fields")
      .send({
        fields: [
          { key: "industry", description: "Brand sector" },
          { key: "valueProposition", description: "Core value proposition" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.brandId).toBe("b-1");
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].key).toBe("industry");
    expect(res.body.results[0].cached).toBe(true);
  });

  it("should forward the request body to brand-service", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve({ brandId: "b-1", results: [] }),
    }));

    const fields = [
      { key: "industry", description: "Brand sector" },
      { key: "suggestedAngles", description: "PR angles" },
    ];

    await request(app)
      .post("/v1/brands/some-brand-id/extract-fields")
      .send({ fields });

    const fetchCall = (global.fetch as any).mock.calls[0];
    const url = typeof fetchCall[0] === "string" ? fetchCall[0] : fetchCall[0].url;
    expect(url).toContain("/brands/some-brand-id/extract-fields");

    const body = JSON.parse(fetchCall[1].body);
    expect(body.fields).toEqual(fields);
  });

  it("should return 400 when Anthropic key is missing", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"No Anthropic API key found"}'),
    }));

    const res = await request(app)
      .post("/v1/brands/some-brand-id/extract-fields")
      .send({ fields: [{ key: "industry", description: "Brand sector" }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Anthropic API key not configured");
  });

  it("should return 500 for genuine server errors", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"Internal server error"}'),
    }));

    const res = await request(app)
      .post("/v1/brands/some-brand-id/extract-fields")
      .send({ fields: [{ key: "industry", description: "Brand sector" }] });

    expect(res.status).toBe(500);
  });

  it("should return 404 for old sales-profile endpoints", async () => {
    const res = await request(app).get("/v1/brands/some-brand-id/sales-profile");
    expect(res.status).toBe(404);
  });
});
