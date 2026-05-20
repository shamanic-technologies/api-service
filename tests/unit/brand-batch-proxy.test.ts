import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Regression test: GET /v1/brands/by-ids must forward to brand-service
 * GET /internal/brands?ids=<csv> with the csv preserved byte-for-byte.
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

import brandRouter from "../../src/routes/brand.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

describe("GET /v1/brands/by-ids (batch passthrough)", () => {
  let capturedUrls: string[];

  beforeEach(() => {
    capturedUrls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrls.push(url);
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            brands: [
              { id: "brand-a", url: "https://a.com", name: "A" },
              { id: "brand-b", url: "https://b.com", name: "B" },
            ],
          }),
      };
    });
  });

  it("forwards to /internal/brands?ids=<csv>", async () => {
    const res = await request(buildApp()).get("/v1/brands/by-ids?ids=brand-a,brand-b");
    expect(res.status).toBe(200);
    const call = capturedUrls.find((u) => u.includes("/internal/brands"));
    expect(call).toBeDefined();
    expect(call).toContain("/internal/brands?ids=brand-a%2Cbrand-b");
  });

  it("returns 400 when ids query param is missing", async () => {
    const res = await request(buildApp()).get("/v1/brands/by-ids");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids query param/i);
  });

  it("returns 400 when ids query param is empty", async () => {
    const res = await request(buildApp()).get("/v1/brands/by-ids?ids=");
    expect(res.status).toBe(400);
  });

  it("does NOT match the /v1/brands/:id single-brand route", async () => {
    await request(buildApp()).get("/v1/brands/by-ids?ids=brand-a");
    const singleCall = capturedUrls.find((u) => u.includes("/internal/brands/by-ids"));
    expect(singleCall).toBeUndefined();
  });

  it("forwards upstream response body verbatim", async () => {
    const res = await request(buildApp()).get("/v1/brands/by-ids?ids=brand-a,brand-b");
    expect(res.body).toEqual({
      brands: [
        { id: "brand-a", url: "https://a.com", name: "A" },
        { id: "brand-b", url: "https://b.com", name: "B" },
      ],
    });
  });
});
