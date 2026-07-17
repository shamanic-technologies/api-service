import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the bases must be set BEFORE the routers import. vi.hoisted runs before imports.
const { CAMPAIGN_BASE, FEATURES_BASE } = vi.hoisted(() => {
  const CAMPAIGN_BASE = "http://campaign.test.local";
  const FEATURES_BASE = "http://features.test.local";
  process.env.CAMPAIGN_SERVICE_URL = CAMPAIGN_BASE;
  process.env.CAMPAIGN_SERVICE_API_KEY = "campaign-test-key";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { CAMPAIGN_BASE, FEATURES_BASE };
});

/**
 * Dashboard v2 per-campaign budget + per-campaign audience stats.
 *
 * Two transparent proxies (CLAUDE.md rules #1/#4/#6/#8 — assert the downstream path +
 * byte-identical body/query forwarding, NOT the downstream response shape):
 *
 *  #2  PATCH /v1/brands/:brandId/campaigns/daily-budget  → campaign-service
 *        PATCH /brands/:brandId/daily-budget   (set every sales campaign's daily budget at once).
 *        Distinct gateway path from PATCH /v1/brands/:brandId/daily-budget (billing brand cap).
 *  #3  GET /v1/features/:slug/audience-stats?campaignId=  → features-service, campaignId forwarded.
 *
 * (#1 — single-campaign budget — is already served by PATCH /v1/campaigns/:id forwarding
 *  maxBudgetDailyUsd; unchanged, covered elsewhere.)
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "user_key";
    next();
  },
  authenticatePlatform: (_req: any, _res: any, next: any) => next(),
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  requireStaff: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import campaignsRouter from "../../src/routes/campaigns.js";
import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignsRouter);
  app.use("/v1", featuresRouter);
  return app;
}

describe("per-campaign budget + audience-stats proxies", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
    });
  });

  // ── #2 set all of a brand's campaigns' daily budget ──────────────────────────
  it("PATCH /v1/brands/:brandId/campaigns/daily-budget → campaign-service /brands/:brandId/daily-budget, body verbatim", async () => {
    const body = { dailyBudgetCents: 5000 };
    const res = await request(buildApp())
      .patch("/v1/brands/brand-uuid-1/campaigns/daily-budget")
      .send(body);
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${CAMPAIGN_BASE}/brands/brand-uuid-1/daily-budget`);
    expect(call.options.method).toBe("PATCH");
    expect(JSON.parse(call.options.body)).toEqual(body);
    expect(call.options.headers["X-API-Key"]).toBe("campaign-test-key");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("PATCH /v1/brands/:brandId/campaigns/daily-budget forwards null (clear) verbatim", async () => {
    const body = { dailyBudgetCents: null };
    const res = await request(buildApp())
      .patch("/v1/brands/brand-uuid-2/campaigns/daily-budget")
      .send(body);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${CAMPAIGN_BASE}/brands/brand-uuid-2/daily-budget`);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it("returns campaign-service body verbatim (no shape assertion / transform)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ brandId: "brand-uuid-1", orgId: "org_test456", dailyBudgetCents: 5000, updatedCount: 2 }),
    });
    const res = await request(buildApp())
      .patch("/v1/brands/brand-uuid-1/campaigns/daily-budget")
      .send({ dailyBudgetCents: 5000 });
    expect(res.body).toEqual({ brandId: "brand-uuid-1", orgId: "org_test456", dailyBudgetCents: 5000, updatedCount: 2 });
  });

  it("does NOT collide with billing PATCH /v1/brands/:brandId/daily-budget (different path)", async () => {
    // The campaigns router must only answer the /campaigns/daily-budget sub-path, never the
    // 3-segment billing path — Express should not match this route for the shorter path.
    const res = await request(buildApp())
      .patch("/v1/brands/brand-uuid-1/daily-budget")
      .send({ dailyBudgetCents: 5000 });
    // No campaigns-router handler for that path → 404 here (billing router, not mounted in this
    // test app, owns it in prod). The key assertion: campaign-service was NOT called.
    expect(res.status).toBe(404);
    expect(calls.length).toBe(0);
  });

  // ── #3 audience stats scoped to a single campaign ────────────────────────────
  it("GET /v1/features/:slug/audience-stats forwards campaignId scope", async () => {
    const res = await request(buildApp()).get(
      "/v1/features/sales-cold-email-outreach/audience-stats?brandId=b1&goal=websiteVisit&campaignId=camp-1",
    );
    expect(res.status).toBe(200);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/features/sales-cold-email-outreach/audience-stats");
    expect(url.searchParams.get("brandId")).toBe("b1");
    expect(url.searchParams.get("goal")).toBe("websiteVisit");
    expect(url.searchParams.get("campaignId")).toBe("camp-1");
  });

  it("GET /v1/features/:slug/audience-stats without campaignId is unchanged (no campaignId param)", async () => {
    const res = await request(buildApp()).get(
      "/v1/features/sales-cold-email-outreach/audience-stats?brandId=b1&goal=signup",
    );
    expect(res.status).toBe(200);
    const url = new URL(calls[0].url);
    expect(url.searchParams.has("campaignId")).toBe(false);
  });
});
