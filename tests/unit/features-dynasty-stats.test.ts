/**
 * Tests for GET /v1/features/stats/dynasty.
 * Proxied to features-service GET /stats/dynasty.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallExternalService = vi.fn();

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
  callExternalServiceWithStatus: (...args: unknown[]) => mockCallExternalService(...args),
  externalServices: {
    client: { url: "http://mock-client", apiKey: "k" },
    emailgen: { url: "http://mock-emailgen", apiKey: "k" },
    emailGateway: { url: "http://mock-email-gateway", apiKey: "k" },
    campaign: { url: "http://mock-campaign", apiKey: "k" },
    lead: { url: "http://mock-lead", apiKey: "k" },
    key: { url: "http://mock-key", apiKey: "k" },
    replyQualification: { url: "http://mock-rq", apiKey: "k" },
    scraping: { url: "http://mock-scraping", apiKey: "k" },
    transactionalEmail: { url: "http://mock-transactional-email", apiKey: "k" },
    brand: { url: "http://mock-brand", apiKey: "k" },
    runs: { url: "http://mock-runs", apiKey: "k" },
    workflow: { url: "http://mock-workflow", apiKey: "k" },
    instantly: { url: "http://mock-instantly", apiKey: "k" },
    billing: { url: "http://mock-billing", apiKey: "k" },
    chat: { url: "http://mock-chat", apiKey: "k" },
    features: { url: "http://mock-features", apiKey: "k" },
  },
}));

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import express from "express";
import request from "supertest";
import featuresRouter from "../../src/routes/features.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const MOCK_DYNASTY_STATS = {
  dynastySlug: "sales-cold-email-outreach",
  systemStats: { totalCostInUsdCents: 12000, completedRuns: 45, activeCampaigns: 5, firstRunAt: "2025-11-01T00:00:00Z", lastRunAt: "2026-03-28T00:00:00Z" },
  stats: { emailsSent: 5400, repliesPositive: 216, positiveReplyRate: 0.04 },
};

describe("GET /v1/features/stats/dynasty", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proxies to features-service /stats/dynasty with all query params", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_DYNASTY_STATS);

    const res = await request(app).get(
      "/v1/features/stats/dynasty?dynastySlug=sales-cold-email-outreach&groupBy=campaignId&brandId=b-1",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_DYNASTY_STATS);

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/stats/dynasty"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("dynastySlug=sales-cold-email-outreach");
    expect(url).toContain("groupBy=campaignId");
    expect(url).toContain("brandId=b-1");
  });

  it("forwards only allowed query params", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_DYNASTY_STATS);

    await request(app).get(
      "/v1/features/stats/dynasty?dynastySlug=sales-cold-email-outreach&randomParam=bad",
    );

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/stats/dynasty"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("dynastySlug=sales-cold-email-outreach");
    expect(url).not.toContain("randomParam");
  });

  it("returns 502 when features-service is unavailable", async () => {
    const app = createApp();
    mockCallExternalService.mockRejectedValue(new Error("Connection refused"));

    const res = await request(app).get(
      "/v1/features/stats/dynasty?dynastySlug=sales-cold-email-outreach",
    );

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Connection refused");
  });
});
