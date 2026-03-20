import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
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
  videoUrl: "https://example.com/video.mp4",
  name: "Sophie",
  age: 34,
  theme: "Loss of Desire",
  text: "Le texte du quote...",
  outputBlobToken: "vercel_blob_rw_abc123",
};

describe("POST /v1/content/compose", () => {
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
        json: () => Promise.resolve({ composedVideoUrl: "https://blob.vercel.com/composed.mp4" }),
      };
    });
  });

  it("should return composedVideoUrl on success", async () => {
    const res = await request(app)
      .post("/v1/content/compose")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ composedVideoUrl: "https://blob.vercel.com/composed.mp4" });
  });

  it("should forward body to content-generation-service /compose", async () => {
    await request(app)
      .post("/v1/content/compose")
      .send(validBody);

    expect(capturedUrl).toContain("/compose");
    const body = JSON.parse(capturedInit?.body as string);
    expect(body).toEqual(validBody);
  });

  it("should forward internal headers (x-org-id, x-user-id, x-run-id)", async () => {
    await request(app)
      .post("/v1/content/compose")
      .send(validBody);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  it("should send X-API-Key to downstream service", async () => {
    await request(app)
      .post("/v1/content/compose")
      .send(validBody);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBeDefined();
  });

  it("should return 400 when videoUrl is missing", async () => {
    const { videoUrl, ...noVideo } = validBody;
    const res = await request(app)
      .post("/v1/content/compose")
      .send(noVideo);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 400 when videoUrl is invalid", async () => {
    const res = await request(app)
      .post("/v1/content/compose")
      .send({ ...validBody, videoUrl: "not-a-url" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 400 when age is not a number", async () => {
    const res = await request(app)
      .post("/v1/content/compose")
      .send({ ...validBody, age: "thirty-four" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should forward upstream error status", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 503,
      text: () => Promise.resolve('{"error":"Service unavailable"}'),
    }));

    const res = await request(app)
      .post("/v1/content/compose")
      .send(validBody);

    expect(res.status).toBe(503);
    expect(res.body.error).toContain("Service unavailable");
  });

  it("should return 500 when upstream returns unexpected error", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    }));

    const res = await request(app)
      .post("/v1/content/compose")
      .send(validBody);

    expect(res.status).toBe(500);
  });
});
