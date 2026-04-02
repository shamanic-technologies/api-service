import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression: email-gateway /stats removed singular featureSlug/workflowSlug params.
 * Only plural forms (featureSlugs, workflowSlugs) are accepted.
 * See: email-gateway breaking change 2026-04-02.
 */
describe("Regression: email-gateway stats must use plural slug params", () => {
  const deliveryStats = fs.readFileSync(
    path.join(__dirname, "../../src/lib/delivery-stats.ts"),
    "utf-8",
  );
  const emailGatewayRoute = fs.readFileSync(
    path.join(__dirname, "../../src/routes/email-gateway.ts"),
    "utf-8",
  );

  it("delivery-stats.ts must NOT send singular featureSlug/workflowSlug to email-gateway", () => {
    // The for-loop that builds query params must use plural forms
    const paramsSection = deliveryStats.slice(
      deliveryStats.indexOf("URLSearchParams"),
      deliveryStats.indexOf("params.set(key"),
    );
    expect(paramsSection).toContain("featureSlugs");
    expect(paramsSection).toContain("workflowSlugs");
    expect(paramsSection).not.toMatch(/["']featureSlug["']/);
    expect(paramsSection).not.toMatch(/["']workflowSlug["']/);
  });

  it("email-gateway route must accept plural featureSlugs/workflowSlugs from callers", () => {
    const statsSection = emailGatewayRoute.slice(
      emailGatewayRoute.indexOf('"/email-gateway/stats"'),
    );
    expect(statsSection).toContain("featureSlugs");
    expect(statsSection).toContain("workflowSlugs");
    expect(statsSection).not.toMatch(/["']featureSlug["']/);
    expect(statsSection).not.toMatch(/["']workflowSlug["']/);
  });
});
