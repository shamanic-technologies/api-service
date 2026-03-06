import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock auth middleware
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.appId = "distribute";
    req.authType = "user_key";
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

// Mock runs-client (campaigns.ts only uses getRunsBatch now)
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

const validCampaignBody = {
  name: "Test Campaign",
  workflowName: "sales-email-cold-outreach-v1",
  brandUrl: "https://example.com",
  targetAudience: "CTOs at SaaS startups",
  targetOutcome: "Book demos",
  valueForTarget: "Enterprise analytics at startup pricing",
  urgency: "Limited time offer",
  scarcity: "10 spots only",
  riskReversal: "14-day free trial",
  socialProof: "Used by 100+ companies",
};

// ---------------------------------------------------------------------------
// Pre-campaign key validation removed — campaigns no longer validate keys
// at the gateway level. Downstream services handle key resolution directly.
// ---------------------------------------------------------------------------
describe("POST /v1/campaigns — no gateway-level key validation", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should forward campaign creation without calling required-providers or org keys", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/brands")) return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      if (url.includes("/campaigns") && !url.includes("/workflows")) {
        return { ok: true, json: () => Promise.resolve({ campaign: { id: "camp-1", status: "ongoing" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(200);
    expect(res.body.campaign).toBeDefined();

    // Should NOT call workflow required-providers or key-service org keys
    const calls = (global.fetch as any).mock.calls.map((c: any) => c[0]);
    expect(calls.some((u: string) => u.includes("/required-providers"))).toBe(false);
    expect(calls.some((u: string) => u.includes("/keys?keySource=org"))).toBe(false);
  });

  it("should not include keySource in campaign-service request body", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/brands")) return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      if (url.includes("/campaigns") && !url.includes("/workflows")) {
        return { ok: true, json: () => Promise.resolve({ campaign: { id: "camp-1", status: "ongoing" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
    await request(app).post("/v1/campaigns").send(validCampaignBody);

    // Find the campaign-service call and check its body
    const campaignCall = (global.fetch as any).mock.calls.find(
      (c: any) => c[0].includes("/campaigns") && !c[0].includes("/workflows") && c[1]?.method === "POST"
    );
    expect(campaignCall).toBeDefined();
    const body = JSON.parse(campaignCall[1].body);
    expect(body).not.toHaveProperty("keySource");
  });
});
