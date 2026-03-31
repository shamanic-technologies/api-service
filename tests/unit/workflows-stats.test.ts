/**
 * Tests for GET /v1/workflows/ranked and GET /v1/workflows/best.
 * Both are proxied to features-service /stats/*.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallExternalService = vi.fn();

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
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
import workflowsRouter from "../../src/routes/workflows.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", workflowsRouter);
  return app;
}

const MOCK_RANKED = {
  results: [
    {
      workflow: { id: "wf-1", name: "sales-email-cold-outreach-mintaka", displayName: "Mintaka" },
      stats: { totalCostInUsdCents: 500, completedRuns: 10 },
    },
  ],
};

const MOCK_HERO = {
  bestCostPerOpen: { workflowId: "wf-1", workflowSlug: "sales-email-cold-outreach-mintaka", displayName: "Mintaka", brandId: "b-1", value: 12 },
  bestCostPerReply: null,
};

describe("GET /v1/workflows/ranked", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proxies to features-service /stats/ranked with query params", async () => {
    const app = createApp();
    mockCallExternalService.mockImplementation((service: any, path: string) => {
      if (service.url === "http://mock-features" && path.startsWith("/stats/ranked")) {
        return Promise.resolve(MOCK_RANKED);
      }
      return Promise.resolve({});
    });

    const res = await request(app).get("/v1/workflows/ranked?featureDynastySlug=pr-cold-email&objective=replied&groupBy=brand&limit=20");

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(MOCK_RANKED.results);

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/stats/ranked"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("featureDynastySlug=pr-cold-email");
    expect(url).toContain("objective=replied");
    expect(url).toContain("groupBy=brand");
    expect(url).toContain("limit=20");
  });

  it("does not forward featureSlug to features-service", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_RANKED);

    await request(app).get("/v1/workflows/ranked?featureSlug=pr-cold-email-v3&featureDynastySlug=pr-cold-email&objective=replied");

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/stats/ranked"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).not.toContain("featureSlug=");
  });
});

describe("GET /v1/workflows/best", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proxies to features-service /stats/best", async () => {
    const app = createApp();
    mockCallExternalService.mockImplementation((service: any, path: string) => {
      if (service.url === "http://mock-features" && path.startsWith("/stats/best")) {
        return Promise.resolve(MOCK_HERO);
      }
      return Promise.resolve({});
    });

    const res = await request(app).get("/v1/workflows/best?featureDynastySlug=pr-cold-email&groupBy=brand");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_HERO);

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/stats/best"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).toContain("featureDynastySlug=pr-cold-email");
    expect(url).toContain("groupBy=brand");
  });

  it("does not forward featureSlug, objective, brandId, or by to features-service", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(MOCK_HERO);

    await request(app).get("/v1/workflows/best?featureDynastySlug=pr-cold-email&featureSlug=pr-cold-email-v3&objective=replied&brandId=b-1&by=brand");

    const call = mockCallExternalService.mock.calls.find(
      (c: any[]) => typeof c[1] === "string" && c[1].startsWith("/stats/best"),
    );
    expect(call).toBeDefined();
    const url = call![1] as string;
    expect(url).not.toContain("featureSlug=");
    expect(url).not.toContain("objective=");
    expect(url).not.toContain("brandId=");
    expect(url).not.toContain("by=");
  });
});


