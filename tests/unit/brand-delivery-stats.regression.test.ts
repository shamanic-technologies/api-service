/**
 * Regression test: the brand page was summing per-campaign delivery stats
 * from the email-gateway, but the gateway doesn't properly filter by campaignId,
 * so each campaign got org-wide totals. With N campaigns, sent/opened were
 * inflated by a factor of N.
 *
 * Fix: GET /v1/email-gateway/stats makes a single email-gateway call
 * with brandId filter, returning only broadcast (outreach) stats.
 * This route now lives in email-gateway.ts (not brand.ts or campaigns.ts).
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
import emailGatewayRouter from "../../src/routes/email-gateway.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", emailGatewayRouter);
  return app;
}

describe("GET /v1/email-gateway/stats?brandId=brand-123", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return only broadcast (outreach) stats, ignoring transactional", async () => {
    const app = createApp();

    mockCallExternalService.mockImplementation((_service: any, path: string, opts: any) => {
      if (path.startsWith("/orgs/stats?")) {
        expect(path).toContain("brandId=brand-123");
        return Promise.resolve({
          transactional: {
            emailsContacted: 50, emailsSent: 50, emailsDelivered: 48, emailsOpened: 30,
            emailsClicked: 5, emailsReplied: 10, emailsBounced: 2,
            repliesInterested: 2, repliesMeetingBooked: 3, repliesClosed: 0,
            repliesNotInterested: 1, repliesNeutral: 1, repliesOutOfOffice: 1,
            repliesUnsubscribe: 0, recipients: 50,
          },
          broadcast: {
            emailsContacted: 6, emailsSent: 6, emailsDelivered: 6, emailsOpened: 4,
            emailsClicked: 0, emailsReplied: 1, emailsBounced: 0,
            repliesInterested: 0, repliesMeetingBooked: 0, repliesClosed: 0,
            repliesNotInterested: 1, repliesNeutral: 0, repliesOutOfOffice: 0,
            repliesUnsubscribe: 0, recipients: 6,
          },
        });
      }
      return Promise.resolve(null);
    });

    const res = await request(app).get("/v1/email-gateway/stats?brandId=brand-123");

    expect(res.status).toBe(200);
    // Should return ONLY broadcast stats, not transactional
    expect(res.body.emailsSent).toBe(6);
    expect(res.body.emailsOpened).toBe(4);
    expect(res.body.repliesNotInterested).toBe(1);
    // Transactional values (50, 30) must NOT appear
    expect(res.body.emailsSent).not.toBe(56); // not 50+6
    expect(res.body.emailsSent).not.toBe(50);
  });

  it("should return zeros when email-gateway fails", async () => {
    const app = createApp();

    mockCallExternalService.mockRejectedValue(new Error("gateway down"));

    const res = await request(app).get("/v1/email-gateway/stats?brandId=brand-123");

    expect(res.status).toBe(200);
    expect(res.body.emailsSent).toBe(0);
    expect(res.body.emailsOpened).toBe(0);
    expect(res.body.repliesInterested).toBe(0);
  });

  it("should return zeros when broadcast is null (only transactional exists)", async () => {
    const app = createApp();

    mockCallExternalService.mockResolvedValue({
      transactional: {
        emailsContacted: 50, emailsSent: 50, emailsDelivered: 48, emailsOpened: 30,
        emailsClicked: 5, emailsReplied: 10, emailsBounced: 2,
        repliesInterested: 2, repliesMeetingBooked: 3, repliesClosed: 0,
        repliesNotInterested: 1, repliesNeutral: 1, repliesOutOfOffice: 1,
        repliesUnsubscribe: 0, recipients: 50,
      },
      broadcast: null,
    });

    const res = await request(app).get("/v1/email-gateway/stats?brandId=brand-123");

    expect(res.status).toBe(200);
    // No broadcast = no outreach stats, should be zeros
    expect(res.body.emailsSent).toBe(0);
    expect(res.body.emailsOpened).toBe(0);
    expect(res.body.repliesInterested).toBe(0);
  });

  it("should make exactly one email-gateway call", async () => {
    const app = createApp();

    mockCallExternalService.mockResolvedValue({
      transactional: null,
      broadcast: {
        emailsContacted: 3, emailsSent: 3, emailsDelivered: 3, emailsOpened: 1,
        emailsClicked: 0, emailsReplied: 0, emailsBounced: 0,
        repliesInterested: 0, repliesMeetingBooked: 0, repliesClosed: 0,
        repliesNotInterested: 0, repliesNeutral: 0, repliesOutOfOffice: 0,
        repliesUnsubscribe: 0, recipients: 3,
      },
    });

    await request(app).get("/v1/email-gateway/stats?brandId=brand-123");

    const emailGatewayCalls = mockCallExternalService.mock.calls.filter(
      (call: any[]) => typeof call[1] === "string" && call[1].startsWith("/orgs/stats?")
    );
    expect(emailGatewayCalls).toHaveLength(1);
  });
});

describe("Regression: fetchDeliveryStats must use broadcast only", () => {
  it("fetchDeliveryStats should only read broadcast stats in source code", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(
      path.join(__dirname, "../../src/lib/delivery-stats.ts"),
      "utf-8"
    );

    // Should only use broadcast, not sum transactional + broadcast
    expect(content).toContain("Only use broadcast stats");
    expect(content).not.toMatch(/sum\(t?\.emails/);
  });

  it("delivery stats route should be in email-gateway.ts, using fetchDeliveryStats from lib/delivery-stats.ts", () => {
    const fs = require("fs");
    const path = require("path");
    const emailGatewayContent = fs.readFileSync(
      path.join(__dirname, "../../src/routes/email-gateway.ts"),
      "utf-8"
    );
    const campaignsContent = fs.readFileSync(
      path.join(__dirname, "../../src/routes/campaigns.ts"),
      "utf-8"
    );

    expect(emailGatewayContent).toContain('"/email-gateway/stats"');
    expect(emailGatewayContent).toContain("fetchDeliveryStats");
    expect(campaignsContent).not.toContain('"/brands/:brandId/stats"');
    expect(campaignsContent).not.toContain('"/brands/:id/stats"');
  });
});
