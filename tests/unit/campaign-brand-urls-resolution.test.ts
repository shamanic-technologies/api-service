import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Regression tests for brandUrls resolution on GET /v1/campaigns and GET /v1/campaigns/:id.
 * api-service resolves brandIds → brandUrls via brand-service so clients always get brandUrls.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "admin";
    next();
  },
  requireOrg: (req: any, res: any, next: any) => {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    next();
  },
  requireUser: (req: any, res: any, next: any) => {
    if (!req.userId) return res.status(401).json({ error: "User identity required" });
    next();
  },
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import campaignRouter from "../../src/routes/campaigns.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignRouter);
  return app;
}

const BRAND_LOOKUP: Record<string, string> = {
  "brand-1": "https://acme.com",
  "brand-2": "https://foo.io",
  "brand-3": "https://bar.dev",
};

describe("Campaign brandUrls resolution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      // GET /brands/:id — return brand with brandUrl
      for (const [brandId, brandUrl] of Object.entries(BRAND_LOOKUP)) {
        if (url.includes(`/brands/${brandId}`) && !url.includes("/campaigns")) {
          return {
            ok: true,
            json: () => Promise.resolve({ brand: { id: brandId, brandUrl, domain: brandUrl.replace(/https?:\/\//, "") } }),
          };
        }
      }

      // GET /campaigns/:id — return campaign with brandIds but null brandUrls (simulates campaign-service)
      if (url.match(/\/campaigns\/camp-[a-z0-9]+$/) && !url.includes("?")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              campaign: {
                id: "camp-abc",
                orgId: "org_test456",
                name: "Test Campaign",
                brandIds: ["brand-1", "brand-2"],
                brandUrls: null,
                status: "ongoing",
                workflowSlug: "workflow-v1",
              },
            }),
        };
      }

      // GET /campaigns — return list with brandIds but null brandUrls
      if (url.includes("/campaigns") && !url.includes("/campaigns/")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              campaigns: [
                {
                  id: "camp-1",
                  orgId: "org_test456",
                  name: "Campaign One",
                  brandIds: ["brand-1"],
                  brandUrls: null,
                  status: "ongoing",
                },
                {
                  id: "camp-2",
                  orgId: "org_test456",
                  name: "Campaign Two",
                  brandIds: ["brand-2", "brand-3"],
                  brandUrls: null,
                  status: "stopped",
                },
              ],
            }),
        };
      }

      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  it("GET /v1/campaigns/:id resolves brandUrls from brandIds", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/campaigns/camp-abc");

    expect(res.status).toBe(200);
    expect(res.body.campaign.brandUrls).toEqual(["https://acme.com", "https://foo.io"]);
    expect(res.body.campaign.brandIds).toEqual(["brand-1", "brand-2"]);
  });

  it("GET /v1/campaigns resolves brandUrls for each campaign in the list", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/campaigns");

    expect(res.status).toBe(200);
    expect(res.body.campaigns).toHaveLength(2);
    expect(res.body.campaigns[0].brandUrls).toEqual(["https://acme.com"]);
    expect(res.body.campaigns[1].brandUrls).toEqual(["https://foo.io", "https://bar.dev"]);
  });

  it("GET /v1/campaigns/:id returns empty brandUrls when brandIds is empty", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url.match(/\/campaigns\/camp-empty$/)) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              campaign: {
                id: "camp-empty",
                orgId: "org_test456",
                name: "Empty Brands",
                brandIds: [],
                brandUrls: null,
                status: "ongoing",
                workflowSlug: "workflow-v1",
              },
            }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app).get("/v1/campaigns/camp-empty");

    expect(res.status).toBe(200);
    expect(res.body.campaign.brandUrls).toEqual([]);
  });
});
