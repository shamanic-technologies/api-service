import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/campaigns — no-website path.
 * A caller may pass brandIds (UUIDs of already-created brands) INSTEAD of brandUrls.
 * When brandIds is provided, api-service SKIPS the brandUrls->brand upsert and
 * forwards those ids straight to campaign-service (still setting x-brand-id).
 * Exactly one of brandUrls / brandIds is required.
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

const BRAND_ID = "22222222-2222-4222-8222-222222222222";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignRouter);
  return app;
}

describe("POST /v1/campaigns — no-website brandIds path", () => {
  let fetchCalls: Array<{ url: string; method?: string; body?: Record<string, unknown>; headers?: Record<string, string> }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = init?.headers
        ? Object.fromEntries(Object.entries(init.headers as Record<string, string>))
        : undefined;
      fetchCalls.push({ url, method: init?.method, body, headers });

      if (url.includes("/features/") && url.includes("/inputs")) {
        return { ok: true, json: () => Promise.resolve({ inputs: [{ key: "targetAudience", required: true }] }) };
      }
      if (url.includes("/brands") && init?.method === "POST") {
        return { ok: true, json: () => Promise.resolve({ brandId: "SHOULD-NOT-BE-CALLED" }) };
      }
      if (url.includes("/campaigns") && init?.method === "POST") {
        return {
          ok: true,
          json: () => Promise.resolve({ campaign: { id: "campaign-1", brandIds: body?.brandIds } }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  it("forwards provided brandIds to campaign-service WITHOUT calling the brand upsert", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "No-website brand",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandIds: [BRAND_ID],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    expect(res.status).toBe(200);

    // The brandUrls->brand upsert must NOT be called on the no-website path.
    const brandUpsertCalls = fetchCalls.filter((c) => c.url.includes("/orgs/brands") && c.method === "POST");
    expect(brandUpsertCalls).toHaveLength(0);

    // campaign-service receives the provided brandIds verbatim.
    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.body?.orgId === "org_test456");
    expect(campaignCall!.body!.brandIds).toEqual([BRAND_ID]);

    // x-brand-id header is set from the provided ids.
    expect(campaignCall!.headers!["x-brand-id"]).toBe(BRAND_ID);

    // brandUrls / brandIds do not leak into the campaign-service body beyond the resolved brandIds field.
    expect(campaignCall!.body!.brandUrls).toBeUndefined();
  });

  it("rejects when NEITHER brandUrls nor brandIds is provided", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "No brand identity",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });
    expect(res.status).toBe(400);
  });

  it("rejects when BOTH brandUrls and brandIds are provided (exactly one)", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Ambiguous",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com"],
        brandIds: [BRAND_ID],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });
    expect(res.status).toBe(400);
  });
});
