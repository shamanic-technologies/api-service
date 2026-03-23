import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/brands/:id/extracted-fields
 * Lists all previously extracted and cached fields for a brand.
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

const mockFields = [
  {
    key: "industry",
    value: "SaaS",
    sourceUrls: ["https://acme.com"],
    extractedAt: "2026-03-01T00:00:00Z",
    expiresAt: "2026-03-31T00:00:00Z",
  },
  {
    key: "targetAudience",
    value: ["developers", "startups"],
    sourceUrls: ["https://acme.com/about"],
    extractedAt: "2026-03-01T00:00:00Z",
    expiresAt: "2026-03-31T00:00:00Z",
  },
  {
    key: "competitors",
    value: null,
    sourceUrls: null,
    extractedAt: "2026-03-01T00:00:00Z",
    expiresAt: "2026-03-31T00:00:00Z",
  },
];

describe("GET /v1/brands/:id/extracted-fields", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should proxy the response from brand-service", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve({ brandId: "brand-abc", fields: mockFields }),
    }));

    const res = await request(app).get("/v1/brands/brand-abc/extracted-fields");

    expect(res.status).toBe(200);
    expect(res.body.brandId).toBe("brand-abc");
    expect(res.body.fields).toHaveLength(3);
    expect(res.body.fields[0].key).toBe("industry");
    expect(res.body.fields[1].value).toEqual(["developers", "startups"]);
    expect(res.body.fields[2].value).toBeNull();
  });

  it("should forward the brand ID in the URL", async () => {
    let capturedUrl = "";
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return { ok: true, json: () => Promise.resolve({ brandId: "brand-xyz", fields: [] }) };
    });

    await request(app).get("/v1/brands/brand-xyz/extracted-fields");

    expect(capturedUrl).toContain("/brands/brand-xyz/extracted-fields");
  });

  it("should return 404 when brand-service returns 404", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"Brand not found"}'),
    }));

    const res = await request(app).get("/v1/brands/nonexistent/extracted-fields");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Brand not found");
  });

  it("should return 500 when brand-service fails", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"Internal error"}'),
    }));

    const res = await request(app).get("/v1/brands/brand-abc/extracted-fields");

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Internal error");
  });
});
