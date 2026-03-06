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

describe("Campaign duplicate name handling (409 Conflict)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /v1/campaigns should return 409 when campaign name already exists", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/workflows?status=all")) {
        return { ok: true, json: () => Promise.resolve({ workflows: [{ id: "wf-1", name: "sales-email-cold-outreach-v1", status: "active", upgradedTo: null }] }) };
      }
      if (url.includes("/brands")) {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      }
      if (url.includes("/campaigns")) {
        return {
          ok: false,
          status: 409,
          text: () => Promise.resolve(JSON.stringify({
            error: "A campaign with this name already exists in your organization",
          })),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already exists");
  });

  it("PATCH /v1/campaigns/:id should return 409 when campaign name already exists", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/campaigns/")) {
        return {
          ok: false,
          status: 409,
          text: () => Promise.resolve(JSON.stringify({
            error: "A campaign with this name already exists in your organization",
          })),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app)
      .patch("/v1/campaigns/camp-123")
      .send({ name: "Duplicate Name" });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already exists");
  });
});
