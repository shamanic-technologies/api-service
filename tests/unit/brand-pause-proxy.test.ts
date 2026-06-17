import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET/PATCH /v1/brands/:brandId/pause must forward to CAMPAIGN-SERVICE
 * /brands/:brandId/pause (campaign-service owns the pause flag), NOT brand-service.
 * Existing /v1/brands/* brand-service routes must remain unaffected by the
 * brand-pause router being mounted first.
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

import brandPauseRouter from "../../src/routes/brand-pause.js";
import brandRouter from "../../src/routes/brand.js";

// Defaults from src/lib/service-client.ts when env unset.
const CAMPAIGN_BASE = "http://localhost:3004";
const BRAND_BASE = "https://brand.distribute.you";

function buildApp() {
  const app = express();
  app.use(express.json());
  // Same mount order as src/index.ts: pause router before brand router.
  app.use("/v1", brandPauseRouter);
  app.use("/v1", brandRouter);
  return app;
}

describe("GET /v1/brands/:brandId/pause → campaign-service", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ brandId: "brand-1", orgId: "org_test456", paused: true, updatedAt: "2026-06-17T00:00:00Z" }),
      };
    });
  });

  it("forwards to campaign-service /brands/:brandId/pause", async () => {
    const res = await request(buildApp()).get("/v1/brands/brand-1/pause");
    expect(res.status).toBe(200);
    const call = calls.find((c) => c.url.includes("/brands/brand-1/pause"));
    expect(call).toBeDefined();
    expect(call!.url.startsWith(CAMPAIGN_BASE)).toBe(true);
    expect(call!.url).not.toContain(BRAND_BASE);
  });

  it("returns the campaign-service body verbatim", async () => {
    const res = await request(buildApp()).get("/v1/brands/brand-1/pause");
    expect(res.body).toEqual({
      brandId: "brand-1",
      orgId: "org_test456",
      paused: true,
      updatedAt: "2026-06-17T00:00:00Z",
    });
  });
});

describe("PATCH /v1/brands/:brandId/pause → campaign-service", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ brandId: "brand-1", orgId: "org_test456", paused: false, updatedAt: "2026-06-17T01:00:00Z" }),
      };
    });
  });

  it("forwards PATCH with body unchanged to campaign-service", async () => {
    const res = await request(buildApp()).patch("/v1/brands/brand-1/pause").send({ paused: false });
    expect(res.status).toBe(200);
    const call = calls.find((c) => c.url.includes("/brands/brand-1/pause"));
    expect(call).toBeDefined();
    expect(call!.url.startsWith(CAMPAIGN_BASE)).toBe(true);
    expect(call!.options.method).toBe("PATCH");
    expect(JSON.parse(call!.options.body)).toEqual({ paused: false });
  });

  it("returns the updated body verbatim", async () => {
    const res = await request(buildApp()).patch("/v1/brands/brand-1/pause").send({ paused: false });
    expect(res.body).toEqual({
      brandId: "brand-1",
      orgId: "org_test456",
      paused: false,
      updatedAt: "2026-06-17T01:00:00Z",
    });
  });
});

describe("no regression: brand-service brand routes unaffected", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "brand-1", name: "A" }),
      };
    });
  });

  it("GET /v1/brands/:id still forwards to brand-service, not campaign-service", async () => {
    const res = await request(buildApp()).get("/v1/brands/brand-1");
    expect(res.status).toBe(200);
    const call = calls.find((c) => c.url.includes("/brands/brand-1") || c.url.includes("brand-1"));
    expect(call).toBeDefined();
    expect(call!.url.startsWith(BRAND_BASE)).toBe(true);
    expect(call!.url.startsWith(CAMPAIGN_BASE)).toBe(false);
  });
});
