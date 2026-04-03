import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/emails.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const openapiPath = path.join(__dirname, "../../openapi.json");
const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

describe("Brand-level GET /emails route", () => {
  it("should have GET /emails with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/emails"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should require brandId query param", () => {
    expect(content).toContain('"Missing required query parameter: brandId"');
  });

  it("should forward brandId and optional campaignId to emailgen service", () => {
    expect(content).toContain('params.set("brandId", brandId)');
    expect(content).toContain('params.set("campaignId", campaignId)');
  });

  it("should call content-generation-service /generations endpoint", () => {
    expect(content).toContain("externalServices.emailgen");
    expect(content).toContain("`/generations?${params}`");
  });

  it("should batch-fetch run costs via getRunsBatch", () => {
    expect(content).toContain("getRunsBatch");
  });

  it("should use buildInternalHeaders", () => {
    expect(content).toContain("buildInternalHeaders(req)");
  });

  it("should return 400 when brandId is missing", () => {
    const emailGetSection = content.slice(
      content.indexOf('router.get("/emails"'),
      content.indexOf('router.post("/emails/send"')
    );
    expect(emailGetSection).toContain("res.status(400)");
  });

  it("should return empty array when no emails found", () => {
    expect(content).toContain('res.json({ emails: [] })');
  });

  it("should GET /emails route be registered before POST /emails/send", () => {
    const getIdx = content.indexOf('router.get("/emails"');
    const postIdx = content.indexOf('router.post("/emails/send"');
    expect(getIdx).toBeLessThan(postIdx);
  });
});

describe("Brand-level GET /emails OpenAPI schema", () => {
  it("should register GET /v1/emails in schemas.ts", () => {
    expect(schemaContent).toContain('path: "/v1/emails"');
  });

  it("should have brandId query param in OpenAPI spec", () => {
    const emailsPath = openapi.paths["/v1/emails"];
    expect(emailsPath).toBeDefined();
    expect(emailsPath.get).toBeDefined();
    const params = emailsPath.get.parameters || [];
    const brandIdParam = params.find(
      (p: { name: string; in: string }) => p.name === "brandId" && p.in === "query"
    );
    expect(brandIdParam).toBeDefined();
    expect(brandIdParam.required).toBe(true);
  });

  it("should use BrandEmailsResponse schema name", () => {
    expect(schemaContent).toContain("BrandEmailsResponse");
  });

  it("should have 200, 400, 401, 500 responses", () => {
    const emailsOp = openapi.paths["/v1/emails"]?.get;
    expect(emailsOp).toBeDefined();
    expect(emailsOp.responses["200"]).toBeDefined();
    expect(emailsOp.responses["400"]).toBeDefined();
    expect(emailsOp.responses["401"]).toBeDefined();
    expect(emailsOp.responses["500"]).toBeDefined();
  });
});

describe("Discoveries already supports brandId (no changes needed)", () => {
  it("should have brandId in discoveries OpenAPI query params", () => {
    const discoveriesPath = openapi.paths["/v1/discoveries"];
    expect(discoveriesPath).toBeDefined();
    expect(discoveriesPath.get).toBeDefined();
    const params = discoveriesPath.get.parameters || [];
    const brandIdParam = params.find(
      (p: { name: string; in: string }) => p.name === "brandId" && p.in === "query"
    );
    expect(brandIdParam).toBeDefined();
  });
});
