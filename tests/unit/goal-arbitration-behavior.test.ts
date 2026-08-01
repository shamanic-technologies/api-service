import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { FEATURES_BASE };
});

/**
 * GET /v1/features/:slug/goal-arbitration — BEHAVIOURAL cover.
 *
 * Per CLAUDE.md #7 corollary 3, a source-substring test cannot see a template
 * literal's interpolated value, so it can verify neither the downstream path that
 * actually goes over the wire nor the identity carried with it. This file drives the
 * real router with supertest and a stubbed fetch.
 *
 * Three things the consumer depends on are asserted here:
 *  - `pricing` reaches features-service (a dropped param silently returns gross).
 *  - The "never stated a funnel set" 502 and the "stated none" 200 arrive
 *    distinguishable, status AND body intact.
 *  - The org reaching features-service is the AUTHENTICATED one, never a
 *    caller-supplied override.
 *
 * Per CLAUDE.md #6/#8 the payloads below are fixtures, not a contract this repo
 * owns — what is asserted is the forwarded URL and the byte-identical body.
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

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const BRAND_ID = "8a7c4f2e-1d3b-4a5c-9e6f-0b1c2d3e4f5a";

// A brand whose declared funnels elect one goal, with the losing candidate kept.
const RESOLVED_BODY = {
  featureSlug: "sales-cold-email-outreach",
  authorizedGoals: ["meetingBooked", "websiteVisit"],
  arbitration: {
    status: "resolved",
    goal: "meetingBooked",
    objective: "meeting-booked",
    reason: null,
    returnPerDollar: 3.4,
    costPerOutcomeUsd: 61.73,
    costPerPaidClientUsd: 588.1,
    grain: "brand",
  },
  workflow: { workflowDynastySlug: "pelican", workflowDynastyName: "Pelican" },
  economics: null,
  candidates: [],
  rows: [],
  recommendedBudgetUsd: 617.3,
};

// The brand STATED it sells through no funnel — a real answer, served 200.
const STATED_NONE_BODY = {
  featureSlug: "sales-cold-email-outreach",
  authorizedGoals: [],
  arbitration: {
    status: "unrankable",
    goal: null,
    objective: null,
    reason: "no_authorized_goals",
    returnPerDollar: null,
    costPerOutcomeUsd: null,
    costPerPaidClientUsd: null,
    grain: null,
  },
  workflow: null,
  economics: null,
  candidates: [],
  rows: [],
  recommendedBudgetUsd: null,
};

describe("GET /v1/features/:slug/goal-arbitration — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  function stubUpstream(body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(body) };
    });
  }

  beforeEach(() => {
    calls = [];
    stubUpstream(RESOLVED_BODY);
  });

  it("forwards to features-service's real path, carrying the resolved identity", async () => {
    const res = await request(buildApp()).get(
      `/v1/features/sales-cold-email-outreach/goal-arbitration?brandId=${BRAND_ID}`,
    );

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/features/sales-cold-email-outreach/goal-arbitration?brandId=${BRAND_ID}`,
    );
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
  });

  it("returns features-service's body unchanged", async () => {
    const res = await request(buildApp()).get(
      `/v1/features/sales-cold-email-outreach/goal-arbitration?brandId=${BRAND_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual(RESOLVED_BODY);
  });

  it("forwards pricing=net — the discount basis must not be dropped", async () => {
    await request(buildApp()).get(
      `/v1/features/sales-cold-email-outreach/goal-arbitration?brandId=${BRAND_ID}&pricing=net`,
    );

    const forwarded = new URL(calls[0].url).searchParams;
    expect(forwarded.get("pricing")).toBe("net");
    expect(forwarded.get("brandId")).toBe(BRAND_ID);
  });

  it("forwards a param this gateway has never heard of — no whitelist", async () => {
    await request(buildApp()).get(
      `/v1/features/sales-cold-email-outreach/goal-arbitration?brandId=${BRAND_ID}&somethingNew=42`,
    );

    expect(new URL(calls[0].url).searchParams.get("somethingNew")).toBe("42");
  });

  it("serves the 'stated it sells through none' answer as a 200 with its reason", async () => {
    stubUpstream(STATED_NONE_BODY);

    const res = await request(buildApp()).get(
      `/v1/features/sales-cold-email-outreach/goal-arbitration?brandId=${BRAND_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual(STATED_NONE_BODY);
    expect(res.body.arbitration.reason).toBe("no_authorized_goals");
  });

  it("keeps the 'never stated a set' 502 distinguishable — status and body intact", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 502,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: "brand-service reports no declared sales funnels for this brand",
              reason: "authorized_goals_unavailable",
            }),
          ),
        json: () => Promise.resolve({}),
      };
    });

    const res = await request(buildApp()).get(
      `/v1/features/sales-cold-email-outreach/goal-arbitration?brandId=${BRAND_ID}`,
    );

    // Not flattened into { error: "<the whole JSON body>" } — the consumer branches on
    // `reason` to decide whether to fall back to the stored brand goal (CLAUDE.md #7).
    expect(res.status).toBe(502);
    expect(res.body.reason).toBe("authorized_goals_unavailable");
    expect(res.body.error).toBe("brand-service reports no declared sales funnels for this brand");
  });

  it("propagates a 400 rather than collapsing it into a generic 500", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ error: "brandId is required" })),
        json: () => Promise.resolve({}),
      };
    });

    const res = await request(buildApp()).get(
      "/v1/features/sales-cold-email-outreach/goal-arbitration",
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "brandId is required" });
  });

  it("ignores a caller-supplied org — only the authenticated org reaches features-service", async () => {
    const res = await request(buildApp())
      .get(`/v1/features/sales-cold-email-outreach/goal-arbitration?brandId=${BRAND_ID}`)
      .set("x-org-id", "someone-elses-org");

    expect(res.status).toBe(200);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("encodes the feature slug into the downstream path", async () => {
    await request(buildApp()).get(
      `/v1/features/a%2Fb/goal-arbitration?brandId=${BRAND_ID}`,
    );

    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/features/a%2Fb/goal-arbitration?brandId=${BRAND_ID}`,
    );
  });
});
