import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Regression: POST /v1/brand/icp-suggestion and POST /v1/workflows/generate
 * called callExternalService without buildInternalHeaders(req), so x-org-id
 * and x-user-id were never sent to brand-service / workflow-service.
 * Downstream services that call key-service need these headers to resolve keys.
 */

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

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import brandRouter from "../../src/routes/brand.js";

import * as fs from "fs";
import * as path from "path";

describe("internal headers on downstream calls", () => {
  let capturedHeaders: Record<string, string> | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    capturedHeaders = undefined;
  });

  it("POST /v1/brand/icp-suggestion should send x-org-id and x-user-id to brand-service", async () => {
    global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (typeof _url === "string" && _url.includes("/icp-suggestion")) {
        const h = init?.headers as Record<string, string>;
        capturedHeaders = h;
        return { ok: true, json: () => Promise.resolve({ icp: {} }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    const app = express();
    app.use(express.json());
    app.use("/v1", brandRouter);

    await request(app)
      .post("/v1/brand/icp-suggestion")
      .send({ brandUrl: "https://example.com" });

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders!["x-org-id"]).toBe("org_test456");
    expect(capturedHeaders!["x-user-id"]).toBe("user_test123");
  });

  it("workflows/generate route should include buildInternalHeaders", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/routes/workflows.ts"),
      "utf-8"
    );

    const generateIdx = src.indexOf('router.post("/workflows/generate"');
    expect(generateIdx).toBeGreaterThan(-1);

    const afterGenerate = src.slice(generateIdx);
    const callIdx = afterGenerate.indexOf("callExternalService");
    const callBlock = afterGenerate.slice(callIdx, callIdx + 300);

    expect(callBlock).toContain("headers: buildInternalHeaders(req)");
  });
});
