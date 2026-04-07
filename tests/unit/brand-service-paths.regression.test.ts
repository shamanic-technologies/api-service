import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Regression test: brand-service paths must match the actual brand-service API.
 *
 * /orgs/*   routes exist on brand-service for org-scoped operations (list, extract).
 * /internal/* routes exist for by-ID lookups (get brand, extracted fields/images, runs).
 *
 * api-service must NEVER call /orgs/brands/:id — that path does not exist on brand-service.
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
import campaignRouter from "../../src/routes/campaigns.js";

function buildBrandApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

function buildCampaignApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignRouter);
  return app;
}

describe("brand-service path correctness", () => {
  let capturedUrls: string[];

  beforeEach(() => {
    capturedUrls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrls.push(url);

      // Return valid responses for all expected paths
      if (url.includes("/internal/brands/") && url.includes("/runs")) {
        return { ok: true, json: () => Promise.resolve({ runs: [] }) };
      }
      if (url.includes("/internal/brands/")) {
        return { ok: true, json: () => Promise.resolve({ brand: { id: "brand-abc", brandUrl: "https://acme.com" } }) };
      }
      if (url.includes("/orgs/brands")) {
        return { ok: true, json: () => Promise.resolve({ brands: [] }) };
      }
      if (url.includes("/campaigns")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            campaign: { id: "camp-1", brandIds: ["brand-abc"], brandUrls: null, status: "ongoing", workflowSlug: "wf-1" },
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  it("GET /v1/brands/:id calls /internal/brands/:id (not /orgs/brands/:id)", async () => {
    const app = buildBrandApp();
    await request(app).get("/v1/brands/brand-abc");

    const brandCall = capturedUrls.find((u) => u.includes("/brands/brand-abc") && !u.includes("/extracted"));
    expect(brandCall).toBeDefined();
    expect(brandCall).toContain("/internal/brands/brand-abc");
    expect(brandCall).not.toContain("/orgs/brands/brand-abc");
  });

  it("GET /v1/brands/:id/extracted-fields calls /internal/brands/:id/extracted-fields", async () => {
    const app = buildBrandApp();
    await request(app).get("/v1/brands/brand-abc/extracted-fields");

    const call = capturedUrls.find((u) => u.includes("extracted-fields"));
    expect(call).toBeDefined();
    expect(call).toContain("/internal/brands/brand-abc/extracted-fields");
  });

  it("GET /v1/brands/:id/extracted-images calls /internal/brands/:id/extracted-images", async () => {
    const app = buildBrandApp();
    await request(app).get("/v1/brands/brand-abc/extracted-images");

    const call = capturedUrls.find((u) => u.includes("extracted-images"));
    expect(call).toBeDefined();
    expect(call).toContain("/internal/brands/brand-abc/extracted-images");
  });

  it("GET /v1/brands/:id/runs calls /internal/brands/:id/runs", async () => {
    const app = buildBrandApp();
    await request(app).get("/v1/brands/brand-abc/runs");

    const call = capturedUrls.find((u) => u.includes("/runs"));
    expect(call).toBeDefined();
    expect(call).toContain("/internal/brands/brand-abc/runs");
  });

  it("GET /v1/brands (list) calls /orgs/brands (org-scoped, no ID in path)", async () => {
    const app = buildBrandApp();
    await request(app).get("/v1/brands");

    const call = capturedUrls.find((u) => u.includes("/orgs/brands"));
    expect(call).toBeDefined();
    expect(call).toContain("/orgs/brands");
  });

  it("campaign brandUrls resolution calls /internal/brands/:id (not /orgs/)", async () => {
    const app = buildCampaignApp();
    await request(app).get("/v1/campaigns/camp-1");

    const brandCall = capturedUrls.find((u) => u.includes("/brands/brand-abc") && !u.includes("/campaigns"));
    expect(brandCall).toBeDefined();
    expect(brandCall).toContain("/internal/brands/brand-abc");
    expect(brandCall).not.toContain("/orgs/brands/brand-abc");
  });

  it("deprecated POST /v1/brands/:id/extract-fields no longer exists", async () => {
    const app = buildBrandApp();
    const res = await request(app).post("/v1/brands/brand-abc/extract-fields").send({ fields: [] });
    expect(res.status).toBe(404);
  });

  it("deprecated POST /v1/brands/:id/extract-images no longer exists", async () => {
    const app = buildBrandApp();
    const res = await request(app).post("/v1/brands/brand-abc/extract-images").send({ categories: [] });
    expect(res.status).toBe(404);
  });
});
