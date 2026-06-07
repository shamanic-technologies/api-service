import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.brandId = "brand_testabc";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import brandRouter from "../../src/routes/brand.js";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

const userSourceResponse = {
  economics: {
    lifetimeRevenueUsd: 50000,
    replyToMeetingPct: 30,
    visitToMeetingPct: 20,
    meetingToClosePct: 25,
    visitToClosePct: 5,
  },
  source: "user",
};

const averageSourceResponse = {
  economics: {
    lifetimeRevenueUsd: 42000,
    replyToMeetingPct: 28,
    visitToMeetingPct: 18,
    meetingToClosePct: 22,
    visitToClosePct: 4,
  },
  source: "cross-brand-average",
};

const nullResponse = { economics: null, source: null };

describe("GET /v1/brands/:id/sales-economics-effective", () => {
  let app: express.Express;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    capturedUrl = undefined;
    capturedInit = undefined;

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(userSourceResponse),
      };
    });
  });

  it("should return the downstream { economics, source: 'user' } payload verbatim", async () => {
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics-effective`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(userSourceResponse);
  });

  it("should return { economics, source: 'cross-brand-average' } verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(averageSourceResponse),
      };
    });

    const res = await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics-effective`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(averageSourceResponse);
  });

  it("should return { economics: null, source: null } verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(nullResponse),
      };
    });

    const res = await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics-effective`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(nullResponse);
  });

  it("should forward to brand-service GET /orgs/brands/:id/sales-economics-effective", async () => {
    await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics-effective`);

    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/sales-economics-effective`);
    expect(capturedInit?.method ?? "GET").toBe("GET");
  });

  it("should forward identity headers (x-org-id, x-user-id, x-run-id)", async () => {
    await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics-effective`);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  it("should forward upstream error status + body verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"downstream boom"}'),
    }));

    const res = await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics-effective`);

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("downstream boom");
  });
});
