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

  it("should require brandId query param", () => {
    expect(content).toContain('"Missing required query parameter: brandId"');
  });

  it("should forward brandId and optional campaignId to lead-service", () => {
    expect(content).toContain('params.set("brandId", brandId)');
    expect(content).toContain('params.set("campaignId", campaignId)');
  });

  it("should call lead-service /orgs/leads endpoint (single call, no /status)", () => {
    expect(content).toContain("externalServices.lead");
    expect(content).toContain("`/orgs/leads?${params}`");
    expect(content).not.toContain("/orgs/leads/status");
  });

  it("should NOT use Promise.all to merge two endpoints", () => {
    // After lead-service PR #171, status fields are on the lead object directly
    const leadsRoute = content.slice(
      content.indexOf('router.get("/leads"'),
      content.indexOf('router.post("/leads/search"')
    );
    expect(leadsRoute).not.toContain("Promise.all");
    expect(leadsRoute).not.toContain("statusByEmail");
  });

  it("should read status fields directly from each lead object", () => {
    expect(content).toContain("raw.contacted");
    expect(content).toContain("raw.delivered");
    expect(content).toContain("raw.bounced");
    expect(content).toContain("raw.replied");
    expect(content).toContain("raw.replyClassification");
  });

  it("should flatten enrichment data into each lead", () => {
    expect(content).toContain("enrichment.firstName");
    expect(content).toContain("enrichment.lastName");
    expect(content).toContain("enrichment.title");
  });

  it("should compute contacted status from delivery data", () => {
    expect(content).toContain('raw.contacted ? "contacted" : "served"');
  });

  it("should batch-fetch run costs via getRunsBatch", () => {
    expect(content).toContain("getRunsBatch");
  });

  it("should use buildInternalHeaders", () => {
    expect(content).toContain("buildInternalHeaders(req)");
  });

  it("should return 400 when brandId is missing", () => {
    const brandIdCheckSection = content.slice(
      content.indexOf('router.get("/leads"'),
      content.indexOf('router.post("/leads/search"')
    );
    expect(brandIdCheckSection).toContain("res.status(400)");
  });
});

describe("Brand-level GET /leads OpenAPI schema", () => {
  it("should register GET /v1/leads in schemas.ts", () => {
    expect(schemaContent).toContain('path: "/v1/leads"');
  });

  it("should have brandId query param in OpenAPI spec", () => {
    const leadsPath = openapi.paths["/v1/leads"];
    expect(leadsPath).toBeDefined();
    expect(leadsPath.get).toBeDefined();
    const params = leadsPath.get.parameters || [];
    const brandIdParam = params.find(
      (p: { name: string; in: string }) => p.name === "brandId" && p.in === "query"
    );
    expect(brandIdParam).toBeDefined();
    expect(brandIdParam.required).toBe(true);
  });

  it("should use BrandLeadsResponse schema name", () => {
    expect(schemaContent).toContain("BrandLeadsResponse");
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
