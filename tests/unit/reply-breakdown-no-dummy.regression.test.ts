/**
 * Regression test: reply-qualification service may return stale/incorrect
 * classification data even when there are zero actual replies.
 * The API must NOT surface those counts to the dashboard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the fetchDeliveryStats logic indirectly through the /campaigns/:id/stats endpoint.
// To isolate it, we mock the external service calls.

const mockCallExternalService = vi.fn();
const mockCallService = vi.fn();
const mockBuildInternalHeaders = vi.fn(() => ({}));
const mockGetRunsBatch = vi.fn();

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
  callService: (...args: unknown[]) => mockCallService(...args),
  externalServices: {
    emailgen: { url: "http://mock-emailgen", apiKey: "k" },
    emailGateway: { url: "http://mock-email", apiKey: "k" },
    replyQualification: { url: "http://mock-rq", apiKey: "k" },
    lead: { url: "http://mock-lead", apiKey: "k" },
    campaign: { url: "http://mock-campaign", apiKey: "k" },
    key: { url: "http://mock-key", apiKey: "k" },
    scraping: { url: "http://mock-scraping", apiKey: "k" },
    transactionalEmail: { url: "http://mock-transactional-email", apiKey: "k" },
    brand: { url: "http://mock-brand", apiKey: "k" },
    runs: { url: "http://mock-runs", apiKey: "k" },
  },
  services: {
    client: "http://mock-client",
  },
}));

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => {
    _req.userId = "user1";
    _req.orgId = "org1";
    _req.appId = "distribute";
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
  getRunsBatch: (...args: unknown[]) => mockGetRunsBatch(...args),
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

describe("Reply breakdown: no dummy data when 0 replies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return zero reply classifications when all aggregates are 0", async () => {
    const app = createApp();

    mockCallExternalService.mockImplementation((service: any, path: string) => {
      // Email-gateway: GET /stats?orgId=...&campaignId=...
      if (service.url === "http://mock-email" && path.startsWith("/orgs/stats?")) {
        return Promise.resolve({
          transactional: makeBroadcast({ sent: 10, delivered: 8, opened: 3, clicked: 1 }, { sent: 10, delivered: 8, opened: 3, clicked: 1 }),
          broadcast: makeBroadcast({ sent: 5, delivered: 4, opened: 2 }, { sent: 5, delivered: 4, opened: 2 }),
        });
      }
      // Lead-service
      if (service.url === "http://mock-lead" && path.startsWith("/orgs/stats?")) {
        return Promise.resolve({ served: 10, buffered: 0, skipped: 0 });
      }
      // Emailgen
      if (service.url === "http://mock-emailgen" && path.startsWith("/stats")) {
        return Promise.resolve({ stats: { emailsGenerated: 5 } });
      }
      // Campaign-service budget
      if (path === "/stats/batch-budget") {
        return Promise.resolve({ results: {} });
      }
      // Runs-service costs
      if (service.url === "http://mock-runs" && path.startsWith("/v1/stats/costs")) {
        return Promise.resolve({ groups: [] });
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/v1/campaigns/test-campaign-123/stats");

    expect(res.status).toBe(200);
    expect(res.body.recipientStats.repliesPositive).toBe(0);
    expect(res.body.recipientStats.repliesNegative).toBe(0);
    expect(res.body.recipientStats.repliesNeutral).toBe(0);
    expect(res.body.recipientStats.repliesAutoReply).toBe(0);
    expect(res.body.recipientStats.repliesDetail).toEqual(EMPTY_REPLIES_DETAIL);
  });

  it("should return reply classifications when replies exist", async () => {
    const app = createApp();

    mockCallExternalService.mockImplementation((service: any, path: string) => {
      // Email-gateway: GET /stats?orgId=...&campaignId=...
      if (service.url === "http://mock-email" && path.startsWith("/orgs/stats?")) {
        return Promise.resolve({
          transactional: makeBroadcast({ sent: 10, delivered: 8, opened: 3, clicked: 1 }, { sent: 10, delivered: 8, opened: 3, clicked: 1 }),
          broadcast: makeBroadcast(
            {
              sent: 5, delivered: 4, opened: 2,
              repliesPositive: 3, repliesNegative: 1, repliesAutoReply: 1,
              repliesDetail: {
                interested: 1, meetingBooked: 2, closed: 0,
                notInterested: 1, wrongPerson: 0, unsubscribe: 0,
                neutral: 0, autoReply: 0, outOfOffice: 1,
              },
            },
            { sent: 5, delivered: 4, opened: 2 },
          ),
        });
      }
      // Lead-service
      if (service.url === "http://mock-lead" && path.startsWith("/orgs/stats?")) {
        return Promise.resolve({ served: 10, buffered: 0, skipped: 0 });
      }
      // Emailgen
      if (service.url === "http://mock-emailgen" && path.startsWith("/stats")) {
        return Promise.resolve({ stats: { emailsGenerated: 5 } });
      }
      // Campaign-service budget
      if (path === "/stats/batch-budget") {
        return Promise.resolve({ results: {} });
      }
      // Runs-service costs
      if (service.url === "http://mock-runs" && path.startsWith("/v1/stats/costs")) {
        return Promise.resolve({ groups: [] });
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/v1/campaigns/test-campaign-123/stats");

    expect(res.status).toBe(200);
    expect(res.body.recipientStats.repliesPositive).toBe(3);
    expect(res.body.recipientStats.repliesNegative).toBe(1);
    expect(res.body.recipientStats.repliesAutoReply).toBe(1);
    expect(res.body.recipientStats.repliesDetail.interested).toBe(1);
    expect(res.body.recipientStats.repliesDetail.meetingBooked).toBe(2);
    expect(res.body.recipientStats.repliesDetail.notInterested).toBe(1);
    expect(res.body.recipientStats.repliesDetail.outOfOffice).toBe(1);
  });
});
