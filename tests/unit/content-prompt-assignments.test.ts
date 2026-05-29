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

const getResponse = {
  featureSlug: "pr-expert-quote-opportunities",
  promptType: "expert-quote-pitch",
  prompt: "You are an expert at writing pitches for {{brands}}...",
  variables: [
    { name: "brands", description: "Array of brand profiles" },
    { name: "request", description: "Quote request details" },
  ],
  isDefault: false,
};

const putBody = {
  featureSlug: "pr-expert-quote-opportunities",
  prompt: "You are an expert at writing pitches for {{brands}}...",
  variables: [
    { name: "brands", description: "Array of brand profiles" },
    { name: "request", description: "Quote request details" },
  ],
};

describe("GET /v1/content/prompt-assignments", () => {
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
        json: () => Promise.resolve(getResponse),
      };
    });
  });

  it("should return the downstream payload verbatim on success", async () => {
    const res = await request(app)
      .get("/v1/content/prompt-assignments")
      .query({ featureSlug: "pr-expert-quote-opportunities" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(getResponse);
  });

  it("should forward ?featureSlug= query param to content-generation-service /prompt-assignments", async () => {
    await request(app)
      .get("/v1/content/prompt-assignments")
      .query({ featureSlug: "pr-expert-quote-opportunities" });

    expect(capturedUrl).toContain("/prompt-assignments");
    expect(capturedUrl).toContain("featureSlug=pr-expert-quote-opportunities");
  });

  it("should forward identity headers (x-org-id, x-user-id, x-run-id, x-brand-id)", async () => {
    await request(app)
      .get("/v1/content/prompt-assignments")
      .query({ featureSlug: "pr-expert-quote-opportunities" });

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
    expect(headers["x-brand-id"]).toBe("brand_testabc");
  });

  it("should send X-API-Key to downstream service", async () => {
    await request(app)
      .get("/v1/content/prompt-assignments")
      .query({ featureSlug: "pr-expert-quote-opportunities" });

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBeDefined();
  });

  it("should forward upstream 404 verbatim when featureSlug has no assignment", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"No prompt assignment for featureSlug \\"missing\\""}'),
    }));

    const res = await request(app)
      .get("/v1/content/prompt-assignments")
      .query({ featureSlug: "missing" });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("No prompt assignment");
  });

  it("should forward upstream 500 status verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal upstream error"),
    }));

    const res = await request(app)
      .get("/v1/content/prompt-assignments")
      .query({ featureSlug: "pr-expert-quote-opportunities" });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Internal upstream error");
  });
});

describe("PUT /v1/content/prompt-assignments", () => {
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
        json: () => Promise.resolve(getResponse),
      };
    });
  });

  it("should return the downstream response verbatim on success", async () => {
    const res = await request(app)
      .put("/v1/content/prompt-assignments")
      .send(putBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(getResponse);
  });

  it("should forward the body verbatim (PUT) to content-generation-service /prompt-assignments", async () => {
    await request(app)
      .put("/v1/content/prompt-assignments")
      .send(putBody);

    expect(capturedUrl).toContain("/prompt-assignments");
    expect(capturedInit?.method).toBe("PUT");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(putBody);
  });

  it("should forward identity headers (x-org-id, x-user-id, x-run-id, x-brand-id)", async () => {
    await request(app)
      .put("/v1/content/prompt-assignments")
      .send(putBody);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
    expect(headers["x-brand-id"]).toBe("brand_testabc");
  });

  it("should propagate a 400 variable-integrity error verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(
          '{"error":"Variable integrity violation: prompt references {{founders}} not declared in variables"}',
        ),
    }));

    const res = await request(app)
      .put("/v1/content/prompt-assignments")
      .send(putBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Variable integrity violation");
  });

  it("should forward upstream 500 status verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal upstream error"),
    }));

    const res = await request(app)
      .put("/v1/content/prompt-assignments")
      .send(putBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Internal upstream error");
  });
});
