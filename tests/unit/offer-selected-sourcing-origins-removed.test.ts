import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.hoisted(() => {
  process.env.BRAND_SERVICE_URL = "http://brand.test.local";
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
});

/**
 * The per-offer "selected sourcing origins" ticks were retired (2026-10-07): each lead
 * source is now its own campaign with On/Off and a budget. The gateway routes and their
 * openapi entries are gone; brand-service drops the table behind them.
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.authType = "user_key";
      next();
    },
  };
});

import brandRouter from "../../src/routes/brand.js";

const OFFER = "/brands/75d7e3e8-6926-4f85-a557-976895400666/offers/0d3d1f2c-8f4a-4a2e-9d1b-2f0f6a7c5b31";

describe("retired offer selected sourcing origins", () => {
  it.each(["get", "put"] as const)("%s is not routed and never reaches brand-service", async (method) => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const app = express();
    app.use(express.json());
    app.use("/v1", brandRouter);
    const res = await request(app)[method](`/v1${OFFER}/selected-sourcing-origins`).send({ originSlugs: [] });
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is absent from the published openapi", () => {
    const raw = readFileSync(resolve(__dirname, "../../openapi.json"), "utf-8");
    expect(raw).not.toContain("selected-sourcing-origins");
    expect(raw).not.toContain("SelectedSourcingOrigins");
  });
});
