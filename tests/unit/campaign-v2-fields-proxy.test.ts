import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Campaign v2 — per-campaign configuration fields proxy.
 *
 * campaign-service owns four per-campaign fields (goal, audienceIds,
 * servicesOffered, clickDestinationUrl). This suite asserts the gateway is a
 * faithful passthrough for them in BOTH directions:
 *   - POST create + PATCH update forward the four fields to campaign-service.
 *   - GET single + GET list return them byte-identical from campaign-service.
 * Additive: a campaign that sets none of the four behaves exactly as before.
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

// The four campaign v2 fields, populated.
const V2_FIELDS = {
  goal: "signup" as const,
  audienceIds: ["aud-1", "aud-2"],
  servicesOffered: ["seo", "ppc"],
  clickDestinationUrl: "https://acme.com/pricing",
};

describe("Campaign v2 per-campaign config fields proxy", () => {
  let fetchCalls: Array<{ url: string; method?: string; body?: Record<string, unknown> }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });

      if (url.includes("/features/") && url.includes("/inputs")) {
        return { ok: true, json: () => Promise.resolve({ inputs: [{ key: "targetAudience", required: true }] }) };
      }
      if (url.includes("/brands") && init?.method === "POST") {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand-acme-com" }) };
      }
      // campaign-service echoes the four fields back on the created/returned campaign
      if (url.includes("/campaigns")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            campaign: {
              id: "campaign-1",
              orgId: "org_test456",
              name: body?.name ?? "Existing",
              brandIds: body?.brandIds ?? ["brand-acme-com"],
              status: "ongoing",
              goal: body?.goal ?? V2_FIELDS.goal,
              audienceIds: body?.audienceIds ?? V2_FIELDS.audienceIds,
              servicesOffered: body?.servicesOffered ?? V2_FIELDS.servicesOffered,
              clickDestinationUrl: body?.clickDestinationUrl ?? V2_FIELDS.clickDestinationUrl,
            },
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  it("POST create forwards the four fields to campaign-service", async () => {
    const res = await request(createApp())
      .post("/v1/campaigns")
      .send({
        name: "V2 Create",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com"],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
        ...V2_FIELDS,
      });

    expect(res.status).toBe(200);
    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.method === "POST");
    expect(campaignCall!.body!.goal).toBe(V2_FIELDS.goal);
    expect(campaignCall!.body!.audienceIds).toEqual(V2_FIELDS.audienceIds);
    expect(campaignCall!.body!.servicesOffered).toEqual(V2_FIELDS.servicesOffered);
    expect(campaignCall!.body!.clickDestinationUrl).toBe(V2_FIELDS.clickDestinationUrl);
  });

  it("POST create returns the four fields from campaign-service", async () => {
    const res = await request(createApp())
      .post("/v1/campaigns")
      .send({
        name: "V2 Create",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com"],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
        ...V2_FIELDS,
      });

    expect(res.body.campaign).toMatchObject(V2_FIELDS);
  });

  it("POST create still works when the four fields are absent (additive)", async () => {
    const res = await request(createApp())
      .post("/v1/campaigns")
      .send({
        name: "No V2",
        workflowDynastySlug: "sales-email-cold-outreach-sienna",
        brandUrls: ["https://acme.com"],
        featureDynastySlug: "pr-cold-email-outreach",
        featureInputs: { targetAudience: "SaaS founders" },
      });

    expect(res.status).toBe(200);
    const campaignCall = fetchCalls.find((c) => c.url.includes("/campaigns") && c.method === "POST");
    expect(campaignCall!.body!.goal).toBeUndefined();
    expect(campaignCall!.body!.audienceIds).toBeUndefined();
    expect(campaignCall!.body!.servicesOffered).toBeUndefined();
    expect(campaignCall!.body!.clickDestinationUrl).toBeUndefined();
  });

  it("PATCH update forwards the four fields to campaign-service", async () => {
    const res = await request(createApp())
      .patch("/v1/campaigns/campaign-1")
      .send({ ...V2_FIELDS });

    expect(res.status).toBe(200);
    const patchCall = fetchCalls.find((c) => c.url.includes("/campaigns/campaign-1") && c.method === "PATCH");
    expect(patchCall!.body!.goal).toBe(V2_FIELDS.goal);
    expect(patchCall!.body!.audienceIds).toEqual(V2_FIELDS.audienceIds);
    expect(patchCall!.body!.servicesOffered).toEqual(V2_FIELDS.servicesOffered);
    expect(patchCall!.body!.clickDestinationUrl).toBe(V2_FIELDS.clickDestinationUrl);
  });

  it("PATCH update returns the four fields from campaign-service", async () => {
    const res = await request(createApp())
      .patch("/v1/campaigns/campaign-1")
      .send({ ...V2_FIELDS });

    expect(res.body.campaign).toMatchObject(V2_FIELDS);
  });

  it("GET single campaign returns the four fields byte-identical", async () => {
    const res = await request(createApp()).get("/v1/campaigns/campaign-1");

    expect(res.status).toBe(200);
    expect(res.body.campaign).toMatchObject(V2_FIELDS);
  });

  it("GET list campaigns forwards the four fields through byte-identical", async () => {
    // list endpoint pure-passes the campaign-service body; assert nothing strips the fields.
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/campaigns")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            campaigns: [{ id: "campaign-1", ...V2_FIELDS }, { id: "campaign-2", goal: null, audienceIds: null, servicesOffered: null, clickDestinationUrl: null }],
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const res = await request(createApp()).get("/v1/campaigns");

    expect(res.status).toBe(200);
    expect(res.body.campaigns[0]).toMatchObject(V2_FIELDS);
    // A campaign with none of the four set round-trips as nulls (additive, unchanged behavior).
    expect(res.body.campaigns[1]).toMatchObject({ goal: null, audienceIds: null, servicesOffered: null, clickDestinationUrl: null });
  });
});
