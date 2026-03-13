/**
 * Regression test: GET /v1/campaigns/:id/stats/replies and
 * POST /v1/campaigns/stats/batch have been intentionally removed.
 *
 * - replies: the frontend should call email-gateway directly with
 *   GET /stats?groupBy=leadEmail instead of going through api-service.
 * - batch-stats: the frontend should call GET /v1/campaigns/:id/stats
 *   per campaign instead of a single batch endpoint.
 */
import { describe, it, expect, vi } from "vitest";

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
import campaignsRouter from "../../src/routes/campaigns.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignsRouter);
  return app;
}

describe("removed campaign stats endpoints", () => {
  it("GET /v1/campaigns/:id/stats/replies should return 404", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/campaigns/campaign-123/stats/replies");
    expect(res.status).toBe(404);
  });

  it("GET /v1/campaigns/:id/replies (old path) should return 404", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/campaigns/campaign-123/replies");
    expect(res.status).toBe(404);
  });

  it("POST /v1/campaigns/stats/batch should return 404", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/v1/campaigns/stats/batch")
      .send({ campaignIds: ["c1", "c2"] });
    expect(res.status).toBe(404);
  });

  it("GET /v1/campaigns/:id/stats should still work (not removed)", async () => {
    const app = createApp();
    mockCallExternalService.mockResolvedValue(null);
    const res = await request(app).get("/v1/campaigns/campaign-123/stats");
    // Should not be 404 — the single-campaign stats endpoint is still alive
    expect(res.status).not.toBe(404);
  });
});
