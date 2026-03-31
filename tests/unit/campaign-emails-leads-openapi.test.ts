/**
 * Regression test: ensures campaign leads and emails endpoints
 * have full response schemas in the OpenAPI spec.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const openapiPath = path.join(__dirname, "../../openapi.json");
const spec = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

describe("Campaign leads/emails OpenAPI response schemas", () => {
  it("GET /v1/campaigns/{id}/leads should have a 200 response schema", () => {
    const endpoint = spec.paths?.["/v1/campaigns/{id}/leads"]?.get;
    expect(endpoint).toBeDefined();
    const schema =
      endpoint.responses?.["200"]?.content?.["application/json"]?.schema;
    expect(schema).toBeDefined();
    // Should reference CampaignLeadsResponse or inline leads array
    const resolved = schema.$ref
      ? spec.components.schemas[schema.$ref.split("/").pop()!]
      : schema;
    expect(resolved.properties?.leads).toBeDefined();
  });

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

  it("CampaignLeadsResponse should document key lead fields", () => {
    const leadsSchema = spec.components?.schemas?.CampaignLeadsResponse;
    expect(leadsSchema).toBeDefined();
    const leadProps =
      leadsSchema.properties.leads.items.properties;
    for (const field of [
      "id",
      "leadId",
      "email",
      "namespace",
      "firstName",
      "lastName",
      "title",
      "organizationName",
      "organizationDomain",
      "organizationLogoUrl",
      "enrichmentRun",
    ]) {
      expect(leadProps).toHaveProperty(field);
    }
  });

  it("GET /v1/campaigns/{id}/leads/status should have a 200 response schema", () => {
    const endpoint = spec.paths?.["/v1/campaigns/{id}/leads/status"]?.get;
    expect(endpoint).toBeDefined();
    const schema =
      endpoint.responses?.["200"]?.content?.["application/json"]?.schema;
    expect(schema).toBeDefined();
    const resolved = schema.$ref
      ? spec.components.schemas[schema.$ref.split("/").pop()!]
      : schema;
    expect(resolved.properties?.statuses).toBeDefined();
  });

  it("CampaignLeadsStatusResponse should document delivery status fields", () => {
    const statusSchema = spec.components?.schemas?.CampaignLeadsStatusResponse;
    expect(statusSchema).toBeDefined();
    const statusProps =
      statusSchema.properties.statuses.items.properties;
    for (const field of [
      "leadId",
      "email",
      "contacted",
      "delivered",
      "bounced",
      "replied",
      "lastDeliveredAt",
    ]) {
      expect(statusProps).toHaveProperty(field);
    }
  });

  it("RunCostData schema should be defined in components", () => {
    expect(spec.components?.schemas?.RunCostData).toBeDefined();
    const props = spec.components.schemas.RunCostData.properties;
    expect(props).toHaveProperty("status");
    expect(props).toHaveProperty("totalCostInUsdCents");
    expect(props).toHaveProperty("costs");
  });
});
