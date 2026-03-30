import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

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

const mockImages = [
  {
    url: "https://r2.example.com/logo.png",
    category: "logo",
    sourceUrl: "https://acme.com",
    extractedAt: "2026-03-01T00:00:00Z",
  },
  {
    url: "https://r2.example.com/hero.jpg",
    category: "hero_image",
    sourceUrl: "https://acme.com/about",
    extractedAt: "2026-03-01T00:00:00Z",
  },
];

describe("POST /v1/brands/:id/extract-images", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should proxy the request body to brand-service and return results", async () => {
    let capturedBody: any;
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: () => Promise.resolve({ brandId: "brand-abc", images: mockImages }),
      };
    });

    const body = {
      categories: [
        { key: "logo", description: "Company logo", maxCount: 1 },
        { key: "hero_image", description: "Main hero/banner image", maxCount: 1 },
      ],
    };

    const res = await request(app).post("/v1/brands/brand-abc/extract-images").send(body);

    expect(res.status).toBe(200);
    expect(res.body.brandId).toBe("brand-abc");
    expect(res.body.images).toHaveLength(2);
    expect(capturedBody.categories).toHaveLength(2);
    expect(capturedBody.categories[0].key).toBe("logo");
  });

  it("should forward the brand ID in the URL", async () => {
    let capturedUrl = "";
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return { ok: true, json: () => Promise.resolve({ brandId: "brand-xyz", images: [] }) };
    });

    await request(app).post("/v1/brands/brand-xyz/extract-images").send({ categories: [] });

    expect(capturedUrl).toContain("/brands/brand-xyz/extract-images");
  });

  it("should return 400 when Anthropic key is not configured", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"No Anthropic API key found"}'),
    }));

    const res = await request(app).post("/v1/brands/brand-abc/extract-images").send({ categories: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Anthropic API key not configured");
  });

  it("should return 500 when brand-service fails", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"Internal error"}'),
    }));

    const res = await request(app).post("/v1/brands/brand-abc/extract-images").send({ categories: [] });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Internal error");
  });
});

describe("GET /v1/brands/:id/extracted-images", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should proxy the response from brand-service", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve({ brandId: "brand-abc", images: mockImages }),
    }));

    const res = await request(app).get("/v1/brands/brand-abc/extracted-images");

    expect(res.status).toBe(200);
    expect(res.body.brandId).toBe("brand-abc");
    expect(res.body.images).toHaveLength(2);
    expect(res.body.images[0].category).toBe("logo");
  });

  it("should forward campaignId query param", async () => {
    let capturedUrl = "";
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return { ok: true, json: () => Promise.resolve({ brandId: "brand-abc", images: [] }) };
    });

    await request(app).get("/v1/brands/brand-abc/extracted-images?campaignId=camp-123");

    expect(capturedUrl).toContain("/brands/brand-abc/extracted-images?campaignId=camp-123");
  });

  it("should not append query string when no campaignId", async () => {
    let capturedUrl = "";
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return { ok: true, json: () => Promise.resolve({ brandId: "brand-abc", images: [] }) };
    });

    await request(app).get("/v1/brands/brand-abc/extracted-images");

    expect(capturedUrl).toContain("/brands/brand-abc/extracted-images");
    expect(capturedUrl).not.toContain("?");
  });

  it("should return 404 when brand-service returns 404", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"Brand not found"}'),
    }));

    const res = await request(app).get("/v1/brands/nonexistent/extracted-images");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Brand not found");
  });

  it("should return 500 when brand-service fails", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"Internal error"}'),
    }));

    const res = await request(app).get("/v1/brands/brand-abc/extracted-images");

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Internal error");
  });
});
