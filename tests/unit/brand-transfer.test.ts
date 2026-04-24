import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/brands/:id/transfer
 * Proxy to brand-service POST /orgs/brands/:id/transfer
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

describe("POST /v1/brands/:id/transfer", () => {
  let app: express.Express;
  let capturedUrl: string;
  let capturedBody: Record<string, unknown> | undefined;
  let capturedHeaders: Record<string, string>;

  const transferResult = {
    brandId: "brand-abc",
    sourceOrgId: "org_test456",
    targetOrgId: "org_target789",
    serviceResults: {
      "campaign-service": { updatedTables: { campaigns: 3 } },
      "lead-service": { updatedTables: { leads: 12 } },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    capturedUrl = "";
    capturedBody = undefined;
    capturedHeaders = {};

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string);
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
      ) as Record<string, string>;
      return { ok: true, json: () => Promise.resolve(transferResult) };
    });
  });

  it("should proxy to brand-service /orgs/brands/:id/transfer", async () => {
    const res = await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .send({ targetOrgId: "org_target789" });

    expect(res.status).toBe(200);
    expect(capturedUrl).toContain("/orgs/brands/brand-abc/transfer");
    expect(capturedBody).toEqual({ targetOrgId: "org_target789" });
  });

  it("should return the full transfer result from brand-service", async () => {
    const res = await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .send({ targetOrgId: "org_target789" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(transferResult);
  });

  it("should forward identity headers", async () => {
    await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .send({ targetOrgId: "org_target789" });

    expect(capturedHeaders["x-org-id"]).toBe("org_test456");
    expect(capturedHeaders["x-user-id"]).toBe("user_test123");
  });

  it("should return 400 when targetOrgId is missing", async () => {
    const res = await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("targetOrgId is required");
  });

  it("should forward upstream error status", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 403,
      text: () => Promise.resolve('{"error":"User is not a member of the target org"}'),
    }));

    const res = await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .send({ targetOrgId: "org_target789" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("not a member");
  });
});
