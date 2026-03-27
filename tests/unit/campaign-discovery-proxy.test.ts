import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const campaignsRoutePath = path.join(__dirname, "../../src/routes/campaigns.ts");
const content = fs.readFileSync(campaignsRoutePath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

describe("Campaign discovery proxy: outlets", () => {
  it("should have GET /campaigns/:id/outlets endpoint", () => {
    expect(content).toContain('"/campaigns/:id/outlets"');
    expect(content).toContain("router.get");
  });

  it("should use authenticate, requireOrg, requireUser middleware", () => {
    const outletsSection = content.slice(
      content.indexOf('"/campaigns/:id/outlets"'),
      content.indexOf('"/campaigns/:id/journalists"'),
    );
    expect(outletsSection).toContain("authenticate");
    expect(outletsSection).toContain("requireOrg");
    expect(outletsSection).toContain("requireUser");
  });

  it("should proxy to outlet-service with campaignId query param", () => {
    const outletsSection = content.slice(
      content.indexOf('"/campaigns/:id/outlets"'),
      content.indexOf('"/campaigns/:id/journalists"'),
    );
    expect(outletsSection).toContain("externalServices.outlet");
    expect(outletsSection).toContain("/outlets?campaignId=");
  });

  it("should forward internal headers", () => {
    const outletsSection = content.slice(
      content.indexOf('"/campaigns/:id/outlets"'),
      content.indexOf('"/campaigns/:id/journalists"'),
    );
    expect(outletsSection).toContain("buildInternalHeaders(req)");
  });

  it("should be a read-only GET (no method override)", () => {
    const outletsSection = content.slice(
      content.indexOf('"/campaigns/:id/outlets"'),
      content.indexOf('"/campaigns/:id/journalists"'),
    );
    expect(outletsSection).not.toContain('method:');
  });
});

describe("Campaign discovery proxy: journalists", () => {
  it("should have GET /campaigns/:id/journalists endpoint", () => {
    expect(content).toContain('"/campaigns/:id/journalists"');
    expect(content).toContain("router.get");
  });

  it("should use authenticate, requireOrg, requireUser middleware", () => {
    const journalistsSection = content.slice(
      content.indexOf('"/campaigns/:id/journalists"'),
    );
    expect(journalistsSection).toContain("authenticate");
    expect(journalistsSection).toContain("requireOrg");
    expect(journalistsSection).toContain("requireUser");
  });

  it("should NOT proxy to stale /campaign-outlet-journalists endpoint (removed upstream)", () => {
    expect(content).not.toContain("/campaign-outlet-journalists");
  });

  it("should fetch outlets from outlet-service then resolve journalists", () => {
    const journalistsSection = content.slice(
      content.indexOf('"/campaigns/:id/journalists"'),
    );
    expect(journalistsSection).toContain("externalServices.outlet");
    expect(journalistsSection).toContain("/internal/outlets/by-campaign/");
    expect(journalistsSection).toContain("externalServices.journalist");
    expect(journalistsSection).toContain("/journalists/resolve");
  });

  it("should forward internal headers", () => {
    const journalistsSection = content.slice(
      content.indexOf('"/campaigns/:id/journalists"'),
    );
    expect(journalistsSection).toContain("buildInternalHeaders(req)");
  });
});

describe("Campaign journalists: x-campaign-id header forwarding", () => {
  it("should explicitly set x-campaign-id from path param when calling journalist-service resolve", () => {
    const journalistsSection = content.slice(
      content.indexOf('"/campaigns/:id/journalists"'),
    );
    // The campaign ID from the URL path must be forwarded as x-campaign-id header
    // even when the caller does not send x-campaign-id in the request headers
    expect(journalistsSection).toContain('"x-campaign-id"');
  });
});

describe("Service client: outlet and journalist services", () => {
  it("should define outlet service config", () => {
    expect(serviceClientContent).toContain("OUTLETS_SERVICE_URL");
    expect(serviceClientContent).toContain("OUTLETS_SERVICE_API_KEY");
  });

  it("should define journalist service config", () => {
    expect(serviceClientContent).toContain("JOURNALISTS_SERVICE_URL");
    expect(serviceClientContent).toContain("JOURNALISTS_SERVICE_API_KEY");
  });
});

describe("OpenAPI schemas: campaign discovery endpoints", () => {
  it("should register /v1/campaigns/{id}/outlets path", () => {
    expect(schemaContent).toContain('path: "/v1/campaigns/{id}/outlets"');
    expect(schemaContent).toContain('tags: ["Campaigns"]');
  });

  it("should register /v1/campaigns/{id}/journalists path", () => {
    expect(schemaContent).toContain('path: "/v1/campaigns/{id}/journalists"');
  });

  it("should define CampaignOutletsResponse schema", () => {
    expect(schemaContent).toContain("CampaignOutletsResponse");
    expect(schemaContent).toContain("outletName");
    expect(schemaContent).toContain("outletUrl");
    expect(schemaContent).toContain("outletDomain");
    expect(schemaContent).toContain("relevanceScore");
    expect(schemaContent).toContain("whyRelevant");
  });

  it("should define CampaignJournalistsResponse schema with resolved journalist fields", () => {
    expect(schemaContent).toContain("CampaignJournalistsResponse");
    expect(schemaContent).toContain("journalistName");
    expect(schemaContent).toContain("entityType");
    expect(schemaContent).toContain("relevanceScore");
    expect(schemaContent).toContain("articleUrls");
  });
});
