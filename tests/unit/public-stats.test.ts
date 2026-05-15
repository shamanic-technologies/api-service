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

beforeEach(() => {
  mockCallExternalService.mockReset();
});

describe("GET /public/stats/users", () => {
  it("proxies to client-service", async () => {
    const upstream = { foo: "bar" };
    mockCallExternalService.mockResolvedValueOnce(upstream);
    const res = await request(createApp()).get("/public/stats/users");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(mockCallExternalService).toHaveBeenCalledWith(
      { url: "http://mock-client", apiKey: "k" },
      "/public/stats/users",
    );
  });

  it("returns 502 when client-service is down", async () => {
    mockCallExternalService.mockRejectedValueOnce(new Error("connection refused"));
    const res = await request(createApp()).get("/public/stats/users");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("connection refused");
  });
});

describe("GET /public/stats/billing", () => {
  it("proxies to billing-service (passthrough — body forwarded unchanged)", async () => {
    const upstream = {
      total_accounts: 35,
      accounts_with_payment_method: 12,
      total_credited_cents: "1200000.0000000000",
      total_paid_cents: "900000.0000000000",
      total_local_credits_cents: "300000.0000000000",
      monthly_growth: [],
      weekly_growth: [],
    };
    mockCallExternalService.mockResolvedValueOnce(upstream);
    const res = await request(createApp()).get("/public/stats/billing");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(mockCallExternalService).toHaveBeenCalledWith(
      { url: "http://mock-billing", apiKey: "k" },
      "/public/stats/billing",
    );
  });

  it("returns 502 when billing-service is down", async () => {
    mockCallExternalService.mockRejectedValueOnce(new Error("timeout"));
    const res = await request(createApp()).get("/public/stats/billing");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("timeout");
  });
});

describe("GET /public/stats/runs", () => {
  it("proxies to runs-service", async () => {
    const upstream = { byStatus: { completed: 1 } };
    mockCallExternalService.mockResolvedValueOnce(upstream);
    const res = await request(createApp()).get("/public/stats/runs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(mockCallExternalService).toHaveBeenCalledWith(
      { url: "http://mock-runs", apiKey: "k" },
      "/public/stats/runs",
    );
  });

  it("returns 502 when runs-service is down", async () => {
    mockCallExternalService.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await request(createApp()).get("/public/stats/runs");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("ECONNREFUSED");
  });

  it("forwards upstream status code when available", async () => {
    const err = new Error("Not found") as Error & { statusCode: number };
    err.statusCode = 404;
    mockCallExternalService.mockRejectedValueOnce(err);
    const res = await request(createApp()).get("/public/stats/runs");
    expect(res.status).toBe(404);
  });
});
