/**
 * Tests for GET /v1/campaigns/stats?brandId=X
 * Aggregates stats from 4 services using groupBy=campaignId.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCallExternalService = vi.fn();
const mockBuildInternalHeaders = vi.fn(() => ({}));

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
  callService: vi.fn(),
  externalServices: {
    emailgen: { url: "http://mock-emailgen", apiKey: "k" },
    emailGateway: { url: "http://mock-email-gw", apiKey: "k" },
    replyQualification: { url: "http://mock-rq", apiKey: "k" },
    lead: { url: "http://mock-lead", apiKey: "k" },
    campaign: { url: "http://mock-campaign", apiKey: "k" },
    key: { url: "http://mock-key", apiKey: "k" },
    scraping: { url: "http://mock-scraping", apiKey: "k" },
    transactionalEmail: { url: "http://mock-transactional-email", apiKey: "k" },
    brand: { url: "http://mock-brand", apiKey: "k" },
    runs: { url: "http://mock-runs", apiKey: "k" },
  },
  services: { client: "http://mock-client" },
}));

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => {
    _req.userId = "user1";
    _req.orgId = "org1";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

vi.mock("../../src/lib/internal-headers.js", () => ({
  buildInternalHeaders: (...args: unknown[]) => mockBuildInternalHeaders(...args),
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn(),
}));

import express from "express";
import request from "supertest";
import campaignsRouter from "../../src/routes/campaigns.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignsRouter);
  return app;
}

const EMPTY_REPLIES_DETAIL = {
  interested: 0, meetingBooked: 0, closed: 0,
  notInterested: 0, wrongPerson: 0, unsubscribe: 0,
  neutral: 0, autoReply: 0, outOfOffice: 0,
};

/** Helper: build a valid email-gateway broadcast stats object (new shape) */
function makeBroadcast(recipientOverrides: Record<string, any> = {}, emailOverrides: Record<string, any> = {}) {
  return {
    recipientStats: {
      contacted: 0, sent: 0, delivered: 0, opened: 0,
      bounced: 0, clicked: 0, unsubscribed: 0,
      repliesPositive: 0, repliesNegative: 0, repliesNeutral: 0, repliesAutoReply: 0,
      repliesDetail: EMPTY_REPLIES_DETAIL,
      ...recipientOverrides,
    },
    emailStats: {
      sent: 0, delivered: 0, opened: 0, clicked: 0,
      bounced: 0, unsubscribed: 0,
      stepStats: [],
      ...emailOverrides,
    },
  };
}

describe("GET /v1/campaigns/stats", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("should merge stats from 4 services grouped by campaignId", async () => {
    const app = createApp();

    mockCallExternalService.mockImplementation((service: any, path: string) => {
      // email-gateway
      if (service.url === "http://mock-email-gw") {
        return Promise.resolve({
          groups: [
            {
              key: "c1",
              broadcast: makeBroadcast(
                { contacted: 15, sent: 10, delivered: 9, opened: 5, clicked: 2, bounced: 1, repliesPositive: 1 },
                { sent: 10, delivered: 9, opened: 5, clicked: 2, bounced: 1 },
              ),
              transactional: null,
            },
            {
              key: "c2",
              broadcast: makeBroadcast(
                { contacted: 25, sent: 20, delivered: 18, opened: 12, clicked: 3, bounced: 2, repliesNegative: 1 },
                { sent: 20, delivered: 18, opened: 12, clicked: 3, bounced: 2 },
              ),
              transactional: null,
            },
          ],
        });
      }
      // lead-service
      if (service.url === "http://mock-lead") {
        return Promise.resolve({
          groups: [
            { key: "c1", totalLeads: 15, byOutreachStatus: { contacted: 10 }, buffered: 3, skipped: 1 },
            { key: "c2", totalLeads: 30, byOutreachStatus: { contacted: 18 }, buffered: 5, skipped: 2 },
          ],
        });
      }
      // content-generation
      if (service.url === "http://mock-emailgen") {
        return Promise.resolve({
          groups: [
            { key: "c1", stats: { emailsGenerated: 12 } },
            { key: "c2", stats: { emailsGenerated: 25 } },
          ],
        });
      }
      // runs-service
      if (service.url === "http://mock-runs") {
        return Promise.resolve({
          groups: [
            { dimensions: { campaignId: "c1" }, totalCostInUsdCents: "500", runCount: 15 },
            { dimensions: { campaignId: "c2" }, totalCostInUsdCents: "1200", runCount: 30 },
          ],
        });
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/v1/campaigns/stats?brandId=brand-1");

    expect(res.status).toBe(200);
    expect(res.body.campaigns).toHaveLength(2);

    const c1 = res.body.campaigns.find((c: any) => c.campaignId === "c1");
    const c2 = res.body.campaigns.find((c: any) => c.campaignId === "c2");

    // Verify c1
    expect(c1.leadsServed).toBe(15);
    expect(c1.leadsContacted).toBe(10);
    expect(c1.emailsGenerated).toBe(12);
    expect(c1.recipientStats.contacted).toBe(15);
    expect(c1.recipientStats.sent).toBe(10);
    expect(c1.recipientStats.opened).toBe(5);
    expect(c1.recipientStats.repliesPositive).toBe(1);
    expect(c1.emailStats.sent).toBe(10);
    expect(c1.totalCostInUsdCents).toBe("500");
    expect(c1.runCount).toBe(15);

    // Verify c2
    expect(c2.leadsServed).toBe(30);
    expect(c2.leadsContacted).toBe(18);
    expect(c2.emailsGenerated).toBe(25);
    expect(c2.recipientStats.contacted).toBe(25);
    expect(c2.recipientStats.sent).toBe(20);
    expect(c2.emailStats.sent).toBe(20);
    expect(c2.totalCostInUsdCents).toBe("1200");
  });

  it("should make exactly 4 service calls", async () => {
    const app = createApp();

    mockCallExternalService.mockResolvedValue({ groups: [] });

    await request(app).get("/v1/campaigns/stats?brandId=brand-1");

    expect(mockCallExternalService).toHaveBeenCalledTimes(4);
  });

  it("should pass brandId filter to all services", async () => {
    const app = createApp();

    mockCallExternalService.mockResolvedValue({ groups: [] });

    await request(app).get("/v1/campaigns/stats?brandId=brand-42");

    for (const call of mockCallExternalService.mock.calls) {
      const path = call[1] as string;
      expect(path).toContain("brandId=brand-42");
    }
  });

  it("should pass groupBy=campaignId to all services", async () => {
    const app = createApp();

    mockCallExternalService.mockResolvedValue({ groups: [] });

    await request(app).get("/v1/campaigns/stats");

    for (const call of mockCallExternalService.mock.calls) {
      const path = call[1] as string;
      expect(path).toContain("groupBy=campaignId");
    }
  });

  it("should fill defaults when some services fail", async () => {
    const app = createApp();

    mockCallExternalService.mockImplementation((service: any) => {
      // Only lead-service responds
      if (service.url === "http://mock-lead") {
        return Promise.resolve({
          groups: [{ key: "c1", totalLeads: 5, byOutreachStatus: { contacted: 3 }, buffered: 1, skipped: 0 }],
        });
      }
      return Promise.reject(new Error("service down"));
    });

    const res = await request(app).get("/v1/campaigns/stats");

    expect(res.status).toBe(200);
    expect(res.body.campaigns).toHaveLength(1);

    const c1 = res.body.campaigns[0];
    expect(c1.campaignId).toBe("c1");
    expect(c1.leadsServed).toBe(5);
    expect(c1.leadsContacted).toBe(3);
    // Defaults for missing services
    expect(c1.recipientStats.contacted).toBe(0);
    expect(c1.recipientStats.sent).toBe(0);
    expect(c1.emailStats.sent).toBe(0);
    expect(c1.emailsGenerated).toBe(0);
    expect(c1.totalCostInUsdCents).toBeNull();
    expect(c1.runCount).toBe(0);
  });

  it("should return empty array when all services fail", async () => {
    const app = createApp();

    mockCallExternalService.mockRejectedValue(new Error("all down"));

    const res = await request(app).get("/v1/campaigns/stats");

    expect(res.status).toBe(200);
    expect(res.body.campaigns).toEqual([]);
  });

  it("should pass orgId to lead-service and content-generation even without brandId", async () => {
    const app = createApp();

    mockCallExternalService.mockResolvedValue({ groups: [] });

    await request(app).get("/v1/campaigns/stats");

    for (const call of mockCallExternalService.mock.calls) {
      const path = call[1] as string;
      expect(path).toContain("orgId=org1");
    }
  });

  it("should use only broadcast stats from email-gateway, not transactional", async () => {
    const app = createApp();

    mockCallExternalService.mockImplementation((service: any) => {
      if (service.url === "http://mock-email-gw") {
        return Promise.resolve({
          groups: [{
            key: "c1",
            broadcast: makeBroadcast(
              { contacted: 8, sent: 5, delivered: 5, opened: 3 },
              { sent: 5, delivered: 5, opened: 3 },
            ),
            transactional: makeBroadcast(
              { contacted: 200, sent: 100, delivered: 95, opened: 60, clicked: 10, bounced: 5 },
              { sent: 100, delivered: 95, opened: 60, clicked: 10, bounced: 5 },
            ),
          }],
        });
      }
      return Promise.resolve({ groups: [] });
    });

    const res = await request(app).get("/v1/campaigns/stats");

    const c1 = res.body.campaigns.find((c: any) => c.campaignId === "c1");
    // Must be broadcast only, NOT transactional or sum
    expect(c1.recipientStats.contacted).toBe(8);
    expect(c1.recipientStats.sent).toBe(5);
    expect(c1.recipientStats.opened).toBe(3);
    expect(c1.recipientStats.repliesPositive).toBe(0);
    expect(c1.emailStats.sent).toBe(5);
  });
});

describe("Dashboard endpoints OpenAPI — campaigns/stats", () => {
  it("should register GET /v1/campaigns/stats in schemas.ts", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "../../src/schemas.ts"),
      "utf-8",
    );
    expect(content).toContain('path: "/v1/campaigns/stats"');
  });
});
