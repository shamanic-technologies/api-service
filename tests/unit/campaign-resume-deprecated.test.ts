import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

// Mock auth middleware
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.appId = "distribute";
    req.authType = "user_key";
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

// Mock runs-client
vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import campaignRouter from "../../src/routes/campaigns.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignRouter);
  return app;
}

describe("POST /v1/campaigns/:id/resume — deprecated", () => {
  it("returns 410 Gone with deprecation message", async () => {
    const app = createApp();
    const res = await request(app).post("/v1/campaigns/camp_123/resume");

    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/deprecated/i);
    expect(res.body.error).toMatch(/new campaign/i);
  });

  it("is marked deprecated in the OpenAPI spec", async () => {
    const spec = await import("../../openapi.json");
    const path = spec.default.paths["/v1/campaigns/{id}/resume"];
    expect(path).toBeDefined();
    expect(path.post.deprecated).toBe(true);
  });
});
