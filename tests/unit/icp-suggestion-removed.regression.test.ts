import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import * as fs from "fs";
import * as path from "path";

/**
 * POST /v1/brand/icp-suggestion forwarded to brand-service /orgs/icp-suggestion,
 * a path that service has never served, so the route answered every call with
 * `Cannot POST /orgs/icp-suggestion`. It was registered and declared in the
 * OpenAPI schemas, so it advertised itself in the API registry as a supported
 * endpoint. It is gone.
 *
 * The capability lives on the per-brand route below, which brand-service does
 * serve — that one must keep working.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "admin";
    next();
  },
  authenticatePlatform: (req: any, _res: any, next: any) => {
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

function createBrandApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

describe("the dead ICP suggestion route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("no longer answers POST /v1/brand/icp-suggestion", async () => {
    global.fetch = vi.fn();

    const res = await request(createBrandApp())
      .post("/v1/brand/icp-suggestion")
      .send({ brandUrl: "https://example.com" });

    expect(res.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("is not advertised in the generated openapi document", () => {
    const spec = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../openapi.json"), "utf-8")
    );

    expect(Object.keys(spec.paths)).not.toContain("/v1/brand/icp-suggestion");
    expect(Object.keys(spec.components?.schemas ?? {})).not.toContain("IcpSuggestionRequest");
    expect(Object.keys(spec.components?.schemas ?? {})).not.toContain("IcpSuggestionResponse");
  });

  it("nothing in the source forwards to brand-service /orgs/icp-suggestion", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/routes/brand.ts"),
      "utf-8"
    );

    expect(src).not.toContain("/orgs/icp-suggestion");
    expect(src).not.toContain("/brand/icp-suggestion");
  });
});

describe("the per-brand ICP suggestion route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("still forwards POST /v1/brands/:id/icp/suggest to brand-service", async () => {
    let capturedUrl: string | undefined;

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ icp: "Ops leads at 50-200 person SaaS" }),
      };
    });

    const res = await request(createBrandApp())
      .post("/v1/brands/brand_abc/icp/suggest")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ icp: "Ops leads at 50-200 person SaaS" });
    expect(capturedUrl).toContain("/orgs/brands/brand_abc/icp/suggest");
  });
});
