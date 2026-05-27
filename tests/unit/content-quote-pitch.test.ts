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

const validBody = {
  quoteRequestId: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  campaignId: "33333333-3333-4333-8333-333333333333",
  spokesperson: "Sophie",
  expertiseTopics: ["growth", "retention"],
  responseStyle: "concise",
  companyContext: "B2B SaaS",
  valueProposition: "Predictable revenue.",
};

const upstreamResponse = {
  pitch: "Sophie is a B2B SaaS growth expert ...",
  charCount: 1234,
  attempts: 1,
  tokensInput: 567,
  tokensOutput: 890,
};

describe("POST /v1/content/generate-expert-quote-pitch", () => {
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
      .post("/v1/content/generate-expert-quote-pitch")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstreamResponse);
  });

  it("should forward body verbatim to content-generation-service /generate-expert-quote-pitch", async () => {
    await request(app)
      .post("/v1/content/generate-expert-quote-pitch")
      .send(validBody);

    expect(capturedUrl).toContain("/generate-expert-quote-pitch");
    const body = JSON.parse(capturedInit?.body as string);
    expect(body).toEqual(validBody);
  });

  it("should forward identity headers (x-org-id, x-user-id, x-run-id, x-brand-id)", async () => {
    await request(app)
      .post("/v1/content/generate-expert-quote-pitch")
      .send(validBody);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
    expect(headers["x-brand-id"]).toBe("brand_testabc");
  });

  it("should send X-API-Key to downstream service", async () => {
    await request(app)
      .post("/v1/content/generate-expert-quote-pitch")
      .send(validBody);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBeDefined();
  });

  it("should forward upstream error status verbatim (400 length error)", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"Pitch exceeded 2500 chars after 3 attempts"}'),
    }));

    const res = await request(app)
      .post("/v1/content/generate-expert-quote-pitch")
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Pitch exceeded 2500 chars");
  });

  it("should forward upstream 503 status verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 503,
      text: () => Promise.resolve("Service unavailable"),
    }));

    const res = await request(app)
      .post("/v1/content/generate-expert-quote-pitch")
      .send(validBody);

    expect(res.status).toBe(503);
  });
});
