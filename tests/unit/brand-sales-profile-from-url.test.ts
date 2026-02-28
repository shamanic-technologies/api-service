import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/brand/sales-profile
 * Proxy to brand-service POST /sales-profile:
 *   1. Validates request body (url required)
 *   2. Resolves keySource from billing-service
 *   3. Creates a tracking run via runs-client
 *   4. Forwards to brand-service with { url, appId, orgId, userId, keyType, parentRunId }
 *   5. Returns the sales profile response as-is
 */

// Mock auth middleware to skip real auth
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.appId = "distribute";
    req.authType = "app_key";
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
const mockCreateRun = vi.fn();
vi.mock("@distribute/runs-client", () => ({
  createRun: (...args: unknown[]) => mockCreateRun(...args),
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

// Mock billing module
const mockFetchKeySource = vi.fn();
vi.mock("../../src/lib/billing.js", () => ({
  fetchKeySource: (...args: unknown[]) => mockFetchKeySource(...args),
}));

import brandRouter from "../../src/routes/brand.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

const fakeSalesProfile = {
  cached: false,
  brandId: "brand-abc",
  runId: "run-xyz",
  profile: {
    targetAudience: "CTOs at SaaS startups",
    callToAction: "Book a demo",
    valueProposition: "Save 10 hours a week on outreach",
    urgency: { elements: ["Limited beta access"], summary: "Beta closes March 1st" },
    scarcity: { elements: ["50 spots left"], summary: "Only 50 spots available" },
    riskReversal: { guarantees: ["30-day refund"], trialInfo: "14-day free trial", refundPolicy: "Full refund" },
    socialProof: { results: ["500+ companies"], caseStudies: ["Acme Corp case study"] },
    companyOverview: "Test company",
    extractedAt: "2025-06-01T00:00:00Z",
  },
};

describe("POST /v1/brand/sales-profile", () => {
  let app: express.Express;
  let capturedBody: Record<string, unknown> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    capturedBody = undefined;

    mockFetchKeySource.mockResolvedValue("byok");
    mockCreateRun.mockResolvedValue({ id: "run-parent-001" });

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/sales-profile")) {
        capturedBody = JSON.parse(init?.body as string);
        return { ok: true, json: () => Promise.resolve(fakeSalesProfile) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });
  });

  it("should proxy to brand-service and return the sales profile", async () => {
    const res = await request(app)
      .post("/v1/brand/sales-profile")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeSalesProfile);

    // Verify keySource was resolved
    expect(mockFetchKeySource).toHaveBeenCalledWith("org_test456", "distribute");

    // Verify a tracking run was created
    expect(mockCreateRun).toHaveBeenCalledWith({
      orgId: "org_test456",
      userId: "user_test123",
      appId: "distribute",
      serviceName: "api-service",
      taskName: "sales-profile-from-url",
    });

    // Verify the body forwarded to brand-service
    expect(capturedBody).toEqual({
      url: "https://example.com",
      appId: "distribute",
      orgId: "org_test456",
      userId: "user_test123",
      keyType: "byok",
      parentRunId: "run-parent-001",
    });
  });

  it("should pass skipCache when provided", async () => {
    const res = await request(app)
      .post("/v1/brand/sales-profile")
      .send({ url: "https://example.com", skipCache: true });

    expect(res.status).toBe(200);
    expect(capturedBody?.skipCache).toBe(true);
  });

  it("should return 400 when url is missing", async () => {
    const res = await request(app)
      .post("/v1/brand/sales-profile")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("should return 400 with helpful message when Anthropic key is missing", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "No Anthropic API key found" }),
      text: () => Promise.resolve('{"error":"No Anthropic API key found"}'),
    }));

    const res = await request(app)
      .post("/v1/brand/sales-profile")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Anthropic API key not configured");
  });

  it("should return 500 when brand-service fails", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Connection refused" }),
      text: () => Promise.resolve('{"error":"Connection refused"}'),
    }));

    const res = await request(app)
      .post("/v1/brand/sales-profile")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Connection refused");
  });

  it("should return cached profile when available", async () => {
    const cachedResponse = { ...fakeSalesProfile, cached: true };
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve(cachedResponse),
    }));

    const res = await request(app)
      .post("/v1/brand/sales-profile")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.profile.targetAudience).toBe("CTOs at SaaS startups");
  });
});
