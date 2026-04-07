/**
 * Regression test: ensures campaign emails endpoint
 * has full response schema in the OpenAPI spec.
 *
 * Campaign leads endpoints were removed — leads are served
 * via GET /v1/leads?campaignId=X (in leads.ts).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const openapiPath = path.join(__dirname, "../../openapi.json");
const spec = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

describe("Campaign emails OpenAPI response schemas", () => {
  it("GET /v1/campaigns/{id}/emails should have a 200 response schema", () => {
    const endpoint = spec.paths?.["/v1/campaigns/{id}/emails"]?.get;
    expect(endpoint).toBeDefined();
    const schema =
      endpoint.responses?.["200"]?.content?.["application/json"]?.schema;
    expect(schema).toBeDefined();
    const resolved = schema.$ref
      ? spec.components.schemas[schema.$ref.split("/").pop()!]
      : schema;
    expect(resolved.properties?.emails).toBeDefined();
  });

  it("CampaignEmailsResponse should document key email fields", () => {
    const emailsSchema = spec.components?.schemas?.CampaignEmailsResponse;
    expect(emailsSchema).toBeDefined();
    const emailProps =
      emailsSchema.properties.emails.items.properties;
    for (const field of [
      "id",
      "subject",
      "bodyHtml",
      "bodyText",
      "sequence",
      "leadFirstName",
      "leadLastName",
      "leadCompany",
      "leadOrganizationDomain",
      "leadTitle",
      "leadIndustry",
      "clientCompanyName",
      "generationRun",
      "createdAt",
    ]) {
      expect(emailProps).toHaveProperty(field);
    }
  });

  it("RunCostData schema should be defined in components", () => {
    expect(spec.components?.schemas?.RunCostData).toBeDefined();
    const props = spec.components.schemas.RunCostData.properties;
    expect(props).toHaveProperty("status");
    expect(props).toHaveProperty("totalCostInUsdCents");
    expect(props).toHaveProperty("costs");
  });

  it("GET /v1/campaigns/{id}/leads should NOT exist (moved to GET /v1/leads)", () => {
    expect(spec.paths?.["/v1/campaigns/{id}/leads"]).toBeUndefined();
  });

  it("GET /v1/campaigns/{id}/leads/status should NOT exist (removed)", () => {
    expect(spec.paths?.["/v1/campaigns/{id}/leads/status"]).toBeUndefined();
  });
});
