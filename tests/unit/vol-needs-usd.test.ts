import { describe, it, expect } from "vitest";
import { buildDocument } from "../../src/openapi/document.js";

// VOL-NEEDS-USD-1124 (owner 2026-11-24): a campaign that states a MAX VOLUME also states a MAX BUDGET in $.
// billing-service refuses a volume-only caps write; the published document tells every agent before it tries.
const CAPS_PUTS = [
  "/v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps",
  "/v1/brands/{brandId}/sales-funnels/{salesFunnelId}/caps",
  "/v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/campaigns/{salesFunnelCampaignId}/caps",
  "/v1/brands/{brandId}/sales-funnels/{salesFunnelId}/campaigns/{salesFunnelCampaignId}/caps",
];

describe("VOL-NEEDS-USD-1124: a max volume needs a max budget in $", () => {
  const doc = buildDocument() as any;

  it.each(CAPS_PUTS)("PUT %s says a max volume needs a max $ beside it, and names billing's refusal", (path) => {
    const description: string = doc.paths[path].put.description;
    expect(description).toContain("A max volume needs a max budget in $ beside it");
    expect(description).toContain("max_budget_required_with_max_volume");
    expect(description).toContain("never invent the $ amount");
    expect(description).toContain("A max budget alone is valid");
  });

  it("no published text says max $ and/or max volume", () => {
    expect(JSON.stringify(doc)).not.toMatch(/budget and\/or (max )?volume/i);
  });

  it("POST /v1/campaigns documents maxLeads as a volume that needs a max budget", () => {
    const body = doc.paths["/v1/campaigns"].post.requestBody.content["application/json"].schema;
    const schema = body.$ref ? doc.components.schemas[body.$ref.split("/").pop()] : body;
    expect(schema.properties.maxLeads.description).toContain("state a max budget in USD");
  });
});
