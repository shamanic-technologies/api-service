/**
 * Tests for GET /v1/campaigns/:id/replies
 * Proxies to email-gateway /stats with groupBy: "leadEmail",
 * filters for leads with replies, returns reply type breakdown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  },
  services: {
    client: "http://mock-client",
  },
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

describe("GET /v1/campaigns/:id/replies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return only leads with replies, filtering out non-repliers", async () => {
    const app = createApp();

    mockCallExternalService.mockImplementation((_service: any, path: string) => {
      if (path === "/stats") {
        return Promise.resolve({
          groups: [
            {
              key: "alice@example.com",
              broadcast: {
                emailsReplied: 1,
                repliesWillingToMeet: 0,
                repliesInterested: 1,
                repliesNotInterested: 0,
                repliesOutOfOffice: 0,
                repliesUnsubscribe: 0,
              },
            },
            {
              key: "bob@example.com",
              broadcast: {
                emailsReplied: 0,
                repliesWillingToMeet: 0,
                repliesInterested: 0,
                repliesNotInterested: 0,
                repliesOutOfOffice: 0,
                repliesUnsubscribe: 0,
              },
            },
            {
              key: "carol@example.com",
              broadcast: {
                emailsReplied: 1,
                repliesWillingToMeet: 0,
                repliesInterested: 0,
                repliesNotInterested: 1,
                repliesOutOfOffice: 0,
                repliesUnsubscribe: 0,
              },
            },
          ],
        });
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/v1/campaigns/campaign-123/replies");

    expect(res.status).toBe(200);
    expect(res.body.replies).toHaveLength(2);
    expect(res.body.replies[0].email).toBe("alice@example.com");
    expect(res.body.replies[0].repliesInterested).toBe(1);
    expect(res.body.replies[1].email).toBe("carol@example.com");
    expect(res.body.replies[1].repliesNotInterested).toBe(1);
  });

  it("should return empty replies array when no leads have replied", async () => {
    const app = createApp();

    mockCallExternalService.mockResolvedValue({
      groups: [
        {
          key: "alice@example.com",
          broadcast: {
            emailsReplied: 0,
            repliesWillingToMeet: 0,
            repliesInterested: 0,
            repliesNotInterested: 0,
            repliesOutOfOffice: 0,
            repliesUnsubscribe: 0,
          },
        },
      ],
    });

    const res = await request(app).get("/v1/campaigns/campaign-123/replies");

    expect(res.status).toBe(200);
    expect(res.body.replies).toHaveLength(0);
  });

  it("should return empty replies when groups is empty", async () => {
    const app = createApp();

    mockCallExternalService.mockResolvedValue({ groups: [] });

    const res = await request(app).get("/v1/campaigns/campaign-123/replies");

    expect(res.status).toBe(200);
    expect(res.body.replies).toHaveLength(0);
  });

  it("should handle null broadcast by filtering out the lead", async () => {
    const app = createApp();

    mockCallExternalService.mockResolvedValue({
      groups: [
        { key: "alice@example.com", broadcast: null },
        {
          key: "bob@example.com",
          broadcast: {
            emailsReplied: 1,
            repliesWillingToMeet: 1,
            repliesInterested: 0,
            repliesNotInterested: 0,
            repliesOutOfOffice: 0,
            repliesUnsubscribe: 0,
          },
        },
      ],
    });

    const res = await request(app).get("/v1/campaigns/campaign-123/replies");

    expect(res.status).toBe(200);
    expect(res.body.replies).toHaveLength(1);
    expect(res.body.replies[0].email).toBe("bob@example.com");
    expect(res.body.replies[0].repliesWillingToMeet).toBe(1);
  });

  it("should call email-gateway with correct params", async () => {
    const app = createApp();

    mockCallExternalService.mockResolvedValue({ groups: [] });

    await request(app).get("/v1/campaigns/my-campaign-id/replies");

    expect(mockCallExternalService).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://mock-email" }),
      "/stats",
      expect.objectContaining({
        method: "POST",
        body: { campaignId: "my-campaign-id", orgId: "org1", groupBy: "leadEmail" },
      })
    );
  });

  it("should return 500 when email-gateway fails", async () => {
    const app = createApp();

    mockCallExternalService.mockRejectedValue(new Error("gateway down"));

    const res = await request(app).get("/v1/campaigns/campaign-123/replies");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("gateway down");
  });

  it("should forward downstream HTTP status codes", async () => {
    const app = createApp();

    const err = new Error("not found") as any;
    err.statusCode = 404;
    mockCallExternalService.mockRejectedValue(err);

    const res = await request(app).get("/v1/campaigns/campaign-123/replies");

    expect(res.status).toBe(404);
  });
});
