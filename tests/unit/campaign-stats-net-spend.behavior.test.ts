/**
 * STATS-NET-1116: campaign stats tell the org what it PAYS.
 *
 * Prod 2026-11-16: an org with a 50% usage discount read "$240.84 spent" on its cold-email
 * campaign (gross, before the discount) while runs-service held $122.41 net and the
 * dashboard's "Invested" printed the net. The single and the list stats routes now publish
 * runs-service's frozen NET amounts under the fields consumers already read (headline cost,
 * totalCostInUsdCents, every costBreakdown line), and the price BEFORE the discount beside
 * each under a `...BeforeDiscount...` name (owner: « que les stats rendent les deux chiffres »).
 * An org with no discount has net == gross: both figures equal, the paid one unchanged. Drives the real router; the downstream answers are runs-service's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCallExternalService = vi.fn();

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
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
  buildInternalHeaders: (req: any) => {
    const headers: Record<string, string> = {};
    if (req.orgId) headers["x-org-id"] = req.orgId;
    if (req.userId) headers["x-user-id"] = req.userId;
    if (req.appId) headers["x-app-id"] = req.appId;
    return headers;
  },
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../../src/lib/delivery-stats.js", () => ({
  fetchDeliveryStats: vi.fn().mockResolvedValue({
    recipientStats: {
      contacted: 0, sent: 4, delivered: 4, opened: 2,
      bounced: 0, clicked: 0, unsubscribed: 0,
      repliesPositive: 0, repliesNegative: 0, repliesNeutral: 0, repliesAutoReply: 0,
      repliesDetail: { interested: 0, meetingBooked: 0, closed: 0, notInterested: 0, wrongPerson: 0, unsubscribe: 0, neutral: 0, autoReply: 0, outOfOffice: 0 },
    },
    emailStats: {
      sent: 4, delivered: 4, opened: 2, clicked: 0, bounced: 0, unsubscribed: 0,
      stepStats: [],
    },
  }),
  EMPTY_DELIVERY_STATS: {
    recipientStats: {
      contacted: 0, sent: 0, delivered: 0, opened: 0,
      bounced: 0, clicked: 0, unsubscribed: 0,
      repliesPositive: 0, repliesNegative: 0, repliesNeutral: 0, repliesAutoReply: 0,
      repliesDetail: { interested: 0, meetingBooked: 0, closed: 0, notInterested: 0, wrongPerson: 0, unsubscribe: 0, neutral: 0, autoReply: 0, outOfOffice: 0 },
    },
    emailStats: {
      sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0,
      stepStats: [],
    },
  },
}));

import express from "express";
import request from "supertest";
import { fetchDeliveryStats } from "../../src/lib/delivery-stats.js";
import campaignsRouter from "../../src/routes/campaigns.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignsRouter);
  return app;
}


const CAMPAIGN = "b93006ef-829e-43fc-908a-8077dc028bd9";

// runs-service answers measured in prod 2026-11-16 for the discounted org (50%).
const DISCOUNTED = {
  byCampaign: { groups: [{ dimensions: { campaignId: CAMPAIGN }, totalCostInUsdCents: "24084.0000000000", actualCostInUsdCents: "24081.0000000000", provisionedCostInUsdCents: "3.0000000000", netTotalCostInUsdCents: "12241.0000000000", netActualCostInUsdCents: "12240.0000000000", netProvisionedCostInUsdCents: "1.0000000000", runCount: 40 }] },
  byCostName: { groups: [{ dimensions: { costName: "treg-micro-usd" }, totalCostInUsdCents: "21753.0000000000", actualCostInUsdCents: "21753.0000000000", provisionedCostInUsdCents: "0.0000000000", netTotalCostInUsdCents: "10883.0000000000", netActualCostInUsdCents: "10883.0000000000", netProvisionedCostInUsdCents: "0.0000000000", totalQuantity: "217530000" }] },
};
// No discount: runs-service freezes net == gross.
const UNDISCOUNTED = {
  byCampaign: { groups: [{ dimensions: { campaignId: CAMPAIGN }, totalCostInUsdCents: "900.0000000000", actualCostInUsdCents: "900.0000000000", provisionedCostInUsdCents: "0.0000000000", netTotalCostInUsdCents: "900.0000000000", netActualCostInUsdCents: "900.0000000000", netProvisionedCostInUsdCents: "0.0000000000", runCount: 3 }] },
  byCostName: { groups: [{ dimensions: { costName: "apollo-credit" }, totalCostInUsdCents: "900.0000000000", actualCostInUsdCents: "900.0000000000", provisionedCostInUsdCents: "0.0000000000", netTotalCostInUsdCents: "900.0000000000", netActualCostInUsdCents: "900.0000000000", netProvisionedCostInUsdCents: "0.0000000000", totalQuantity: "9" }] },
};

function stubRuns(answers: typeof DISCOUNTED) {
  const paths: string[] = [];
  mockCallExternalService.mockImplementation((service: any, path: string) => {
    paths.push(`${service.url}${path}`);
    if (service.url === "http://mock-runs" && path.includes("groupBy=costName")) return Promise.resolve(answers.byCostName);
    if (service.url === "http://mock-runs" && path.includes("groupBy=campaignId")) return Promise.resolve(answers.byCampaign);
    if (service.url === "http://mock-lead") return Promise.resolve({ totalLeads: 0, byOutreachStatus: { contacted: 0 }, buffered: 0, skipped: 0, groups: [] });
    return Promise.resolve({ groups: [] });
  });
  return paths;
}

describe("Campaign stats spend is NET of the org usage discount (STATS-NET-1116)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("single campaign: what the org pays leads, the price before the discount sits beside it", async () => {
    const paths = stubRuns(DISCOUNTED);
    const res = await request(createApp()).get(`/v1/campaigns/${CAMPAIGN}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.totalCostInUsdCents).toBe("12241.0000000000");
    expect(res.body.totalCostBeforeDiscountInUsdCents).toBe("24084.0000000000");
    expect(res.body.headline.costInUsdCents).toBe("12241.0000000000");
    expect(res.body.headline.costBeforeDiscountInUsdCents).toBe("24084.0000000000");
    expect(res.body.costBreakdown).toEqual([{
      costName: "treg-micro-usd",
      totalCostInUsdCents: "10883.0000000000",
      actualCostInUsdCents: "10883.0000000000",
      provisionedCostInUsdCents: "0.0000000000",
      totalCostBeforeDiscountInUsdCents: "21753.0000000000",
      actualCostBeforeDiscountInUsdCents: "21753.0000000000",
      provisionedCostBeforeDiscountInUsdCents: "0.0000000000",
      totalQuantity: "217530000",
    }]);
    // Spend comes from the ledger, scoped to the authenticated org; campaign-service is not read.
    expect(paths).toContain(`http://mock-runs/v1/stats/costs?orgId=org1&campaignId=${CAMPAIGN}&groupBy=campaignId`);
    expect(paths.some((p) => p.includes("/stats/batch-budget"))).toBe(false);
  });

  it("single campaign: an org with no discount sees both figures equal (net == gross)", async () => {
    stubRuns(UNDISCOUNTED);
    const res = await request(createApp()).get(`/v1/campaigns/${CAMPAIGN}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.totalCostInUsdCents).toBe("900.0000000000");
    expect(res.body.totalCostBeforeDiscountInUsdCents).toBe("900.0000000000");
    expect(res.body.headline.costBeforeDiscountInUsdCents).toBe("900.0000000000");
    expect(res.body.costBreakdown[0].totalCostInUsdCents).toBe("900.0000000000");
    expect(res.body.costBreakdown[0].totalCostBeforeDiscountInUsdCents).toBe("900.0000000000");
  });

  it("campaign list: each campaign's spend reads net, the before-discount price beside it", async () => {
    stubRuns(DISCOUNTED);
    const res = await request(createApp()).get("/v1/campaigns/stats");

    expect(res.status).toBe(200);
    const c = res.body.campaigns.find((x: any) => x.campaignId === CAMPAIGN);
    expect(c.totalCostInUsdCents).toBe("12241.0000000000");
    expect(c.headline.costInUsdCents).toBe("12241.0000000000");
    expect(c.totalCostBeforeDiscountInUsdCents).toBe("24084.0000000000");
    expect(c.headline.costBeforeDiscountInUsdCents).toBe("24084.0000000000");
  });

  it("refuses to print the gross as the spend when runs-service omits the net amount", async () => {
    const gross = { groups: [{ dimensions: { campaignId: CAMPAIGN }, totalCostInUsdCents: "24084", runCount: 1 }] };
    mockCallExternalService.mockImplementation((service: any, path: string) =>
      Promise.resolve(service.url === "http://mock-runs" && path.includes("groupBy=campaignId") ? gross : { groups: [] }));

    const res = await request(createApp()).get(`/v1/campaigns/${CAMPAIGN}/stats`);
    expect(res.status).toBe(500);
    expect(res.body.error).toContain("netTotalCostInUsdCents");
  });
});
