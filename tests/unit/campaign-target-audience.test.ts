import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Tests for campaign creation with featureSlug + featureInputs.
 * Api-service:
 * 1. Validates structure (featureSlug, featureInputs required)
 * 2. Validates feature inputs via features-service (key-presence only)
 * 3. Upserts brand via brand-service
 * 4. Forwards featureInputs as-is to campaign-service (never inspects values)
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

// Mock runs-client
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

const validBody = {
  name: "Test Campaign",
  workflowSlug: "sales-email-cold-outreach-sienna",
  brandUrls: ["https://example.com"],
  featureSlug: "cold-outreach-v2",
  featureInputs: {
    targetAudience: "CTOs at SaaS startups with 10-50 employees in the US",
    urgency: "Recruitment closes in 30 days",
    scarcity: "Only 10 spots available worldwide",
    riskReversal: "Free trial for 2 weeks, no commitment",
    socialProof: "Backed by 60 sponsors including Acme, Globex",
  },
  maxBudgetDailyUsd: 10,
};

describe("POST /v1/campaigns with featureInputs", () => {
  let fetchCalls: Array<{ url: string; body?: Record<string, unknown> }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, body });

      // Features-service: return input definitions
      if (url.includes("/features/") && url.includes("/inputs")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            inputs: [
              { key: "targetAudience", required: true },
              { key: "urgency", required: true },
              { key: "scarcity", required: true },
              { key: "riskReversal", required: true },
              { key: "socialProof", required: true },
            ],
          }),
        };
      }

      // Brand upsert
      if (url.includes("/brands") && init?.method === "POST") {
        return {
          ok: true,
          json: () => Promise.resolve({ brandId: "brand-uuid-123", domain: "example.com", name: "Example", created: false }),
        };
      }

      // Campaign creation
      if (url.includes("/campaigns") && init?.method === "POST") {
        return {
          ok: true,
          json: () => Promise.resolve({
            campaign: { id: "campaign-123", brandId: "brand-uuid-123", name: body?.name, status: "ongoing" },
          }),
        };
      }

      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  it("should validate inputs via features-service and forward featureInputs to campaign-service", async () => {
    const app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.campaign.id).toBe("campaign-123");

    // Verify features-service was called for input validation
    const featuresCall = fetchCalls.find((c) => c.url.includes("/features/cold-outreach-v2/inputs"));
    expect(featuresCall).toBeDefined();

    // Verify brand upsert was called
    const brandCall = fetchCalls.find((c) => c.url.includes("/brands") && c.body?.orgId === "org_test456");
    expect(brandCall).toBeDefined();
    expect(brandCall!.body!.url).toBe("https://example.com");

    // Verify campaign-service received featureInputs as-is
    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall).toBeDefined();
    expect(campaignCall!.body!.workflowSlug).toBe("sales-email-cold-outreach-sienna");
    expect(campaignCall!.body!.type).toBe("cold-email-outreach");
    expect(campaignCall!.body!.featureSlug).toBe("cold-outreach-v2");
    expect(campaignCall!.body!.featureInputs).toEqual(validBody.featureInputs);
    expect(campaignCall!.body!.brandIds).toEqual(["brand-uuid-123"]);

    // Verify legacy top-level fields are NOT present
    expect(campaignCall!.body!.targetAudience).toBeUndefined();
    expect(campaignCall!.body!.urgency).toBeUndefined();
    expect(campaignCall!.body!.scarcity).toBeUndefined();
  });

  it("should reject when featureSlug is missing", async () => {
    const app = createApp();
    const { featureSlug, ...noSlug } = validBody;
    const res = await request(app).post("/v1/campaigns").send(noSlug);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("featureSlug");
  });

  it("should reject when featureInputs is missing", async () => {
    const app = createApp();
    const { featureInputs, ...noInputs } = validBody;
    const res = await request(app).post("/v1/campaigns").send(noInputs);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("featureInputs");
  });

  it("should reject when a required feature input key is missing", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        ...validBody,
        featureInputs: {
          targetAudience: "CTOs",
          // Missing: urgency, scarcity, riskReversal, socialProof
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required feature inputs");
    expect(res.body.missingKeys).toContain("urgency");
    expect(res.body.missingKeys).toContain("scarcity");
    expect(res.body.missingKeys).toContain("riskReversal");
    expect(res.body.missingKeys).toContain("socialProof");
  });

  it("should accept any keys in featureInputs — api-service is agnostic of content", async () => {
    // Features-service says only "query" is required for this feature
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      if (url.includes("/features/") && url.includes("/inputs")) {
        return {
          ok: true,
          json: () => Promise.resolve({ inputs: [{ key: "query", required: true }] }),
        };
      }
      if (url.includes("/brands") && init?.method === "POST") {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      }
      if (url.includes("/campaigns") && init?.method === "POST") {
        return { ok: true, json: () => Promise.resolve({ campaign: { id: "c-1", status: "ongoing" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Custom Feature",
        workflowSlug: "custom-workflow-v1",
        brandUrls: ["https://example.com"],
        featureSlug: "custom-search",
        featureInputs: { query: "AI startups", customField: 42, nested: { a: 1 } },
      });

    expect(res.status).toBe(200);
  });

  it("should convert budget numbers to strings for campaign-service", async () => {
    const app = createApp();
    await request(app)
      .post("/v1/campaigns")
      .send({ ...validBody, maxBudgetDailyUsd: 25, maxBudgetWeeklyUsd: 100 });

    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.maxBudgetDailyUsd).toBe("25");
    expect(campaignCall!.body!.maxBudgetWeeklyUsd).toBe("100");
  });

  it("should fail when brand upsert fails", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/features/") && url.includes("/inputs")) {
        return { ok: true, json: () => Promise.resolve({ inputs: [] }) };
      }
      if (url.includes("/brands") && init?.method === "POST") {
        return { ok: false, status: 500, text: () => Promise.resolve(JSON.stringify({ error: "DB down" })) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validBody);
    expect(res.status).toBe(500);
  });

  it("should fail when features-service returns an error", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/features/") && url.includes("/inputs")) {
        return { ok: false, status: 404, text: () => Promise.resolve(JSON.stringify({ error: "Feature not found" })) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validBody);
    // features-service 404 is forwarded — unknown feature slug
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Feature not found");
  });
});
