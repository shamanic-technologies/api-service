import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression: brand-service PR #50 requires x-run-id on all endpoints.
 * api-service must send x-run-id (alongside x-org-id and x-user-id) in every
 * callExternalService / streamExternalService call to brand-service.
 *
 * Bug fixed: campaigns.ts POST /brands (brand upsert during campaign creation)
 * was calling callExternalService without buildInternalHeaders(req), so
 * x-org-id, x-user-id, and x-run-id were never sent — brand-service returned 400.
 */

// ── Source-level checks ─────────────────────────────────────────────────────

describe("all brand-service calls include internal headers", () => {
  it("brand.ts: every callExternalService(externalServices.brand, …) passes buildInternalHeaders", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/routes/brand.ts"),
      "utf-8"
    );

    const regex = /callExternalService[^(]*\(\s*externalServices\.brand\b/g;
    let match: RegExpExecArray | null;
    const matches: number[] = [];
    while ((match = regex.exec(src)) !== null) {
      matches.push(match.index);
    }

    expect(matches.length).toBeGreaterThan(0);

    for (const idx of matches) {
      const callBlock = src.slice(idx, idx + 400);
      expect(callBlock).toContain("buildInternalHeaders");
    }
  });

  it("campaigns.ts: POST /brands upsert passes buildInternalHeaders", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/routes/campaigns.ts"),
      "utf-8"
    );

    const regex = /callExternalService[^(]*\(\s*externalServices\.brand\b/g;
    let match: RegExpExecArray | null;
    const matches: number[] = [];
    while ((match = regex.exec(src)) !== null) {
      matches.push(match.index);
    }

    expect(matches.length).toBeGreaterThan(0);

    for (const idx of matches) {
      const callBlock = src.slice(idx, idx + 400);
      expect(callBlock).toContain("buildInternalHeaders");
    }
  });

  it("performance.ts: leaderboard passes buildInternalHeaders(req) to brand-service calls", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/routes/performance.ts"),
      "utf-8"
    );

    // The route handler builds headers from the request and threads them through
    // buildLeaderboardData → fetchAllBrands → callExternalService(brand, …, { headers })
    // and enrichWithDeliveryStats → all downstream service calls.
    expect(src).toContain("buildInternalHeaders(req)");
    expect(src).toContain("buildLeaderboardData(headers)");
    expect(src).toContain("enrichWithDeliveryStats(data, orgIds, headers, brandOrgMap)");
  });
});

// ── Functional test: campaign brand upsert sends x-run-id ───────────────────

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
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

import campaignsRouter from "../../src/routes/campaigns.js";

describe("campaign brand upsert sends internal headers", () => {
  interface FetchCall {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
  }

  let fetchCalls: FetchCall[];

  beforeEach(() => {
    fetchCalls = [];
    vi.restoreAllMocks();

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url: url as string, method: init?.method || "GET", headers, body });

      // Brand upsert response
      if (typeof url === "string" && url.includes("/brands") && init?.method === "POST") {
        return { ok: true, json: () => Promise.resolve({ brandId: "brand_abc" }) };
      }
      // Campaign creation response
      if (typeof url === "string" && url.includes("/campaigns") && init?.method === "POST") {
        return {
          ok: true,
          json: () => Promise.resolve({
            campaign: { id: "campaign_123", brandId: "brand_abc", name: "Test", status: "ongoing" },
          }),
        };
      }
      // Lifecycle email (fire-and-forget)
      if (typeof url === "string" && url.includes("/send")) {
        return { ok: true, json: () => Promise.resolve({}) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  it("POST /v1/campaigns should send x-org-id, x-user-id, and x-run-id on brand upsert", async () => {
    const app = express();
    app.use(express.json());
    app.use("/v1", campaignsRouter);

    await request(app)
      .post("/v1/campaigns")
      .send({
        name: "Test Campaign",
        workflowName: "sales-email-cold-outreach-sienna",
        brandUrl: "https://example.com",
        targetAudience: "CTOs at SaaS startups with 10-50 employees in the US",
        targetOutcome: "Book sales demos",
        valueForTarget: "Access to enterprise analytics at startup pricing",
        urgency: "Recruitment closes in 30 days",
        scarcity: "Only 10 spots available worldwide",
        riskReversal: "Free trial for 2 weeks, no commitment",
        socialProof: "Backed by 60 sponsors including Acme, Globex",
      });

    // Find the brand upsert call (POST to brand-service /brands, not campaign-service)
    const brandCall = fetchCalls.find(
      (c) => c.method === "POST" && c.body?.url === "https://example.com" && c.body?.orgId === "org_test456"
    );

    expect(brandCall).toBeDefined();
    expect(brandCall!.headers["x-org-id"]).toBe("org_test456");
    expect(brandCall!.headers["x-user-id"]).toBe("user_test123");
    expect(brandCall!.headers["x-run-id"]).toBe("run_test789");
  });
});
