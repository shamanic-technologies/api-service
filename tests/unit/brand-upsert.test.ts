import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/brands
 * Upsert a brand from a URL → returns { brandId }
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

describe("POST /v1/brands – upsert brand", () => {
  let app: express.Express;
  let capturedBody: Record<string, unknown> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    capturedBody = undefined;

    global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return { ok: true, json: () => Promise.resolve({ brandId: "brand-abc" }) };
    });
  });

  it("should return brandId on successful upsert", async () => {
    const res = await request(app)
      .post("/v1/brands")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ brandId: "brand-abc" });
  });

  it("should forward url, orgId, userId to brand-service", async () => {
    await request(app)
      .post("/v1/brands")
      .send({ url: "https://example.com" });

    expect(capturedBody).toEqual({
      url: "https://example.com",
      orgId: "org_test456",
      userId: "user_test123",
    });
  });

  it("should return 400 when url is missing", async () => {
    const res = await request(app)
      .post("/v1/brands")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 500 when brand-service fails", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"Connection refused"}'),
    }));

    const res = await request(app)
      .post("/v1/brands")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Connection refused");
  });
});
