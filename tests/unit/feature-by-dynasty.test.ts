import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Tests for GET /v1/features/by-dynasty/:dynastySlug proxy endpoint.
 * Verifies the route forwards to features-service and handles responses correctly.
 */

let fetchCalls: Array<{ url: string; method?: string }> = [];

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "admin";
    next();
  },
  requireOrg: (req: any, res: any, next: any) => {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    next();
  },
  requireUser: (req: any, res: any, next: any) => {
    if (!req.userId) return res.status(401).json({ error: "User identity required" });
    next();
  },
  AuthenticatedRequest: {},
}));

import featuresRouter from "../../src/routes/features.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

describe("GET /v1/features/by-dynasty/:dynastySlug", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
  });

  it("should proxy to features-service /features/by-dynasty/:dynastySlug", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method });
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          feature: {
            slug: "pr-cold-email-outreach-v3",
            dynastySlug: "pr-cold-email-outreach",
            name: "PR Cold Email Outreach",
            status: "active",
          },
        }),
      };
    });

    const app = createApp();
    const res = await request(app).get("/v1/features/by-dynasty/pr-cold-email-outreach");

    expect(res.status).toBe(200);
    expect(res.body.feature.dynastySlug).toBe("pr-cold-email-outreach");
    expect(res.body.feature.status).toBe("active");

    const call = fetchCalls.find((c) => c.url.includes("/features/by-dynasty/pr-cold-email-outreach"));
    expect(call).toBeDefined();
  });

  it("should return 404 when no active feature exists for the dynasty slug", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method });
      const error: any = new Error("No active feature for dynasty slug 'nonexistent-feature'");
      error.statusCode = 404;
      throw error;
    });

    const app = createApp();
    const res = await request(app).get("/v1/features/by-dynasty/nonexistent-feature");

    expect(res.status).toBe(404);
  });

  it("should URL-encode the dynasty slug in the upstream call", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method });
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ feature: { slug: "test" } }),
      };
    });

    const app = createApp();
    await request(app).get("/v1/features/by-dynasty/slug%20with%20spaces");

    const call = fetchCalls.find((c) => c.url.includes("/features/by-dynasty/"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("/features/by-dynasty/slug%20with%20spaces");
  });

  it("should not conflict with GET /features/:slug route", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method });
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ feature: { slug: "pr-cold-email-outreach-v3" } }),
      };
    });

    const app = createApp();

    // Dynasty route
    await request(app).get("/v1/features/by-dynasty/pr-cold-email-outreach");
    const dynastyCall = fetchCalls.find((c) => c.url.includes("/features/by-dynasty/"));
    expect(dynastyCall).toBeDefined();

    // Regular slug route
    fetchCalls = [];
    await request(app).get("/v1/features/pr-cold-email-outreach-v3");
    const slugCall = fetchCalls.find((c) => c.url.includes("/features/pr-cold-email-outreach-v3") && !c.url.includes("by-dynasty"));
    expect(slugCall).toBeDefined();
  });
});
