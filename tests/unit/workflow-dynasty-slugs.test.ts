import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Tests that dynasty slug query params are forwarded to workflow-service
 * on GET /workflows, GET /workflow-runs, GET /public/workflows/ranked,
 * and GET /public/workflows/best.
 */

let fetchCalls: Array<{ url: string; method?: string }> = [];

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

import workflowsRoutes from "../../src/routes/workflows.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", workflowsRoutes);
  return app;
}

beforeEach(() => {
  vi.restoreAllMocks();
  fetchCalls = [];

  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, method: init?.method });
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ workflows: [], workflowRuns: [] }),
    };
  });
});

describe("Workflow dynasty slug forwarding", () => {
  // -----------------------------------------------------------------------
  // GET /v1/workflows
  // -----------------------------------------------------------------------

  it("should forward featureDynastySlug to workflow-service on GET /workflows", async () => {
    const app = createApp();
    await request(app)
      .get("/v1/workflows")
      .query({ featureDynastySlug: "pr-cold-email-outreach" });

    const call = fetchCalls.find((c) => c.url.includes("/workflows"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("featureDynastySlug=pr-cold-email-outreach");
  });

  it("should forward workflowDynastySlug to workflow-service on GET /workflows", async () => {
    const app = createApp();
    await request(app)
      .get("/v1/workflows")
      .query({ workflowDynastySlug: "sales-email-cold-outreach-sienna" });

    const call = fetchCalls.find((c) => c.url.includes("/workflows"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("workflowDynastySlug=sales-email-cold-outreach-sienna");
  });

  it("should forward both dynasty and versioned slug params on GET /workflows", async () => {
    const app = createApp();
    await request(app)
      .get("/v1/workflows")
      .query({
        featureSlug: "pr-cold-email-outreach-v2",
        featureDynastySlug: "pr-cold-email-outreach",
        workflowSlug: "sales-email-cold-outreach-sienna-v3",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
      });

    const call = fetchCalls.find((c) => c.url.includes("/workflows"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("featureSlug=pr-cold-email-outreach-v2");
    expect(call!.url).toContain("featureDynastySlug=pr-cold-email-outreach");
    expect(call!.url).toContain("workflowSlug=sales-email-cold-outreach-sienna-v3");
    expect(call!.url).toContain("workflowDynastySlug=sales-email-cold-outreach-sienna");
  });

  // -----------------------------------------------------------------------
  // GET /v1/workflow-runs
  // -----------------------------------------------------------------------

  it("should forward featureDynastySlug to workflow-service on GET /workflow-runs", async () => {
    const app = createApp();
    await request(app)
      .get("/v1/workflow-runs")
      .query({ featureDynastySlug: "pr-cold-email-outreach" });

    const call = fetchCalls.find((c) => c.url.includes("/workflow-runs"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("featureDynastySlug=pr-cold-email-outreach");
  });

  it("should forward workflowDynastySlug to workflow-service on GET /workflow-runs", async () => {
    const app = createApp();
    await request(app)
      .get("/v1/workflow-runs")
      .query({ workflowDynastySlug: "sales-email-cold-outreach-sienna" });

    const call = fetchCalls.find((c) => c.url.includes("/workflow-runs"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("workflowDynastySlug=sales-email-cold-outreach-sienna");
  });

  // -----------------------------------------------------------------------
  // GET /v1/public/workflows/ranked
  // -----------------------------------------------------------------------

  it("should forward featureDynastySlug to features-service on GET /public/workflows/ranked", async () => {
    const app = createApp();
    await request(app)
      .get("/v1/public/workflows/ranked")
      .query({ featureDynastySlug: "pr-cold-email-outreach" });

    const call = fetchCalls.find((c) => c.url.includes("/public/stats/ranked"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("featureDynastySlug=pr-cold-email-outreach");
  });

  // -----------------------------------------------------------------------
  // GET /v1/public/workflows/best (proxied to features-service /public/stats/best)
  // -----------------------------------------------------------------------

  it("should forward featureDynastySlug to features-service on GET /public/workflows/best", async () => {
    const app = createApp();
    await request(app)
      .get("/v1/public/workflows/best")
      .query({ featureDynastySlug: "pr-cold-email-outreach" });

    const call = fetchCalls.find((c) => c.url.includes("/public/stats/best"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("featureDynastySlug=pr-cold-email-outreach");
  });
});
