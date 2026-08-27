import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { CAMPAIGN_BASE } = vi.hoisted(() => {
  const CAMPAIGN_BASE = "http://campaign.test.local";
  process.env.CAMPAIGN_SERVICE_URL = CAMPAIGN_BASE;
  process.env.CAMPAIGN_SERVICE_API_KEY = "campaign-test-key";
  return { CAMPAIGN_BASE };
});

/**
 * GET /v1/brands/:brandId/spendable-budget — behavioural cover for the proxy.
 *
 * A source-substring test cannot see what goes over the wire, and the two things that
 * matter on an org-scoped proxy are exactly that: the org reaching campaign-service is
 * the AUTHENTICATED one (a caller-supplied header must not name someone else's brand),
 * and the upstream body comes back untouched. Per CLAUDE.md #6/#8 the assertions are the
 * forwarded path + the byte-identical body, never campaign-service's field names — the
 * payload below is a fixture, not a contract this repo owns.
 */

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

import brandSpendableBudgetRouter from "../../src/routes/brand-spendable-budget.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandSpendableBudgetRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";

// A brand funding two funnels, one of whose campaigns is stopped — the shape of the
// real production case this proxy exists to surface.
const UPSTREAM_BODY = {
  orgId: "b645207b-d8e9-40b0-9391-072b777cd9a9",
  brandId: BRAND_ID,
  grain: "offer",
  configuredDailyBudgetCents: 6000,
  runningDailyBudgetCents: 5000,
  offers: [
    {
      offerId: "d5ecba00-783a-4939-b5bd-f85b9e6b7d9e",
      configuredDailyBudgetCents: 5000,
      runningDailyBudgetCents: 5000,
      campaignIds: ["4a2f4a2f-4a2f-4a2f-4a2f-4a2f4a2f4a2f"],
    },
  ],
  campaigns: [
    {
      campaignId: "4a2f4a2f-4a2f-4a2f-4a2f-4a2f4a2f4a2f",
      status: "ongoing",
      running: true,
      funnelKey: "sales_meetings_from_conversation",
      featureSlug: "sales-cold-email-outreach",
      offerId: "d5ecba00-783a-4939-b5bd-f85b9e6b7d9e",
      configuredDailyBudgetCents: 5000,
      runningDailyBudgetCents: 5000,
    },
    {
      campaignId: "5b3f5b3f-5b3f-5b3f-5b3f-5b3f5b3f5b3f",
      status: "stopped",
      running: false,
      funnelKey: "sales_meetings_from_conversation",
      featureSlug: "feedback-request-cold-email-outreach",
      offerId: null,
      configuredDailyBudgetCents: 1000,
      runningDailyBudgetCents: 0,
    },
  ],
  rows: [
    {
      funnelKey: "sales_meetings_from_conversation",
      featureSlug: "sales-cold-email-outreach",
      offerId: "d5ecba00-783a-4939-b5bd-f85b9e6b7d9e",
      resolvedOfferId: "d5ecba00-783a-4939-b5bd-f85b9e6b7d9e",
      dailyBudgetCents: 5000,
      running: true,
      campaignId: "4a2f4a2f-4a2f-4a2f-4a2f-4a2f4a2f4a2f",
      campaignStatus: "ongoing",
    },
  ],
};

let captured: { url: string; init: any } | null = null;

describe("GET /v1/brands/:brandId/spendable-budget — behaviour", () => {
  beforeEach(() => {
    captured = null;
    global.fetch = vi.fn().mockImplementation(async (url: any, init: any) => {
      captured = { url: String(url), init };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => UPSTREAM_BODY,
        text: async () => JSON.stringify(UPSTREAM_BODY),
      };
    });
  });

  it("forwards to campaign-service on the downstream path", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/spendable-budget`);
    expect(res.status).toBe(200);
    expect(captured?.url).toBe(`${CAMPAIGN_BASE}/brands/${BRAND_ID}/spendable-budget`);
  });

  it("sends the AUTHENTICATED org, not one the caller named", async () => {
    await request(buildApp())
      .get(`/v1/brands/${BRAND_ID}/spendable-budget`)
      .set("x-org-id", "org_someone_else");

    const headers = captured?.init?.headers ?? {};
    const orgHeader = headers["x-org-id"] ?? headers["X-Org-Id"];
    expect(orgHeader).toBe("org_test456");
    expect(orgHeader).not.toBe("org_someone_else");
  });

  it("returns the upstream body byte-identical", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/spendable-budget`);
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("forwards an upstream failure instead of masking it", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 502,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "billing-service unavailable" }),
      text: async () => JSON.stringify({ error: "billing-service unavailable" }),
    }));

    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/spendable-budget`);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("billing-service unavailable");
  });
});
