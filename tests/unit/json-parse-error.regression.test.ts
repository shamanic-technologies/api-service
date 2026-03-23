import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Regression: callExternalService used `return response.json()` without `await`.
 * When the upstream returned 200 but the body was malformed/truncated JSON,
 * the parse error escaped the try/catch in callExternalService — so no
 * `[callExternalService]` log appeared. Route handlers still caught the error
 * and returned 500, but the missing log made these 500s silent and hard to debug.
 *
 * Fix: `return await response.json()` so parse errors are caught and logged
 * inside callExternalService.
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

describe("callExternalService – malformed JSON response handling", () => {
  let app: express.Express;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should return 500 and log error when upstream returns 200 with truncated JSON", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
    }));

    const res = await request(app).get("/v1/brands/test-brand");

    expect(res.status).toBe(500);
    // The fix ensures callExternalService logs the error before re-throwing
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[callExternalService]"),
      expect.stringContaining("Unexpected end of JSON input"),
    );
  });

  it("should return 500 and log error when upstream returns 200 with HTML body", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
    }));

    const res = await request(app).get("/v1/brands/test-brand");

    expect(res.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[callExternalService]"),
      expect.stringContaining("Unexpected token"),
    );
  });

  it("should return 500 for runs endpoint when brand-service returns malformed JSON", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
    }));

    const res = await request(app).get("/v1/brands/test-brand/runs");

    expect(res.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[callExternalService]"),
      expect.stringContaining("Unexpected end of JSON input"),
    );
  });

  it("should return 500 for POST brands when brand-service returns malformed JSON", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
    }));

    const res = await request(app)
      .post("/v1/brands")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[callExternalService]"),
      expect.stringContaining("Unexpected end of JSON input"),
    );
  });
});
