import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Tests for discovery campaign creation.
 * Discovery campaigns use the same schema as outreach — featureSlug + featureInputs.
 * The campaign type is derived from workflowSlug prefix.
 */

// Mock auth middleware
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

describe("Discovery campaign creation", () => {
  let fetchCalls: Array<{ url: string; method?: string; body?: Record<string, unknown>; headers?: Record<string, string> }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = init?.headers ? Object.fromEntries(Object.entries(init.headers as Record<string, string>)) : undefined;
      fetchCalls.push({ url, method: init?.method, body, headers });

      // Features-service: discovery features only require targetAudience
      if (url.includes("/features/") && url.includes("/inputs")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            inputs: [{ key: "targetAudience", required: true }],
          }),
        };
      }

      // Brand upsert
      if (url.includes("/brands") && init?.method === "POST") {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-uuid-123" }) };
      }

      // Campaign creation
      if (url.includes("/campaigns") && init?.method === "POST") {
        return {
          ok: true,
          json: () => Promise.resolve({
            campaign: { id: "campaign-disc-1", brandId: "brand-uuid-123", name: body?.name, status: "ongoing" },
          }),
        };
      }

      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  it("should create an outlets-database-discovery campaign with featureInputs", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Tech Media Discovery",
        workflowSlug: "outlets-database-discovery-cedar",
        brandUrl: "https://acme.com",
        featureSlug: "outlet-discovery",
        featureInputs: { targetAudience: "Tech publications covering SaaS and AI" },
      });

    expect(res.status).toBe(200);
    expect(res.body.campaign.id).toBe("campaign-disc-1");

    // Verify campaign-service received the correct type derived from workflowSlug
    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall).toBeDefined();
    expect(campaignCall!.body!.type).toBe("outlets-database-discovery");
    expect(campaignCall!.body!.workflowSlug).toBe("outlets-database-discovery-cedar");
    expect(campaignCall!.body!.featureInputs).toEqual({ targetAudience: "Tech publications covering SaaS and AI" });

    // No legacy top-level targetAudience
    expect(campaignCall!.body!.targetAudience).toBeUndefined();
  });

  it("should create a journalists-database-discovery campaign", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Journalist Discovery",
        workflowSlug: "journalists-database-discovery-birch",
        brandUrl: "https://acme.com",
        featureSlug: "journalist-discovery",
        featureInputs: { targetAudience: "Journalists covering fintech in the US" },
      });

    expect(res.status).toBe(200);

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.type).toBe("journalists-database-discovery");
  });

  it("should reject when featureSlug is missing for discovery campaigns", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Missing Slug",
        workflowSlug: "outlets-database-discovery-cedar",
        brandUrl: "https://acme.com",
        featureInputs: { targetAudience: "Tech publications" },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("featureSlug");
  });

  it("should reject when required feature input is missing", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Missing Input",
        workflowSlug: "outlets-database-discovery-cedar",
        brandUrl: "https://acme.com",
        featureSlug: "outlet-discovery",
        featureInputs: {}, // Missing targetAudience
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required feature inputs");
    expect(res.body.missingKeys).toContain("targetAudience");
  });

  it("should forward x-brand-id, x-feature-slug, x-workflow-slug headers to campaign-service", async () => {
    const app = createApp();
    await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Header Test",
        workflowSlug: "outlets-database-discovery-cedar",
        brandUrl: "https://acme.com",
        featureSlug: "outlet-discovery",
        featureInputs: { targetAudience: "Tech publications" },
      });

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall).toBeDefined();
    // Resolved brandId from brand-service must be forwarded as header
    expect(campaignCall!.headers!["x-brand-id"]).toBe("brand-uuid-123");
    // featureSlug and workflowSlug from body must also be forwarded as headers
    expect(campaignCall!.headers!["x-feature-slug"]).toBe("outlet-discovery");
    expect(campaignCall!.headers!["x-workflow-slug"]).toBe("outlets-database-discovery-cedar");
  });

  it("should convert budget numbers to strings for discovery campaigns", async () => {
    const app = createApp();
    await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Budget Discovery",
        workflowSlug: "outlets-database-discovery-cedar",
        brandUrl: "https://acme.com",
        featureSlug: "outlet-discovery",
        featureInputs: { targetAudience: "Tech publications" },
        maxBudgetDailyUsd: 25,
      });

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.maxBudgetDailyUsd).toBe("25");
  });
});
