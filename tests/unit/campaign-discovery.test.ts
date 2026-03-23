import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Tests for discovery campaign creation and result endpoints.
 * Discovery campaigns (outlets-database-discovery, journalists-database-discovery)
 * don't require email-specific fields (urgency, scarcity, etc.) and derive their
 * campaign type from the workflowName prefix.
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
  let fetchCalls: Array<{ url: string; method?: string; body?: Record<string, unknown> }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });

      // Brand upsert
      if (url.includes("/brands") && init?.method === "POST") {
        return {
          ok: true,
          json: () => Promise.resolve({ brandId: "brand-uuid-123" }),
        };
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

  it("should create an outlets-database-discovery campaign without email fields", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Tech Media Discovery",
        workflowName: "outlets-database-discovery-cedar",
        brandUrl: "https://acme.com",
        targetAudience: "Tech publications covering SaaS and AI",
      });

    expect(res.status).toBe(200);
    expect(res.body.campaign.id).toBe("campaign-disc-1");

    // Verify brand was upserted
    const brandCall = fetchCalls.find((c) => c.url.includes("/brands") && c.method === "POST");
    expect(brandCall).toBeDefined();
    expect(brandCall!.body!.url).toBe("https://acme.com");

    // Verify NO sales-profile update was made (discovery campaigns skip this)
    const salesProfileCall = fetchCalls.find((c) => c.url.includes("/sales-profile"));
    expect(salesProfileCall).toBeUndefined();

    // Verify campaign-service received the correct type
    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall).toBeDefined();
    expect(campaignCall!.body!.type).toBe("outlets-database-discovery");
    expect(campaignCall!.body!.workflowName).toBe("outlets-database-discovery-cedar");
    expect(campaignCall!.body!.targetAudience).toBe("Tech publications covering SaaS and AI");

    // Verify email-specific fields are NOT present
    expect(campaignCall!.body!.urgency).toBeUndefined();
    expect(campaignCall!.body!.scarcity).toBeUndefined();
    expect(campaignCall!.body!.riskReversal).toBeUndefined();
    expect(campaignCall!.body!.socialProof).toBeUndefined();
  });

  it("should create a journalists-database-discovery campaign without email fields", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Journalist Discovery",
        workflowName: "journalists-database-discovery-birch",
        brandUrl: "https://acme.com",
        targetAudience: "Journalists covering fintech in the US",
      });

    expect(res.status).toBe(200);

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.type).toBe("journalists-database-discovery");
    expect(campaignCall!.body!.workflowName).toBe("journalists-database-discovery-birch");
  });

  it("should reject discovery campaign when targetAudience is missing", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Missing Audience",
        workflowName: "outlets-database-discovery-cedar",
        brandUrl: "https://acme.com",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("targetAudience");
    expect(res.body.hint).toContain("Discovery campaigns");
  });

  it("should reject discovery campaign when brandUrl is missing", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Missing URL",
        workflowName: "outlets-database-discovery-cedar",
        targetAudience: "Tech publications",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("brandUrl");
  });

  it("should still require email fields for non-discovery campaigns", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Test Campaign",
        workflowName: "sales-email-cold-outreach-sienna",
        brandUrl: "https://example.com",
        targetAudience: "CTOs at SaaS",
        // Missing: targetOutcome, valueForTarget, urgency, scarcity, riskReversal, socialProof
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("targetOutcome");
    expect(res.body.hint).toContain("AI generate better emails");
  });

  it("should convert budget numbers to strings for discovery campaigns", async () => {
    const app = createApp();
    await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Budget Discovery",
        workflowName: "outlets-database-discovery-cedar",
        brandUrl: "https://acme.com",
        targetAudience: "Tech publications",
        maxBudgetDailyUsd: 25,
      });

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.maxBudgetDailyUsd).toBe("25");
  });

  it("should send targetOutcome and valueForTarget defaults to campaign-service for discovery campaigns", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Defaults Discovery",
        workflowName: "outlets-database-discovery-cedar",
        brandUrl: "https://acme.com",
        targetAudience: "Tech publications covering SaaS",
      });

    expect(res.status).toBe(200);

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall).toBeDefined();
    // campaign-service requires these fields — api-service must provide defaults for discovery
    expect(campaignCall!.body!.targetOutcome).toBe("Discovery");
    expect(campaignCall!.body!.valueForTarget).toBe("Discovery");
  });

  it("should pass through client-provided targetOutcome and valueForTarget for discovery campaigns", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Dusk Discovery",
        workflowName: "outlets-database-discovery-dusk",
        brandUrl: "https://distribute.you",
        targetAudience: "Builders and SaaS founders",
        targetOutcome: "Get Started Free",
        valueForTarget: "Automates your distribution stack",
      });

    expect(res.status).toBe(200);

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall).toBeDefined();
    // Client-provided values should be passed through, not replaced with defaults
    expect(campaignCall!.body!.targetOutcome).toBe("Get Started Free");
    expect(campaignCall!.body!.valueForTarget).toBe("Automates your distribution stack");
  });

  it("should accept optional maxResults for discovery campaigns", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Limited Discovery",
        workflowName: "outlets-database-discovery-cedar",
        brandUrl: "https://acme.com",
        targetAudience: "Tech publications",
        maxResults: 50,
      });

    expect(res.status).toBe(200);

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.maxResults).toBe(50);
  });
});

