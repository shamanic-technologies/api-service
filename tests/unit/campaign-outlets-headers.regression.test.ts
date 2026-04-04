import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const campaignsRoutePath = path.join(__dirname, "../../src/routes/campaigns.ts");
const content = fs.readFileSync(campaignsRoutePath, "utf-8");

describe("Campaign outlets: header enrichment from campaign data (regression)", () => {
  const outletsSection = content.slice(
    content.indexOf('"/campaigns/:id/outlets"'),
    content.indexOf('"/campaigns/:id/journalists"'),
  );

  it("should fetch campaign from campaign-service to resolve metadata", () => {
    expect(outletsSection).toContain("externalServices.campaign");
    expect(outletsSection).toContain("/campaigns/");
  });

  it("should explicitly set x-campaign-id from path param", () => {
    expect(outletsSection).toContain('"x-campaign-id"');
  });

  it("should forward x-brand-id resolved from campaign data to outlet-service", () => {
    expect(outletsSection).toContain('"x-brand-id"');
    expect(outletsSection).toContain("campaign.brandIds");
  });

  it("should forward x-feature-slug and x-workflow-slug from campaign data", () => {
    expect(outletsSection).toContain('"x-feature-slug"');
    expect(outletsSection).toContain("campaign.featureSlug");
    expect(outletsSection).toContain('"x-workflow-slug"');
    expect(outletsSection).toContain("campaign.workflowSlug");
  });

  it("should spread enriched headers into the outlet-service call (not just baseHeaders)", () => {
    // The call to outlet-service should use the enriched `headers` object, not `buildInternalHeaders(req)` directly
    const outletCallIdx = outletsSection.indexOf("externalServices.outlet");
    const outletCallBlock = outletsSection.slice(outletCallIdx, outletCallIdx + 200);
    expect(outletCallBlock).toContain("{ headers }");
  });
});
