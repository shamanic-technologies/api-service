/**
 * Regression test: the performance leaderboard crashed with a 502 when
 * brand-service's /org-ids endpoint rejected the call due to missing
 * x-org-id/x-user-id headers (admin requests without org context).
 *
 * Fix: catch the error in fetchAllBrands so the leaderboard degrades
 * gracefully (returns workflow data without brands) instead of crashing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallExternalService = vi.fn();

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
  externalServices: {
    client: { url: "http://mock-client", apiKey: "k" },
    emailgen: { url: "http://mock-emailgen", apiKey: "k" },
    emailGateway: { url: "http://mock-email", apiKey: "k" },
    campaign: { url: "http://mock-campaign", apiKey: "k" },
    lead: { url: "http://mock-lead", apiKey: "k" },
    key: { url: "http://mock-key", apiKey: "k" },
    replyQualification: { url: "http://mock-rq", apiKey: "k" },
    scraping: { url: "http://mock-scraping", apiKey: "k" },
    transactionalEmail: { url: "http://mock-transactional-email", apiKey: "k" },
    brand: { url: "http://mock-brand", apiKey: "k" },
    runs: { url: "http://mock-runs", apiKey: "k" },
    instantly: { url: "http://mock-instantly", apiKey: "k" },
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
import performanceRouter from "../../src/routes/performance.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(performanceRouter);
  return app;
}

describe("GET /performance/leaderboard — graceful brand-service failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with empty brands when brand-service /org-ids rejects with missing headers", async () => {
    const app = createApp();

    mockCallExternalService.mockImplementation((service: any, path: string) => {
      // brand-service /org-ids rejects (missing required headers)
      if (path === "/org-ids") {
        return Promise.reject(new Error("Missing required headers"));
      }
      // runs-service returns workflow stats
      if (path.includes("/v1/stats/public/leaderboard") && path.includes("workflowName")) {
        return Promise.resolve({ groups: [{ dimensions: { workflowName: "sales-email-cold-outreach-sienna" }, totalCostInUsdCents: "1000.0000", actualCostInUsdCents: "800.0000", provisionedCostInUsdCents: "200.0000", cancelledCostInUsdCents: "0", runCount: 5 }] });
      }
      // runs-service brand costs
      if (path.includes("/v1/stats/public/leaderboard") && path.includes("brandId")) {
        return Promise.resolve({ groups: [] });
      }
      // instantly stats
      if (path === "/stats" || path === "/stats/grouped") {
        return Promise.resolve({ stats: {}, groups: [] });
      }
      // run-ids-by-workflow
      if (path.includes("/v1/stats/run-ids-by-workflow")) {
        return Promise.resolve({ groups: {} });
      }
      return Promise.resolve({});
    });

    const res = await request(app).get("/performance/leaderboard");

    expect(res.status).toBe(200);
    // Brands are empty because brand-service failed
    expect(res.body.brands).toEqual([]);
    // Workflows still present from runs-service
    expect(res.body.workflows.length).toBeGreaterThan(0);
    expect(res.body.workflows[0].workflowName).toBe("sales-email-cold-outreach-sienna");
  });
});
