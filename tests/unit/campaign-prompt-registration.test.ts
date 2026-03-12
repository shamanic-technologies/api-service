import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Tests that campaign creation registers the cold-email prompt with
 * content-generation-service using the real org/user identity from
 * the request — prompts are org-scoped, not global.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user-uuid-abc";
    req.orgId = "org-uuid-xyz";
    req.runId = "run-uuid-123";
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

const VALID_CAMPAIGN_BODY = {
  name: "Test Campaign",
  workflowName: "sales-email-cold-outreach-sienna",
  brandUrl: "https://example.com",
  targetAudience: "CTOs at SaaS startups",
  targetOutcome: "Book sales demos",
  valueForTarget: "Enterprise analytics at startup pricing",
  urgency: "Early-adopter pricing ends March 31st",
  scarcity: "Only 10 spots available",
  riskReversal: "14-day free trial, cancel anytime",
  socialProof: "Backed by 60 sponsors",
  maxBudgetDailyUsd: 10,
};

describe("Campaign creation registers cold-email prompt", () => {
  let fetchCalls: Array<{ url: string; method?: string; body?: Record<string, unknown>; headers?: Record<string, string> }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = init?.headers as Record<string, string> | undefined;
      fetchCalls.push({ url, method: init?.method, body, headers });

      if (url.includes("/brands") && init?.method === "POST") {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-uuid-123" }) };
      }
      if (url.includes("/prompts") && init?.method === "PUT") {
        return { ok: true, json: () => Promise.resolve({ id: "prompt-uuid", orgId: "org-uuid-xyz", type: "cold-email" }) };
      }
      if (url.includes("/campaigns") && init?.method === "POST") {
        return { ok: true, json: () => Promise.resolve({ campaign: { id: "c-1", status: "ongoing" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  it("should call PUT /prompts on content-generation-service with real org/user headers", async () => {
    const app = createApp();
    await request(app).post("/v1/campaigns").send(VALID_CAMPAIGN_BODY);

    const promptCall = fetchCalls.find((c) => c.url.includes("/prompts") && c.method === "PUT");
    expect(promptCall).toBeDefined();
    expect(promptCall!.headers).toMatchObject({
      "x-org-id": "org-uuid-xyz",
      "x-user-id": "user-uuid-abc",
      "x-run-id": "run-uuid-123",
    });
  });

  it("should send cold-email type with all 6 template variables", async () => {
    const app = createApp();
    await request(app).post("/v1/campaigns").send(VALID_CAMPAIGN_BODY);

    const promptCall = fetchCalls.find((c) => c.url.includes("/prompts") && c.method === "PUT");
    expect(promptCall!.body).toHaveProperty("type", "cold-email");
    expect(promptCall!.body!.variables).toEqual([
      "leadFirstName",
      "leadLastName",
      "leadTitle",
      "leadCompanyName",
      "leadCompanyIndustry",
      "clientCompanyName",
    ]);
  });

  it("should include mustache placeholders and a resolved date in the prompt", async () => {
    const app = createApp();
    await request(app).post("/v1/campaigns").send(VALID_CAMPAIGN_BODY);

    const promptCall = fetchCalls.find((c) => c.url.includes("/prompts") && c.method === "PUT");
    const prompt = promptCall!.body!.prompt as string;

    expect(prompt).toContain("{{leadFirstName}}");
    expect(prompt).toContain("{{clientCompanyName}}");
    expect(prompt).toMatch(/Today is \d{4}-\d{2}-\d{2}\./);
  });

  it("should run prompt registration in parallel with brand upsert", async () => {
    const app = createApp();
    await request(app).post("/v1/campaigns").send(VALID_CAMPAIGN_BODY);

    // Both calls should happen before the campaign creation call
    const promptIdx = fetchCalls.findIndex((c) => c.url.includes("/prompts"));
    const brandIdx = fetchCalls.findIndex((c) => c.url.includes("/brands"));
    const campaignIdx = fetchCalls.findIndex((c) => c.url.includes("/campaigns") && c.body?.orgId);

    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(brandIdx).toBeGreaterThanOrEqual(0);
    expect(campaignIdx).toBeGreaterThan(Math.max(promptIdx, brandIdx));
  });

  it("should fail campaign creation if prompt registration fails", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });

      if (url.includes("/prompts") && init?.method === "PUT") {
        return new Response(JSON.stringify({ error: "content-generation-service unavailable" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/brands") && init?.method === "POST") {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-uuid-123" }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app).post("/v1/campaigns").send(VALID_CAMPAIGN_BODY);

    expect(res.status).toBe(502);

    // Campaign should NOT have been created
    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId);
    expect(campaignCall).toBeUndefined();
  });
});
