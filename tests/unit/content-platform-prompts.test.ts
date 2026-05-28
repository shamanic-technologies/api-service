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

import contentRouter from "../../src/routes/content.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", contentRouter);
  return app;
}

const upstreamResponse = {
  id: "prompt_abc123",
  type: "expert-quote-pitch",
  prompt: "You are an expert at writing pitches...",
  variables: [
    { name: "brands", description: "Array of brand profiles" },
    { name: "request", description: "Quote request details" },
  ],
  createdAt: "2026-05-27T10:00:00Z",
  updatedAt: "2026-05-27T10:00:00Z",
};

describe("GET /v1/content/platform-prompts", () => {
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
        json: () => Promise.resolve(upstreamResponse),
      };
    });
  });

  it("should return the downstream payload verbatim on success", async () => {
    const res = await request(app)
      .get("/v1/content/platform-prompts")
      .query({ type: "expert-quote-pitch" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstreamResponse);
  });

  it("should forward ?type= query param to content-generation-service /platform-prompts", async () => {
    await request(app)
      .get("/v1/content/platform-prompts")
      .query({ type: "expert-quote-pitch" });

    expect(capturedUrl).toContain("/platform-prompts");
    expect(capturedUrl).toContain("type=expert-quote-pitch");
  });

  it("should forward identity headers (x-org-id, x-user-id, x-run-id, x-brand-id)", async () => {
    await request(app)
      .get("/v1/content/platform-prompts")
      .query({ type: "expert-quote-pitch" });

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
    expect(headers["x-brand-id"]).toBe("brand_testabc");
  });

  it("should send X-API-Key to downstream service", async () => {
    await request(app)
      .get("/v1/content/platform-prompts")
      .query({ type: "expert-quote-pitch" });

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBeDefined();
  });

  it("should forward upstream 404 verbatim when prompt type does not exist", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"Prompt type \\"missing\\" not found"}'),
    }));

    const res = await request(app)
      .get("/v1/content/platform-prompts")
      .query({ type: "missing" });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });

  it("should forward upstream 500 status verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal upstream error"),
    }));

    const res = await request(app)
      .get("/v1/content/platform-prompts")
      .query({ type: "expert-quote-pitch" });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Internal upstream error");
  });

  it("should still proxy when ?type is missing (downstream owns validation)", async () => {
    await request(app).get("/v1/content/platform-prompts");

    expect(capturedUrl).toContain("/platform-prompts");
    // Express stringifies an empty query as "" — gateway must not invent ?type=
    expect(capturedUrl).not.toContain("type=");
  });
});
