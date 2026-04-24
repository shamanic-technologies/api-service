import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/brands/:id/transfer
 * Resolves Clerk org ID → internal UUID, then proxies to brand-service POST /orgs/brands/:id/transfer
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

const RESOLVED_TARGET_ORG_ID = "resolved-target-uuid";

const transferResult = {
  brandId: "brand-abc",
  sourceOrgId: "org_test456",
  targetOrgId: RESOLVED_TARGET_ORG_ID,
  serviceResults: {
    "campaign-service": { updatedTables: { campaigns: 3 } },
    "lead-service": { updatedTables: { leads: 12 } },
  },
};

function mockFetchResolveAndTransfer() {
  let brandServiceUrl = "";
  let brandServiceBody: Record<string, unknown> | undefined;
  let brandServiceHeaders: Record<string, string> = {};

  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};

    // client-service /resolve call
    if (String(url).includes("/resolve")) {
      return {
        ok: true,
        json: () => Promise.resolve({ orgId: RESOLVED_TARGET_ORG_ID, userId: "user_test123", orgCreated: false, userCreated: false }),
      };
    }

    // brand-service /transfer call
    brandServiceUrl = url;
    brandServiceBody = body;
    brandServiceHeaders = Object.fromEntries(
      Object.entries(init?.headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
    ) as Record<string, string>;
    return { ok: true, json: () => Promise.resolve(transferResult) };
  });

  return { getBrandServiceCall: () => ({ url: brandServiceUrl, body: brandServiceBody, headers: brandServiceHeaders }) };
}

describe("POST /v1/brands/:id/transfer", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("should resolve Clerk org ID and proxy to brand-service", async () => {
    const { getBrandServiceCall } = mockFetchResolveAndTransfer();

    const res = await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .set("x-external-user-id", "clerk_user_ext")
      .send({ targetOrgId: "org_clerk_target" });

    expect(res.status).toBe(200);
    const call = getBrandServiceCall();
    expect(call.url).toContain("/orgs/brands/brand-abc/transfer");
    expect(call.body).toEqual({ targetOrgId: RESOLVED_TARGET_ORG_ID });
  });

  it("should return the full transfer result from brand-service", async () => {
    mockFetchResolveAndTransfer();

    const res = await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .set("x-external-user-id", "clerk_user_ext")
      .send({ targetOrgId: "org_clerk_target" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(transferResult);
  });

  it("should forward identity headers to brand-service", async () => {
    const { getBrandServiceCall } = mockFetchResolveAndTransfer();

    await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .set("x-external-user-id", "clerk_user_ext")
      .send({ targetOrgId: "org_clerk_target" });

    const call = getBrandServiceCall();
    expect(call.headers["x-org-id"]).toBe("org_test456");
    expect(call.headers["x-user-id"]).toBe("user_test123");
  });

  it("should return 400 when targetOrgId is missing", async () => {
    const res = await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .set("x-external-user-id", "clerk_user_ext")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("targetOrgId is required");
  });

  it("should return 400 when x-external-user-id header is missing", async () => {
    const res = await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .send({ targetOrgId: "org_clerk_target" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("x-external-user-id");
  });

  it("should return 400 when target org resolves to same as source org", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/resolve")) {
        return {
          ok: true,
          json: () => Promise.resolve({ orgId: "org_test456", userId: "user_test123", orgCreated: false, userCreated: false }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const res = await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .set("x-external-user-id", "clerk_user_ext")
      .send({ targetOrgId: "org_same_as_source" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("same as the source");
  });

  it("should forward upstream error status from brand-service", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/resolve")) {
        return {
          ok: true,
          json: () => Promise.resolve({ orgId: RESOLVED_TARGET_ORG_ID, userId: "user_test123", orgCreated: false, userCreated: false }),
        };
      }
      return {
        ok: false,
        status: 403,
        text: () => Promise.resolve('{"error":"User is not a member of the target org"}'),
      };
    });

    const res = await request(app)
      .post("/v1/brands/brand-abc/transfer")
      .set("x-external-user-id", "clerk_user_ext")
      .send({ targetOrgId: "org_clerk_target" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("not a member");
  });
});
