import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Tests for dynasty slug support on campaign endpoints.
 * POST /campaigns accepts workflowDynastySlug/featureDynastySlug (preferred)
 * or workflowSlug/featureSlug (exact version pinning).
 * GET /campaigns forwards dynasty slug query params to campaign-service.
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

describe("Campaign dynasty slug support", () => {
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
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-uuid-123" }) };
      }

      if (url.includes("/campaigns") && init?.method === "POST") {
        return {
          ok: true,
          json: () => Promise.resolve({
            campaign: { id: "campaign-1", brandId: "brand-uuid-123", name: body?.name, status: "ongoing" },
          }),
        };
      }

      if (url.includes("/campaigns") && (!init?.method || init?.method === "GET")) {
        return {
          ok: true,
          json: () => Promise.resolve({ campaigns: [] }),
        };
      }

      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  // -----------------------------------------------------------------------
  // POST /campaigns — dynasty slug in body
  // -----------------------------------------------------------------------

  it("should create campaign with dynasty slugs instead of versioned slugs", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Dynasty Test",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com"],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    expect(res.status).toBe(200);
    expect(res.body.campaign.id).toBe("campaign-1");

    // features-service should be called with the dynasty slug
    const featuresCall = fetchCalls.find((c) => c.url.includes("/features/") && c.url.includes("/inputs"));
    expect(featuresCall).toBeDefined();
    expect(featuresCall!.url).toContain("/features/pr-cold-email-outreach/inputs");

    // campaign-service should receive dynasty slug fields
    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall).toBeDefined();
    expect(campaignCall!.body!.workflowDynastySlug).toBe("sales-email-cold-outreach-sienna");
    expect(campaignCall!.body!.featureDynastySlug).toBe("pr-cold-email-outreach");
    // versioned slugs should NOT be present when not provided
    expect(campaignCall!.body!.workflowSlug).toBeUndefined();
    expect(campaignCall!.body!.featureSlug).toBeUndefined();
  });

  it("should accept both dynasty and versioned slugs together", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Both Slugs",
        workflowSlug: "sales-email-cold-outreach-sienna-v3",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com"],
        featureSlug: "pr-cold-email-outreach-v2",
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    expect(res.status).toBe(200);

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.workflowSlug).toBe("sales-email-cold-outreach-sienna-v3");
    expect(campaignCall!.body!.workflowDynastySlug).toBe("sales-email-cold-outreach-sienna");
    // featureSlug is still forwarded in restData when provided
    expect(campaignCall!.body!.featureSlug).toBe("pr-cold-email-outreach-v2");
    expect(campaignCall!.body!.featureDynastySlug).toBe("pr-cold-email-outreach");
  });

  it("should reject when neither workflowSlug nor workflowDynastySlug is provided", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "No Workflow Slug",
        brandUrls: ["https://acme.com"],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("workflowSlug");
  });

  it("should reject when neither featureSlug nor featureDynastySlug is provided", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "No Feature Slug",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com"],
        featureInputs: { targetAudience: "SaaS founders" },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("featureSlug");
  });

  it("should derive campaign type from dynasty slug (uses startsWith)", async () => {
    const app = createApp();
    await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Discovery Dynasty",
        workflowDynastySlug: "outlets-database-discovery-cedar",
        brandUrls: ["https://acme.com"],
        featureDynastySlug: "outlet-discovery",
        featureInputs: { targetAudience: "Tech publications" },
      });

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.type).toBe("outlets-database-discovery");
  });

  it("should forward dynasty slug as x-feature-slug and x-workflow-slug headers", async () => {
    const app = createApp();
    await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Header Dynasty",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com"],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.headers!["x-feature-slug"]).toBe("pr-cold-email-outreach");
    expect(campaignCall!.headers!["x-workflow-slug"]).toBe("sales-email-cold-outreach-sienna");
  });

  // -----------------------------------------------------------------------
  // GET /campaigns — dynasty slug query params
  // -----------------------------------------------------------------------

  it("should forward dynasty slug query params to campaign-service", async () => {
    const app = createApp();
    await request(app)
      .get("/v1/campaigns")
      .query({
        featureDynastySlug: "pr-cold-email-outreach",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
      });

    const listCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.method === "GET");
    expect(listCall).toBeDefined();
    expect(listCall!.url).toContain("featureDynastySlug=pr-cold-email-outreach");
    expect(listCall!.url).toContain("workflowDynastySlug=sales-email-cold-outreach-sienna");
  });

  it("should forward exact slug query params to campaign-service", async () => {
    const app = createApp();
    await request(app)
      .get("/v1/campaigns")
      .query({
        featureSlug: "pr-cold-email-outreach-v2",
        workflowSlug: "sales-email-cold-outreach-sienna-v3",
      });

    const listCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.method === "GET");
    expect(listCall).toBeDefined();
    expect(listCall!.url).toContain("featureSlug=pr-cold-email-outreach-v2");
    expect(listCall!.url).toContain("workflowSlug=sales-email-cold-outreach-sienna-v3");
  });
});
