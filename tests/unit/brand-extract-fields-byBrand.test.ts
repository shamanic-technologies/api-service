import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "admin";
    req.brandId = "brand-uuid-1,brand-uuid-2";
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

describe("POST /v1/brands/extract-fields — byBrand response format", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should proxy the new byBrand response shape from brand-service", async () => {
    const brandServiceResponse = {
      brands: [
        { brandId: "brand-uuid-1", domain: "acme.com", name: "Acme" },
        { brandId: "brand-uuid-2", domain: "globex.com", name: "Globex" },
      ],
      fields: {
        industry: {
          value: "SaaS tools",
          byBrand: {
            "acme.com": {
              value: "SaaS tools",
              cached: true,
              extractedAt: "2026-03-15T10:00:00Z",
              expiresAt: "2026-04-14T10:00:00Z",
              sourceUrls: ["https://acme.com/about"],
            },
            "globex.com": {
              value: "Industrial automation",
              cached: false,
              extractedAt: "2026-03-31T12:00:00Z",
              expiresAt: "2026-04-30T12:00:00Z",
              sourceUrls: ["https://globex.com"],
            },
          },
        },
      },
    };

    const fetchSpy = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(brandServiceResponse),
    }));
    global.fetch = fetchSpy;

    const res = await request(app)
      .post("/v1/brands/extract-fields")
      .send({ brandIds: ["brand-uuid-1", "brand-uuid-2"], fields: [{ key: "industry", description: "Primary industry" }] });

    expect(res.status).toBe(200);

    // Verify x-brand-id CSV header sent downstream
    const [, fetchInit] = fetchSpy.mock.calls[0];
    expect(fetchInit.headers["x-brand-id"]).toBe("brand-uuid-1,brand-uuid-2");
    // Verify brandIds stripped from forwarded body
    const forwardedBody = JSON.parse(fetchInit.body);
    expect(forwardedBody.brandIds).toBeUndefined();
    expect(forwardedBody.fields).toBeDefined();

    // brands array
    expect(res.body.brands).toHaveLength(2);
    expect(res.body.brands[0].domain).toBe("acme.com");
    expect(res.body.brands[1].brandId).toBe("brand-uuid-2");

    // fields with byBrand
    expect(res.body.fields.industry.value).toBe("SaaS tools");
    expect(res.body.fields.industry.byBrand["acme.com"].value).toBe("SaaS tools");
    expect(res.body.fields.industry.byBrand["acme.com"].cached).toBe(true);
    expect(res.body.fields.industry.byBrand["acme.com"].sourceUrls).toEqual(["https://acme.com/about"]);
    expect(res.body.fields.industry.byBrand["globex.com"].value).toBe("Industrial automation");
    expect(res.body.fields.industry.byBrand["globex.com"].cached).toBe(false);
  });

  it("should include extractedAt and expiresAt in byBrand entries", async () => {
    const brandServiceResponse = {
      brands: [{ brandId: "brand-uuid-1", domain: "acme.com", name: "Acme" }],
      fields: {
        valueProposition: {
          value: "All-in-one platform",
          byBrand: {
            "acme.com": {
              value: "All-in-one platform",
              cached: true,
              extractedAt: "2026-03-15T10:00:00Z",
              expiresAt: "2026-04-14T10:00:00Z",
              sourceUrls: null,
            },
          },
        },
      },
    };

    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(brandServiceResponse),
    }));

    const res = await request(app)
      .post("/v1/brands/extract-fields")
      .send({ brandIds: ["brand-uuid-1"], fields: [{ key: "valueProposition", description: "Core value proposition" }] });

    expect(res.status).toBe(200);
    const entry = res.body.fields.valueProposition.byBrand["acme.com"];
    expect(entry.extractedAt).toBe("2026-03-15T10:00:00Z");
    expect(entry.expiresAt).toBe("2026-04-14T10:00:00Z");
    expect(entry.sourceUrls).toBeNull();
  });

  it("should return 400 when brandIds is missing", async () => {
    const res = await request(app)
      .post("/v1/brands/extract-fields")
      .send({ fields: [{ key: "industry", description: "Primary industry" }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("brandIds");
  });
});

describe("POST /v1/brands/extract-images — brandIds body-to-header bridging", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should set x-brand-id CSV header and strip brandIds from body", async () => {
    const brandServiceResponse = {
      brands: [{ brandId: "brand-uuid-1", domain: "acme.com", name: "Acme" }],
      results: [{ category: "logo", images: [{ url: "https://r2.example.com/logo.png" }], byBrand: { "acme.com": [{ url: "https://r2.example.com/logo.png" }] } }],
    };

    const fetchSpy = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(brandServiceResponse),
    }));
    global.fetch = fetchSpy;

    const res = await request(app)
      .post("/v1/brands/extract-images")
      .send({ brandIds: ["brand-uuid-1"], categories: [{ key: "logo", description: "Company logo" }] });

    expect(res.status).toBe(200);

    const [, fetchInit] = fetchSpy.mock.calls[0];
    expect(fetchInit.headers["x-brand-id"]).toBe("brand-uuid-1");
    const forwardedBody = JSON.parse(fetchInit.body);
    expect(forwardedBody.brandIds).toBeUndefined();
    expect(forwardedBody.categories).toBeDefined();

    expect(res.body.brands).toHaveLength(1);
    expect(res.body.results[0].category).toBe("logo");
  });

  it("should return 400 when brandIds is missing", async () => {
    const res = await request(app)
      .post("/v1/brands/extract-images")
      .send({ categories: [{ key: "logo", description: "Company logo" }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("brandIds");
  });
});
