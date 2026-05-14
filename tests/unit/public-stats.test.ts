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
    stripe: { url: "http://mock-stripe", apiKey: "k" },
    apiRegistry: { url: "http://mock-api-registry", apiKey: "k" },
    pressKits: { url: "http://mock-press-kits", apiKey: "k" },
    outlet: { url: "http://mock-outlet", apiKey: "k" },
    journalist: { url: "http://mock-journalist", apiKey: "k" },
    articles: { url: "http://mock-articles", apiKey: "k" },
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
import publicStatsRouter from "../../src/routes/public-stats.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(publicStatsRouter);
  return app;
}

const MOCK_USER_STATS = {
  totalOrgs: 38,
  totalUsers: 142,
  monthlyGrowth: [
    { month: "2026-01", newOrgs: 8, newUsers: 15 },
    { month: "2026-02", newOrgs: 12, newUsers: 28 },
  ],
};

// Fractional decimal-string cents — billing-service contract post-#107
// (creditBalance/consumed fields removed; grants is the accurate label).
const MOCK_BILLING_STATS = {
  totalAccounts: 35,
  accountsWithPaymentMethod: 12,
  totalGrantsCents: "450000.4200000000",
  totalCreditedCents: "1200000.0000000000",
  monthlyGrowth: [
    { period: "2026-01", credited_cents: "200000.0000000000", revenue_cents: "80000.0000000000" },
    { period: "2026-02", credited_cents: "350000.0000000000", revenue_cents: "150000.0000000000" },
  ],
  weeklyGrowth: [
    { period: "2026-W14", credited_cents: "50000.0000000000", revenue_cents: "20000.0000000000" },
    { period: "2026-W15", credited_cents: "75000.0000000000", revenue_cents: "35000.0000000000" },
  ],
};

const MOCK_RUN_STATS = {
  byStatus: { completed: 8420, failed: 310, running: 5 },
  monthly: [
    { month: "2026-01", completed: 1200, failed: 50, running: 0 },
    { month: "2026-02", completed: 2100, failed: 80, running: 0 },
  ],
};

beforeEach(() => {
  mockCallExternalService.mockReset();
});

describe("GET /public/stats/users", () => {
  it("proxies to client-service and returns user stats", async () => {
    mockCallExternalService.mockResolvedValueOnce(MOCK_USER_STATS);
    const app = createApp();
    const res = await request(app).get("/public/stats/users");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_USER_STATS);
    expect(mockCallExternalService).toHaveBeenCalledWith(
      { url: "http://mock-client", apiKey: "k" },
      "/public/stats/users",
    );
  });

  it("returns 502 when client-service is down", async () => {
    mockCallExternalService.mockRejectedValueOnce(new Error("connection refused"));
    const app = createApp();
    const res = await request(app).get("/public/stats/users");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("connection refused");
  });
});

describe("GET /public/stats/billing", () => {
  it("proxies to billing-service and returns billing stats", async () => {
    mockCallExternalService.mockResolvedValueOnce(MOCK_BILLING_STATS);
    const app = createApp();
    const res = await request(app).get("/public/stats/billing");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_BILLING_STATS);
    expect(mockCallExternalService).toHaveBeenCalledWith(
      { url: "http://mock-billing", apiKey: "k" },
      "/public/stats/billing",
    );
  });

  it("passes through monthlyGrowth and weeklyGrowth arrays", async () => {
    mockCallExternalService.mockResolvedValueOnce(MOCK_BILLING_STATS);
    const app = createApp();
    const res = await request(app).get("/public/stats/billing");
    expect(res.status).toBe(200);
    expect(res.body.monthlyGrowth).toEqual(MOCK_BILLING_STATS.monthlyGrowth);
    expect(res.body.weeklyGrowth).toEqual(MOCK_BILLING_STATS.weeklyGrowth);
    expect(res.body.monthlyGrowth[0]).toEqual({
      period: "2026-01",
      credited_cents: "200000.0000000000",
      revenue_cents: "80000.0000000000",
    });
    // precision preserved as string, not coerced to number
    expect(typeof res.body.monthlyGrowth[0].credited_cents).toBe("string");
    expect(typeof res.body.totalGrantsCents).toBe("string");
    expect(res.body.weeklyGrowth).toHaveLength(2);
  });

  it("returns 502 when billing-service is down", async () => {
    mockCallExternalService.mockRejectedValueOnce(new Error("timeout"));
    const app = createApp();
    const res = await request(app).get("/public/stats/billing");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("timeout");
  });
});

describe("GET /public/stats/runs", () => {
  it("proxies to runs-service and returns run stats", async () => {
    mockCallExternalService.mockResolvedValueOnce(MOCK_RUN_STATS);
    const app = createApp();
    const res = await request(app).get("/public/stats/runs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(MOCK_RUN_STATS);
    expect(mockCallExternalService).toHaveBeenCalledWith(
      { url: "http://mock-runs", apiKey: "k" },
      "/public/stats/runs",
    );
  });

  it("returns 502 when runs-service is down", async () => {
    mockCallExternalService.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const app = createApp();
    const res = await request(app).get("/public/stats/runs");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("ECONNREFUSED");
  });

  it("forwards upstream status code when available", async () => {
    const err = new Error("Not found") as Error & { statusCode: number };
    err.statusCode = 404;
    mockCallExternalService.mockRejectedValueOnce(err);
    const app = createApp();
    const res = await request(app).get("/public/stats/runs");
    expect(res.status).toBe(404);
  });
});
