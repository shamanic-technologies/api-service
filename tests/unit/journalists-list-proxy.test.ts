import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/journalists.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const openapiPath = path.join(__dirname, "../../openapi.json");
const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

describe("GET /journalists/list route", () => {
  it("should have GET /journalists/list with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/journalists/list"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should require brandId query param", () => {
    const listSection = content.slice(
      content.indexOf('"/journalists/list"'),
      content.indexOf("// ── POST /v1/journalists/discover")
    );
    expect(listSection).toContain('"Missing required query parameter: brandId"');
  });

  it("should forward brandId, campaignId, featureSlugs, and workflowSlug", () => {
    const listSection = content.slice(
      content.indexOf('"/journalists/list"'),
      content.indexOf("// ── POST /v1/journalists/discover")
    );
    expect(listSection).toContain('params.set("brandId", brandId)');
    expect(listSection).toContain('"campaignId"');
    expect(listSection).toContain('"featureSlugs"');
    expect(listSection).toContain('"workflowSlug"');
  });

  it("should NOT forward removed featureSlug (singular)", () => {
    const listSection = content.slice(
      content.indexOf('"/journalists/list"'),
      content.indexOf("// ── POST /v1/journalists/discover")
    );
    const keys = listSection.match(/"(\w+)"/g)?.map((k) => k.replace(/"/g, "")) || [];
    expect(keys).not.toContain("featureSlug");
  });

  it("should proxy to journalists-service /journalists/list", () => {
    expect(content).toContain("`/journalists/list?${params}`");
  });

  it("should use buildInternalHeaders", () => {
    const listSection = content.slice(
      content.indexOf('"/journalists/list"'),
      content.indexOf("// ── POST /v1/journalists/discover")
    );
    expect(listSection).toContain("buildInternalHeaders(req)");
  });

  it("should be registered before /journalists/discover to avoid route conflict", () => {
    const listIdx = content.indexOf('"/journalists/list"');
    const discoverIdx = content.indexOf('"/journalists/discover"');
    expect(listIdx).toBeLessThan(discoverIdx);
  });

  it("should be registered before /journalists/stats to avoid route conflict", () => {
    const listIdx = content.indexOf('"/journalists/list"');
    const statsIdx = content.indexOf('"/journalists/stats"');
    expect(listIdx).toBeLessThan(statsIdx);
  });
});

describe("GET /journalists/list OpenAPI schema", () => {
  it("should register GET /v1/journalists/list in schemas.ts", () => {
    expect(schemaContent).toContain('path: "/v1/journalists/list"');
  });

  it("should use JournalistListResponse schema name", () => {
    expect(schemaContent).toContain("JournalistListResponse");
  });

  it("should define JournalistEmailStatusSchema", () => {
    expect(schemaContent).toContain("JournalistEmailStatusSchema");
  });

  it("should define JournalistCostSchema", () => {
    expect(schemaContent).toContain("JournalistCostSchema");
  });

  it("should define JournalistCampaignEntry for nested campaigns[]", () => {
    expect(schemaContent).toContain("JournalistCampaignEntry");
  });

  it("should have brandId in OpenAPI spec as required query param", () => {
    const listPath = openapi.paths["/v1/journalists/list"];
    expect(listPath).toBeDefined();
    expect(listPath.get).toBeDefined();
    const params = listPath.get.parameters || [];
    const brandIdParam = params.find(
      (p: { name: string; in: string }) => p.name === "brandId" && p.in === "query"
    );
    expect(brandIdParam).toBeDefined();
    expect(brandIdParam.required).toBe(true);
  });

  it("should have optional campaignId in OpenAPI spec", () => {
    const listPath = openapi.paths["/v1/journalists/list"];
    const params = listPath.get.parameters || [];
    const campaignIdParam = params.find(
      (p: { name: string; in: string }) => p.name === "campaignId" && p.in === "query"
    );
    expect(campaignIdParam).toBeDefined();
    expect(campaignIdParam.required).toBeFalsy();
  });

  it("should have optional featureSlugs in OpenAPI spec", () => {
    const listPath = openapi.paths["/v1/journalists/list"];
    const params = listPath.get.parameters || [];
    const param = params.find(
      (p: { name: string; in: string }) => p.name === "featureSlugs" && p.in === "query"
    );
    expect(param).toBeDefined();
    expect(param.required).toBeFalsy();
  });

  it("should have optional workflowSlug in OpenAPI spec", () => {
    const listPath = openapi.paths["/v1/journalists/list"];
    const params = listPath.get.parameters || [];
    const param = params.find(
      (p: { name: string; in: string }) => p.name === "workflowSlug" && p.in === "query"
    );
    expect(param).toBeDefined();
    expect(param.required).toBeFalsy();
  });

  it("should have 200, 400, 401 responses", () => {
    const op = openapi.paths["/v1/journalists/list"]?.get;
    expect(op).toBeDefined();
    expect(op.responses["200"]).toBeDefined();
    expect(op.responses["400"]).toBeDefined();
    expect(op.responses["401"]).toBeDefined();
  });

  it("should include emailStatus, cost, and campaigns[] in response schema", () => {
    const ref =
      openapi.paths["/v1/journalists/list"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref;
    expect(ref).toBe("#/components/schemas/JournalistListResponse");
    const schema = openapi.components?.schemas?.JournalistListResponse;
    expect(schema).toBeDefined();
    const journalistProps = schema.properties?.journalists?.items?.properties;
    expect(journalistProps).toBeDefined();
    expect(journalistProps.emailStatus).toBeDefined();
    expect(journalistProps.cost).toBeDefined();
    expect(journalistProps.campaigns).toBeDefined();
    // campaigns[] items use a $ref to JournalistCampaignEntry
    const campaignEntryRef = journalistProps.campaigns.items?.$ref;
    expect(campaignEntryRef).toBe("#/components/schemas/JournalistCampaignEntry");
    const campaignEntry = openapi.components?.schemas?.JournalistCampaignEntry;
    expect(campaignEntry).toBeDefined();
    expect(campaignEntry.properties.status).toBeDefined();
    expect(campaignEntry.properties.relevanceScore).toBeDefined();
    expect(campaignEntry.properties.campaignId).toBeDefined();
  });

  it("should NOT have flat campaign fields at journalist top level", () => {
    const schema = openapi.components?.schemas?.JournalistListResponse;
    const journalistProps = schema.properties?.journalists?.items?.properties;
    // These moved inside campaigns[]
    expect(journalistProps.campaignId).toBeUndefined();
    expect(journalistProps.orgId).toBeUndefined();
    expect(journalistProps.brandIds).toBeUndefined();
    expect(journalistProps.status).toBeUndefined();
    expect(journalistProps.runId).toBeUndefined();
  });
});
