import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/campaigns — the request body is a passthrough.
 *
 * campaign-service owns the create contract. A sales-outreach campaign must state the
 * sales funnel it sells (`funnelKey`) or campaign-service 400s: the funnel is what the
 * campaign is paced and priced on, and nothing infers one from a goal any more.
 *
 * The gateway used to validate the body against a WHITELIST and forward only the fields
 * it re-declared, so a funnel the dashboard sent was silently dropped and campaign-service
 * saw a create with no funnel — every sales campaign creation through the gateway 400'd.
 * These tests pin the passthrough: whatever campaign-service accepts reaches it unchanged,
 * the gateway invents no funnel when the caller states none, and campaign-service's own
 * rejection comes back to the caller field-for-field.
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

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignRouter);
  return app;
}

const BASE_BODY = {
  name: "Sales Outreach",
  workflowDynastySlug: "sales-email-cold-outreach-sienna",
  brandUrls: ["https://acme.com"],
  featureDynastySlug: "pr-cold-email-outreach",
  featureInputs: { targetAudience: "SaaS founders" },
};

describe("POST /v1/campaigns request-body passthrough", () => {
  let fetchCalls: Array<{ url: string; method?: string; body?: Record<string, unknown> }>;
  /** What campaign-service answers the create with. Overridden per-test to model a 400. */
  let campaignCreateResponse: () => { ok: boolean; status?: number; json: () => Promise<unknown>; text?: () => Promise<string> };

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    campaignCreateResponse = () => ({
      ok: true,
      json: () => Promise.resolve({ campaign: { id: "campaign-1", status: "ongoing" } }),
    });

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });

      if (url.includes("/features/") && url.includes("/inputs")) {
        return { ok: true, json: () => Promise.resolve({ inputs: [{ key: "targetAudience", required: true }] }) };
      }
      if (url.includes("/brands") && init?.method === "POST") {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-acme-com" }) };
      }
      if (url.includes("/campaigns")) return campaignCreateResponse();
      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  function createCall() {
    return fetchCalls.find((c) => c.url.includes("/campaigns") && c.method === "POST");
  }

  // The four funnels brand-service and billing-service already speak.
  for (const funnelKey of ["reply_meeting", "visit_meeting", "visit_signup", "visit_form"]) {
    it(`forwards funnelKey "${funnelKey}" to campaign-service unchanged`, async () => {
      const res = await request(createApp())
        .post("/v1/campaigns")
        .send({ ...BASE_BODY, funnelKey });

      expect(res.status).toBe(200);
      expect(createCall()!.body!.funnelKey).toBe(funnelKey);
    });
  }

  it("does not invent a funnel when the caller states none", async () => {
    const res = await request(createApp()).post("/v1/campaigns").send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(createCall()!.body).not.toHaveProperty("funnelKey");
  });

  it("does not validate the funnel vocabulary itself — an unknown key reaches campaign-service", async () => {
    // Only campaign-service knows which funnel keys exist; the gateway must not 400 first.
    await request(createApp()).post("/v1/campaigns").send({ ...BASE_BODY, funnelKey: "not_a_real_funnel" });

    expect(createCall()!.body!.funnelKey).toBe("not_a_real_funnel");
  });

  it("forwards any other field campaign-service accepts, including ones the gateway never declared", async () => {
    await request(createApp())
      .post("/v1/campaigns")
      .send({
        ...BASE_BODY,
        funnelKey: "visit_signup",
        dailyBudgetCents: 2500,
        startDate: "2026-09-01",
        notifyChannel: "email",
        notifyDestination: "ops@acme.com",
        someFieldCampaignServiceAddsNext: "rides through",
      });

    expect(createCall()!.body).toMatchObject({
      funnelKey: "visit_signup",
      dailyBudgetCents: 2500,
      startDate: "2026-09-01",
      notifyChannel: "email",
      notifyDestination: "ops@acme.com",
      someFieldCampaignServiceAddsNext: "rides through",
    });
  });

  it("does not enumerate the goal vocabulary — a goal campaign-service knows and the gateway does not still reaches it", async () => {
    await request(createApp()).post("/v1/campaigns").send({ ...BASE_BODY, goal: "salesQualifiedLead" });

    expect(createCall()!.body!.goal).toBe("salesQualifiedLead");
  });

  it("surfaces campaign-service's 400 for a sales create with no funnel, body field-for-field", async () => {
    const upstream400 = {
      error: "A sales-outreach campaign must state the sales funnel it sells",
      code: "FUNNEL_REQUIRED",
      details: { acceptedFunnelKeys: ["reply_meeting", "visit_meeting", "visit_signup", "visit_form"] },
    };
    campaignCreateResponse = () => ({
      ok: false,
      status: 400,
      json: () => Promise.resolve(upstream400),
      text: () => Promise.resolve(JSON.stringify(upstream400)),
    });

    const res = await request(createApp()).post("/v1/campaigns").send(BASE_BODY);

    expect(res.status).toBe(400);
    // Not flattened into an `error` string: every machine-readable field survives.
    expect(res.body).toEqual(upstream400);
  });

  it("leaves a non-sales create byte-identical to before", async () => {
    const res = await request(createApp())
      .post("/v1/campaigns")
      .send({
        name: "Discovery",
        workflowDynastySlug: "outlets-database-discovery-sienna",
        brandUrls: ["https://acme.com"],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
        maxBudgetTotalUsd: 500,
      });

    expect(res.status).toBe(200);
    expect(createCall()!.body).toEqual({
      name: "Discovery",
      workflowDynastySlug: "outlets-database-discovery-sienna",
      featureDynastySlug: "pr-cold-email-outreach",
      featureInputs: { targetAudience: "SaaS founders" },
      // budgets are stringified for campaign-service, as before
      maxBudgetTotalUsd: "500",
      type: "outlets-database-discovery",
      orgId: "org_test456",
      brandIds: ["brand-acme-com"],
    });
  });

  it("still 400s on its own missing required fields before calling campaign-service", async () => {
    // The gateway keeps the checks it needs for its OWN work (brand upsert, feature-input
    // validation) — passthrough widens what it forwards, it does not drop what it requires.
    const res = await request(createApp())
      .post("/v1/campaigns")
      .send({ name: "No workflow", brandUrls: ["https://acme.com"], featureInputs: {} });

    expect(res.status).toBe(400);
    expect(createCall()).toBeUndefined();
  });
});
