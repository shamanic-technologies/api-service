/**
 * Tests for GET /v1/public/features/ranked and GET /v1/public/features/best.
 * Both are proxied to features-service /public/stats/*.
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

const MOCK_RANKED = {
  objective: "recipientPositiveReplyRate",
  sortDirection: "desc",
  results: [
    {
      brand: { id: "brand-1", name: "Acme", domain: "acme.test" },
      stats: { totalCostInUsdCents: 500, completedRuns: 10 },
      timeline: [
        {
          date: "2026-06-01",
          cumulativePipelineUsd: 1200,
          emailsSent: 100,
          emailsOpened: 45,
          emailsClicked: 12,
          emailsReplied: 4,
        },
      ],
    },
  ],
};

const MOCK_HERO = {
  best: {
    recipientsRepliesPositive: { workflowSlug: "sales-email-cold-outreach-mintaka", workflowName: "Mintaka", createdForBrandId: "b-1", value: 12 },
    leadsServed: null,
  },
};

describe("GET /v1/public/features/ranked", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proxies to features-service /public/stats/ranked without auth", async () => {
    const app = createApp();
    mockCallExternalService.mockImplementation((service: any, path: string) => {
      if (service.url === "http://mock-features" && path.startsWith("/public/stats/ranked")) {
        return Promise.resolve(MOCK_RANKED);
      }
      return Promise.resolve({});
    });

    const res = await request(app).get("/v1/public/features/ranked?featureSlug=pr-cold-email&objective=recipientsRepliesPositive&groupBy=brand");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_RANKED);

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/public/stats/ranked"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("featureSlug=pr-cold-email");
    expect(url).toContain("objective=recipientsRepliesPositive");
    expect(url).toContain("groupBy=brand");
  });

  it("preserves optional brand timeline points from features-service", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_RANKED);

    const res = await request(app).get("/v1/public/features/ranked?featureSlug=sales-cold-email-outreach&groupBy=brand");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_RANKED);
    expect(res.body.results[0].timeline).toEqual(MOCK_RANKED.results[0].timeline);
  });

  it("does not forward featureDynastySlug to features-service", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_RANKED);

    await request(app).get("/v1/public/features/ranked?featureSlug=pr-cold-email&featureDynastySlug=pr-cold-email-legacy&objective=recipientsRepliesPositive");

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/public/stats/ranked"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).not.toContain("featureDynastySlug=");
  });
});

describe("GET /v1/public/features/best", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proxies to features-service /public/stats/best without auth", async () => {
    const app = createApp();
    mockCallExternalService.mockImplementation((service: any, path: string) => {
      if (service.url === "http://mock-features" && path.startsWith("/public/stats/best")) {
        return Promise.resolve(MOCK_HERO);
      }
      return Promise.resolve({});
    });

    const res = await request(app).get("/v1/public/features/best?featureSlug=pr-cold-email&groupBy=workflow");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_HERO);

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/public/stats/best"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("featureSlug=pr-cold-email");
    expect(url).toContain("groupBy=workflow");
  });

  it("does not forward featureDynastySlug, objective, brandId, or by to features-service", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_HERO);

    await request(app).get("/v1/public/features/best?featureSlug=pr-cold-email&featureDynastySlug=pr-cold-email-legacy&objective=replied&brandId=b-1&by=brand");

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/public/stats/best"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).not.toContain("featureDynastySlug=");
    expect(url).not.toContain("objective=");
    expect(url).not.toContain("brandId=");
    expect(url).not.toContain("by=");
  });
});

describe("GET /v1/public/features/revenue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proxies brand-grouped public revenue to features-service without auth and returns the body verbatim", async () => {
    const app = createApp();
    mockCallExternalService.mockImplementation((service: any, path: string) => {
      if (service.url === "http://mock-features" && path.startsWith("/public/stats/revenue")) {
        return Promise.resolve(MOCK_PUBLIC_BRAND_REVENUE);
      }
      return Promise.resolve({});
    });

    const res = await request(app).get("/v1/public/features/revenue?featureSlug=sales-cold-email-outreach&groupBy=brand");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_PUBLIC_BRAND_REVENUE);

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/public/stats/revenue"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("featureSlug=sales-cold-email-outreach");
    expect(url).toContain("groupBy=brand");
  });

  it("proxies workflow-grouped public revenue to features-service without auth and returns the body verbatim", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_PUBLIC_WORKFLOW_REVENUE);

    const res = await request(app).get("/v1/public/features/revenue?featureSlug=sales-cold-email-outreach&groupBy=workflow");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_PUBLIC_WORKFLOW_REVENUE);

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/public/stats/revenue"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("featureSlug=sales-cold-email-outreach");
    expect(url).toContain("groupBy=workflow");
  });

  it("does not forward private dashboard filters to public revenue", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_PUBLIC_BRAND_REVENUE);

    await request(app).get("/v1/public/features/revenue?featureSlug=sales-cold-email-outreach&groupBy=brand&brandId=brand-1&campaignId=campaign-1&workflowSlug=workflow-1");

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/public/stats/revenue"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).not.toContain("brandId=");
    expect(url).not.toContain("campaignId=");
    expect(url).not.toContain("workflowSlug=");
  });
});

const MOCK_REVENUE = {
  pipelineRevenueUsdCents: 1234500,
  organizations: [{ orgId: "o-1", name: "Acme", revenueUsdCents: 1000000 }],
  leads: [{ leadId: "l-1", stage: "qualified", expectedRevenueUsdCents: 234500 }],
};

const MOCK_WORKFLOW_REVENUE = {
  featureSlug: "sales-cold-email-outreach",
  groupBy: "workflowSlug",
  groups: [
    {
      workflowSlug: "sales-email-cold-outreach-mintaka-v3",
      headline: { totalPipelineUsd: 42000, economicsSource: "sales-economics" },
      costEconomics: { totalCostUsd: 210, costOfAcquisitionPct: 0.5, roiMultiple: 200 },
    },
  ],
};

const MOCK_PUBLIC_BRAND_REVENUE = {
  featureSlug: "sales-cold-email-outreach",
  groupBy: "brand",
  results: [
    {
      brand: { id: "brand-1", name: "Acme", domain: "acme.test" },
      headline: { totalPipelineUsd: 12000 },
      costEconomics: { totalCostUsd: 60, costOfAcquisitionPct: 0.5, roiMultiple: 200 },
    },
  ],
};

const MOCK_PUBLIC_WORKFLOW_REVENUE = {
  featureSlug: "sales-cold-email-outreach",
  groupBy: "workflow",
  results: [
    {
      workflow: {
        id: "workflow-1",
        workflowSlug: "sales-email-cold-outreach-mintaka-v3",
        workflowName: "Mintaka",
        workflowDynastyName: "Mintaka",
        workflowDynastySlug: "sales-email-cold-outreach-mintaka",
        version: 3,
        featureSlug: "sales-cold-email-outreach",
        createdForBrandId: null,
      },
      headline: { totalPipelineUsd: 42000 },
      costEconomics: { totalCostUsd: 210, costOfAcquisitionPct: 0.5, roiMultiple: 200 },
    },
  ],
};

describe("GET /v1/features/:slug/revenue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proxies to features-service /features/:slug/revenue and returns the body verbatim", async () => {
    const app = createApp();
    mockCallExternalService.mockImplementation((service: any, path: string) => {
      if (service.url === "http://mock-features" && path.startsWith("/features/sales-cold-email-outreach/revenue")) {
        return Promise.resolve(MOCK_REVENUE);
      }
      return Promise.resolve({});
    });

    const res = await request(app).get("/v1/features/sales-cold-email-outreach/revenue?brandId=brand-uuid-123&campaignId=campaign-uuid-456");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_REVENUE);

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/features/sales-cold-email-outreach/revenue"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("brandId=brand-uuid-123");
    expect(url).toContain("campaignId=campaign-uuid-456");
  });

  it("forwards only brandId when campaignId is absent", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_REVENUE);

    await request(app).get("/v1/features/sales-cold-email-outreach/revenue?brandId=brand-uuid-123");

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/features/sales-cold-email-outreach/revenue"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("brandId=brand-uuid-123");
    expect(url).not.toContain("campaignId=");
  });

  it("forwards groupBy downstream when present", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_REVENUE);

    await request(app).get("/v1/features/sales-cold-email-outreach/revenue?brandId=brand-uuid-123&groupBy=campaignId");

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/features/sales-cold-email-outreach/revenue"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("brandId=brand-uuid-123");
    expect(url).toContain("groupBy=campaignId");
  });

  it("forwards workflowSlug and groupBy=workflowSlug downstream when present", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_WORKFLOW_REVENUE);

    const res = await request(app).get("/v1/features/sales-cold-email-outreach/revenue?brandId=brand-uuid-123&workflowSlug=sales-email-cold-outreach-mintaka-v3&groupBy=workflowSlug");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_WORKFLOW_REVENUE);

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/features/sales-cold-email-outreach/revenue"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("brandId=brand-uuid-123");
    expect(url).toContain("workflowSlug=sales-email-cold-outreach-mintaka-v3");
    expect(url).toContain("groupBy=workflowSlug");
  });

  it("does not forward groupBy when absent", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_REVENUE);

    await request(app).get("/v1/features/sales-cold-email-outreach/revenue?brandId=brand-uuid-123");

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/features/sales-cold-email-outreach/revenue"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).not.toContain("groupBy=");
  });
});
