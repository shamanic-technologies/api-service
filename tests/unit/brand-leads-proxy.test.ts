import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/leads.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const openapiPath = path.join(__dirname, "../../openapi.json");
const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

describe("Brand-level GET /leads route", () => {
  it("should have GET /leads with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/leads"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should require brandId or campaignId query param", () => {
    expect(content).toContain('"Missing required query parameter: brandId or campaignId"');
  });

  it("should forward brandId and campaignId to lead-service when present", () => {
    expect(content).toContain('params.set("brandId", brandId)');
    expect(content).toContain('params.set("campaignId", campaignId)');
  });

  it("should forward view to lead-service when present", () => {
    expect(content).toContain('params.set("view", view)');
  });

  it("should call lead-service /orgs/leads endpoint (single call, no /status)", () => {
    expect(content).toContain("externalServices.lead");
    expect(content).toContain("`/orgs/leads?${params}`");
    expect(content).not.toContain("/orgs/leads/status");
  });

  it("should be pure pass-through: no field mapping, no enrichment flattening, no runs aggregation", () => {
    const leadsRoute = content.slice(
      content.indexOf('router.get("/leads"'),
      content.indexOf('router.post("/leads/search"')
    );
    expect(leadsRoute).not.toContain("enrichment.firstName");
    expect(leadsRoute).not.toContain("enrichment.lastName");
    expect(leadsRoute).not.toContain("raw.enrichment");
    expect(leadsRoute).not.toContain("raw.metadata");
    expect(leadsRoute).not.toContain("getRunsBatch");
    expect(leadsRoute).not.toContain("enrichmentRun");
    expect(leadsRoute).not.toContain("rawLeads.map");
  });

  it("should use buildInternalHeaders", () => {
    expect(content).toContain("buildInternalHeaders(req)");
  });

  it("should return 400 when both brandId and campaignId are missing", () => {
    const brandIdCheckSection = content.slice(
      content.indexOf('router.get("/leads"'),
      content.indexOf('router.post("/leads/search"')
    );
    expect(brandIdCheckSection).toContain("res.status(400)");
  });

  it("should not import @distribute/runs-client (no aggregation)", () => {
    expect(content).not.toContain("@distribute/runs-client");
    expect(content).not.toContain("RunWithCosts");
  });
});

describe("Brand-level GET /leads OpenAPI schema", () => {
  it("should register GET /v1/leads in schemas.ts", () => {
    expect(schemaContent).toContain('path: "/v1/leads"');
  });

  it("should have brandId and campaignId query params in OpenAPI spec (both optional)", () => {
    const leadsPath = openapi.paths["/v1/leads"];
    expect(leadsPath).toBeDefined();
    expect(leadsPath.get).toBeDefined();
    const params = leadsPath.get.parameters || [];
    const brandIdParam = params.find(
      (p: { name: string; in: string }) => p.name === "brandId" && p.in === "query"
    );
    expect(brandIdParam).toBeDefined();
    expect(brandIdParam.required).toBeFalsy();
    const campaignIdParam = params.find(
      (p: { name: string; in: string }) => p.name === "campaignId" && p.in === "query"
    );
    expect(campaignIdParam).toBeDefined();
    const viewParam = params.find(
      (p: { name: string; in: string }) => p.name === "view" && p.in === "query"
    );
    expect(viewParam).toBeDefined();
    expect(viewParam.required).toBeFalsy();
  });

  it("should have 200, 400, 401, 500 responses", () => {
    const leadsOp = openapi.paths["/v1/leads"]?.get;
    expect(leadsOp).toBeDefined();
    expect(leadsOp.responses["200"]).toBeDefined();
    expect(leadsOp.responses["400"]).toBeDefined();
    expect(leadsOp.responses["401"]).toBeDefined();
    expect(leadsOp.responses["500"]).toBeDefined();
  });
});
