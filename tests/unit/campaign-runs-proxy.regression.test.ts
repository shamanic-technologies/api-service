import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const runsRoutePath = path.join(__dirname, "../../src/routes/runs.ts");
const runsRouteContent = fs.readFileSync(runsRoutePath, "utf-8");

const campaignsRoutePath = path.join(__dirname, "../../src/routes/campaigns.ts");
const campaignsRouteContent = fs.readFileSync(campaignsRoutePath, "utf-8");

const openapiPath = path.join(__dirname, "../../openapi.json");
const openapiContent = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

/**
 * Regression test: runs must be listed via GET /v1/runs (transparent proxy to
 * runs-service), NOT via a fabricated /v1/campaigns/:id/runs path on campaign-service
 * which doesn't exist (was returning 404).
 */
describe("runs list proxy targets runs-service", () => {
  it("GET /runs route exists in runs.ts and proxies to externalServices.runs", () => {
    expect(runsRouteContent).toContain('"/runs"');
    expect(runsRouteContent).toContain("externalServices.runs");
    expect(runsRouteContent).toContain("/v1/runs");
  });

  it("campaigns.ts does NOT have a /campaigns/:id/runs route", () => {
    expect(campaignsRouteContent).not.toContain("/campaigns/:id/runs");
  });

  it("OpenAPI spec has /v1/runs, not /v1/campaigns/{id}/runs", () => {
    expect(openapiContent.paths).toHaveProperty("/v1/runs");
    expect(openapiContent.paths).not.toHaveProperty("/v1/campaigns/{id}/runs");
  });
});
