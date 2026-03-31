import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Tests for multi-brand campaign creation.
 * POST /v1/campaigns accepts brandUrls: string[] and resolves each URL
 * to a brandId via brand-service in parallel.
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

describe("Multi-brand campaign creation", () => {
  let fetchCalls: Array<{ url: string; method?: string; body?: Record<string, unknown>; headers?: Record<string, string> }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = init?.headers ? Object.fromEntries(Object.entries(init.headers as Record<string, string>)) : undefined;
      fetchCalls.push({ url, method: init?.method, body, headers });

      if (url.includes("/features/") && url.includes("/inputs")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            inputs: [{ key: "targetAudience", required: true }],
          }),
        };
      }

      if (url.includes("/brands") && init?.method === "POST") {
        // Return a deterministic brandId based on the URL
        const brandUrl = body?.url as string;
        const brandId = `brand-${brandUrl.replace(/https?:\/\//, "").replace(/\./g, "-")}`;
        return { ok: true, json: () => Promise.resolve({ brandId }) };
      }

      if (url.includes("/campaigns") && init?.method === "POST") {
        return {
          ok: true,
          json: () => Promise.resolve({
            campaign: { id: "campaign-1", brandIds: body?.brandIds, name: body?.name, status: "ongoing" },
          }),
        };
      }

      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  it("should create campaign with a single brand URL", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Single Brand",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com"],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    expect(res.status).toBe(200);

    // Should upsert exactly one brand
    const brandCalls = fetchCalls.filter((c) => c.url.includes("/brands") && c.method === "POST");
    expect(brandCalls).toHaveLength(1);
    expect(brandCalls[0].body!.url).toBe("https://acme.com");

    // campaign-service should receive brandIds array with one element
    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.brandIds).toEqual(["brand-acme-com"]);

    // x-brand-id header should be a single UUID (no comma)
    expect(campaignCall!.headers!["x-brand-id"]).toBe("brand-acme-com");
  });

  it("should create campaign with multiple brand URLs", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Multi Brand",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com", "https://foo.io", "https://bar.dev"],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    expect(res.status).toBe(200);

    // Should upsert all three brands
    const brandCalls = fetchCalls.filter((c) => c.url.includes("/brands") && c.method === "POST");
    expect(brandCalls).toHaveLength(3);

    // campaign-service should receive brandIds array with three elements
    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.brandIds).toEqual(["brand-acme-com", "brand-foo-io", "brand-bar-dev"]);

    // x-brand-id header should be CSV
    expect(campaignCall!.headers!["x-brand-id"]).toBe("brand-acme-com,brand-foo-io,brand-bar-dev");
  });

  it("should NOT include brandUrls in campaign-service body (only brandIds)", async () => {
    const app = createApp();
    await request(app)
      .post("/v1/campaigns")
      .send({
        name: "No URL Leak",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com"],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    // brandUrls should not leak into campaign-service body — only brandIds
    expect(campaignCall!.body!.brandUrls).toBeUndefined();
    expect(campaignCall!.body!.brandIds).toBeDefined();
  });

  it("should reject when brandUrls is empty", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Empty Brands",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: [],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    expect(res.status).toBe(400);
  });

  it("should reject when brandUrls is missing", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "No Brands",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("brandUrls");
  });
});
