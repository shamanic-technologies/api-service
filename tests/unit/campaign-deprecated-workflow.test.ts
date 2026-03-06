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
  workflowName: "sales-email-cold-outreach-pharaoh",
  brandUrl: "https://example.com",
  targetAudience: "CTOs at SaaS startups",
  targetOutcome: "Book demos",
  valueForTarget: "Enterprise analytics at startup pricing",
  urgency: "Limited time offer",
  scarcity: "10 spots only",
  riskReversal: "14-day free trial",
  socialProof: "Used by 100+ companies",
};

const activeWorkflow = {
  id: "wf-active-1",
  name: "sales-email-cold-outreach-pharaoh",
  status: "active",
  upgradedTo: null,
};

const deprecatedWorkflow = {
  id: "wf-deprecated-1",
  name: "sales-email-cold-outreach-pharaoh",
  status: "deprecated",
  upgradedTo: "wf-active-2",
};

const replacementWorkflow = {
  id: "wf-active-2",
  name: "sales-email-cold-outreach-solstice",
  status: "active",
  upgradedTo: null,
};

describe("POST /v1/campaigns — deprecated workflow resolution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through when workflow is active", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/workflows?status=all")) {
        return { ok: true, json: () => Promise.resolve({ workflows: [activeWorkflow] }) };
      }
      if (url.includes("/brands")) {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      }
      if (url.includes("/campaigns")) {
        return { ok: true, json: () => Promise.resolve({ campaign: { id: "camp-1", status: "ongoing" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(200);

    // Check campaign-service was called with original workflow name
    const campaignCall = (global.fetch as any).mock.calls.find(
      (c: any) => c[0].includes("/campaigns") && c[1]?.method === "POST",
    );
    const body = JSON.parse(campaignCall[1].body);
    expect(body.workflowName).toBe("sales-email-cold-outreach-pharaoh");
  });

  it("auto-resolves deprecated workflow to its active replacement", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/workflows?status=all")) {
        return {
          ok: true,
          json: () => Promise.resolve({ workflows: [deprecatedWorkflow, replacementWorkflow] }),
        };
      }
      if (url.includes("/brands")) {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      }
      if (url.includes("/campaigns")) {
        return { ok: true, json: () => Promise.resolve({ campaign: { id: "camp-1", status: "ongoing" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(200);

    // Campaign-service should receive the resolved (active) workflow name
    const campaignCall = (global.fetch as any).mock.calls.find(
      (c: any) => c[0].includes("/campaigns") && c[1]?.method === "POST",
    );
    const body = JSON.parse(campaignCall[1].body);
    expect(body.workflowName).toBe("sales-email-cold-outreach-solstice");
  });

  it("returns 404 when workflow name does not exist", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/workflows?status=all")) {
        return { ok: true, json: () => Promise.resolve({ workflows: [] }) };
      }
      if (url.includes("/brands")) {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 410 when workflow is deprecated with no replacement", async () => {
    const deadEnd = { ...deprecatedWorkflow, upgradedTo: null };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/workflows?status=all")) {
        return { ok: true, json: () => Promise.resolve({ workflows: [deadEnd] }) };
      }
      if (url.includes("/brands")) {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/deprecated/i);
  });

  it("follows multi-hop upgrade chain to active workflow", async () => {
    const v1 = { id: "wf-v1", name: "sales-email-cold-outreach-pharaoh", status: "deprecated", upgradedTo: "wf-v2" };
    const v2 = { id: "wf-v2", name: "sales-email-cold-outreach-interim", status: "deprecated", upgradedTo: "wf-v3" };
    const v3 = { id: "wf-v3", name: "sales-email-cold-outreach-solstice", status: "active", upgradedTo: null };

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/workflows?status=all")) {
        return { ok: true, json: () => Promise.resolve({ workflows: [v1, v2, v3] }) };
      }
      if (url.includes("/brands")) {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      }
      if (url.includes("/campaigns")) {
        return { ok: true, json: () => Promise.resolve({ campaign: { id: "camp-1", status: "ongoing" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(200);

    const campaignCall = (global.fetch as any).mock.calls.find(
      (c: any) => c[0].includes("/campaigns") && c[1]?.method === "POST",
    );
    const body = JSON.parse(campaignCall[1].body);
    expect(body.workflowName).toBe("sales-email-cold-outreach-solstice");
  });
});
