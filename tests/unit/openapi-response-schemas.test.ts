import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const specPath = path.join(__dirname, "../../openapi.json");
const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));

// Endpoints exempt from response schema requirement:
// - Meta-endpoints that don't return JSON
// - Transparent proxy endpoints where the response shape is defined by the downstream service
const EXEMPT_ENDPOINTS = new Set([
  "GET /debug/config",
  "GET /openapi.json",
  "POST /v1/outlets",
  "POST /v1/outlets/bulk",
  "POST /v1/outlets/search",
  "GET /v1/outlets/{id}",
  "PATCH /v1/outlets/{id}",
  "PATCH /v1/outlets/{id}/status",
]);

describe("OpenAPI spec — response schemas", () => {
  const endpoints: { key: string; method: string; path: string }[] = [];

  for (const [p, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(
      methods as Record<string, any>,
    )) {
      if (method === "parameters") continue;
      const key = `${method.toUpperCase()} ${p}`;
      endpoints.push({ key, method, path: p });
    }
  }

  it("should have response schemas for all client-facing endpoints", () => {
    const missing: string[] = [];

    for (const { key, method, path: p } of endpoints) {
      if (EXEMPT_ENDPOINTS.has(key)) continue;

      const operation = spec.paths[p][method];
      const successCode = Object.keys(operation.responses).find(
        (c) => c === "200" || c === "201",
      );
      if (!successCode) continue;

      const response = operation.responses[successCode];
      if (!response.content) {
        missing.push(key);
      }
    }

    expect(
      missing,
      `These endpoints are missing response schemas:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("should define workflow response schemas with proper field types", () => {
    const schemas = spec.components.schemas;

    // WorkflowMetadata uses createdForBrandId
    expect(schemas.WorkflowMetadata.properties).toHaveProperty(
      "createdForBrandId",
    );
    expect(schemas.WorkflowMetadata.properties).not.toHaveProperty("brandId");

    // Ranked & best responses — pass-through from features-service
    expect(schemas).toHaveProperty("RankedResponse");
    expect(schemas).toHaveProperty("BestResponse");
  });

  it("should define campaign response schema with all key fields", () => {
    const campaign = spec.components.schemas.Campaign;
    expect(campaign.properties).toHaveProperty("id");
    expect(campaign.properties).toHaveProperty("name");
    expect(campaign.properties).toHaveProperty("workflowSlug");
    expect(campaign.properties).toHaveProperty("status");
    expect(campaign.properties).toHaveProperty("brandIds");
  });

  it("should define brand response schemas", () => {
    const schemas = spec.components.schemas;
    expect(schemas).toHaveProperty("BrandSummary");
    expect(schemas).toHaveProperty("BrandDetail");
    // BrandDetail extends BrandSummary via allOf
    const brandDetailStr = JSON.stringify(schemas.BrandDetail);
    expect(brandDetailStr).toContain("bio");
    expect(brandDetailStr).toContain("mission");
  });

  it("should define billing response schemas", () => {
    const schemas = spec.components.schemas;
    expect(schemas).toHaveProperty("BillingAccountResponse");
    expect(schemas).toHaveProperty("BalanceResponse");
    expect(schemas.BalanceResponse.properties).toHaveProperty("depleted");
  });
});
