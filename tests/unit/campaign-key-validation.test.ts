import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Configurable auth context — keySource resolved in middleware
let mockKeySource: string | undefined = "org";

// Mock auth middleware
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.appId = "distribute";
    req.authType = "user_key";
    req.keySource = mockKeySource;
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
  createRun: vi.fn().mockResolvedValue({ id: "parent-run-123" }),
  updateRun: vi.fn().mockResolvedValue({ id: "parent-run-123", status: "failed" }),
}));

// Mock billing module
const mockFetchKeySource = vi.fn().mockResolvedValue("org");
vi.mock("../../src/lib/billing.js", () => ({
  fetchKeySource: (...args: unknown[]) => mockFetchKeySource(...args),
}));

import campaignRouter from "../../src/routes/campaigns.js";
import { updateRun } from "@distribute/runs-client";

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
// Pre-campaign key validation on POST /v1/campaigns
// ---------------------------------------------------------------------------
describe("POST /v1/campaigns — pre-campaign org key validation", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockKeySource = "org";
  });

  it("should return 400 with missing_keys when org lacks required providers", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      // Brand upsert
      if (url.includes("/brands")) {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      }
      // Workflow list (resolve by name)
      if (url.includes("/workflows?name=")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              workflows: [{ id: "wf-1", name: "sales-email-cold-outreach-v1" }],
            }),
        };
      }
      // Required providers
      if (url.includes("/required-providers")) {
        return {
          ok: true,
          json: () => Promise.resolve({ providers: ["apollo", "anthropic", "instantly"] }),
        };
      }
      // Org keys — only apollo and anthropic configured
      if (url.includes("/keys?")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              keys: [
                { provider: "apollo", maskedKey: "apol...123" },
                { provider: "anthropic", maskedKey: "sk-...abc" },
              ],
            }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_keys");
    expect(res.body.missing).toEqual(["instantly"]);
    expect(res.body.configured).toEqual(["apollo", "anthropic"]);
    expect(res.body.message).toContain("missing required API keys");
  });

  it("should mark parent run as failed when keys are missing", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/brands")) return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      if (url.includes("/workflows?name=")) {
        return { ok: true, json: () => Promise.resolve({ workflows: [{ id: "wf-1", name: "sales-email-cold-outreach-v1" }] }) };
      }
      if (url.includes("/required-providers")) {
        return { ok: true, json: () => Promise.resolve({ providers: ["instantly"] }) };
      }
      if (url.includes("/keys?")) {
        return { ok: true, json: () => Promise.resolve({ keys: [] }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
    await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(updateRun).toHaveBeenCalledWith("parent-run-123", "failed");
  });

  it("should pass through when all required keys are configured", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/brands")) return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      if (url.includes("/workflows?name=")) {
        return { ok: true, json: () => Promise.resolve({ workflows: [{ id: "wf-1", name: "sales-email-cold-outreach-v1" }] }) };
      }
      if (url.includes("/required-providers")) {
        return { ok: true, json: () => Promise.resolve({ providers: ["apollo", "anthropic"] }) };
      }
      if (url.includes("/keys?")) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              keys: [
                { provider: "apollo", maskedKey: "apol...123" },
                { provider: "anthropic", maskedKey: "sk-...abc" },
              ],
            }),
        };
      }
      // Campaign creation succeeds
      if (url.includes("/campaigns") && !url.includes("/keys") && !url.includes("/workflows")) {
        return { ok: true, json: () => Promise.resolve({ campaign: { id: "camp-1", status: "ongoing" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(200);
    expect(res.body.campaign).toBeDefined();
  });

  it("should skip validation when keySource is platform (not org)", async () => {
    mockKeySource = "platform";

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/brands")) return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      // Campaign creation succeeds
      if (url.includes("/campaigns") && !url.includes("/workflows")) {
        return { ok: true, json: () => Promise.resolve({ campaign: { id: "camp-1", status: "ongoing" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(200);
    // Should not call workflow required-providers or key-service when platform
    const calls = (global.fetch as any).mock.calls.map((c: any) => c[0]);
    expect(calls.some((u: string) => u.includes("/required-providers"))).toBe(false);
    expect(calls.some((u: string) => u.includes("/keys?keySource=org"))).toBe(false);
  });

  it("should skip validation when workflow has no required providers", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/brands")) return { ok: true, json: () => Promise.resolve({ brandId: "brand-123" }) };
      if (url.includes("/workflows?name=")) {
        return { ok: true, json: () => Promise.resolve({ workflows: [{ id: "wf-1", name: "sales-email-cold-outreach-v1" }] }) };
      }
      if (url.includes("/required-providers")) {
        return { ok: true, json: () => Promise.resolve({ providers: [] }) };
      }
      if (url.includes("/keys?")) {
        return { ok: true, json: () => Promise.resolve({ keys: [] }) };
      }
      if (url.includes("/campaigns") && !url.includes("/workflows") && !url.includes("/keys")) {
        return { ok: true, json: () => Promise.resolve({ campaign: { id: "camp-1", status: "ongoing" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
    const res = await request(app).post("/v1/campaigns").send(validCampaignBody);

    expect(res.status).toBe(200);
  });
});
