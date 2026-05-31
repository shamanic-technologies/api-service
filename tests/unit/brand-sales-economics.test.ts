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

const populatedResponse = {
  salesEconomics: {
    lifetimeRevenueUsd: 50000,
    replyToMeetingPct: 30,
    visitToMeetingPct: 20,
    meetingToClosePct: 25,
    visitToClosePct: 5,
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
};

const nullResponse = { salesEconomics: null };

const putBody = {
  lifetimeRevenueUsd: 50000,
  replyToMeetingPct: 30,
  visitToMeetingPct: 20,
  meetingToClosePct: 25,
  visitToClosePct: 5,
};

describe("GET /v1/brands/:id/sales-economics", () => {
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
        json: () => Promise.resolve(populatedResponse),
      };
    });
  });

  it("should return the downstream payload verbatim on success", async () => {
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(populatedResponse);
  });

  it("should return { salesEconomics: null } verbatim when unset", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(nullResponse),
      };
    });

    const res = await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(nullResponse);
  });

  it("should forward to brand-service GET /orgs/brands/:id/sales-economics", async () => {
    await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics`);

    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/sales-economics`);
    expect(capturedInit?.method ?? "GET").toBe("GET");
  });

  it("should forward identity headers (x-org-id, x-user-id, x-run-id)", async () => {
    await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics`);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  it("should forward upstream 404 status + body verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"Brand not found"}'),
    }));

    const res = await request(app).get(`/v1/brands/${BRAND_ID}/sales-economics`);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Brand not found");
  });
});

describe("PUT /v1/brands/:id/sales-economics", () => {
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
        json: () => Promise.resolve(populatedResponse),
      };
    });
  });

  it("should return the downstream response verbatim on success", async () => {
    const res = await request(app).put(`/v1/brands/${BRAND_ID}/sales-economics`).send(putBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(populatedResponse);
  });

  it("should forward the body byte-identical (PUT) to brand-service /orgs/brands/:id/sales-economics", async () => {
    await request(app).put(`/v1/brands/${BRAND_ID}/sales-economics`).send(putBody);

    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/sales-economics`);
    expect(capturedInit?.method).toBe("PUT");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(putBody);
  });

  it("should forward identity headers (x-org-id, x-user-id, x-run-id)", async () => {
    await request(app).put(`/v1/brands/${BRAND_ID}/sales-economics`).send(putBody);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  it("should propagate an upstream 400 validation error verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve('{"error":"lifetimeRevenueUsd is required"}'),
    }));

    const res = await request(app).put(`/v1/brands/${BRAND_ID}/sales-economics`).send(putBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("lifetimeRevenueUsd is required");
  });
});
