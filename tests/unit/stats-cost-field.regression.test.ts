/**
 * Regression test: the stats endpoints must include totalCostInUsdCents
 * from campaign-service batch-budget-usage, not just emailgen/delivery stats.
 *
 * After PR #116/#117:
 * - The batch stats endpoint (POST /v1/campaigns/stats/batch) was removed
 * - Single campaign stats still includes totalCostInUsdCents from campaign-service /stats/batch-budget
 * - Cost breakdown uses runs-service /v1/stats/costs?groupBy=costName with { groups: [{ key, ... }] } format
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Campaign stats endpoints include totalCostInUsdCents", () => {
  const routePath = path.join(__dirname, "../../src/routes/campaigns.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should call campaign-service /stats/batch-budget for budget usage", () => {
    expect(content).toContain("/stats/batch-budget");
    expect(content).toContain("externalServices.campaign");
  });

  it("should set totalCostInUsdCents on the single stats response", () => {
    // The single endpoint assigns totalCostInUsdCents from budgetUsage
    expect(content).toContain("stats.totalCostInUsdCents = budgetUsage.results[id].totalCostInUsdCents");
  });

  it("should NOT have a batch stats endpoint (removed in PR #116)", () => {
    // The POST /campaigns/stats/batch endpoint was removed
    expect(content).not.toContain('"/campaigns/stats/batch"');
  });

  it("should use runs-service /v1/stats/costs with groupBy=costName for cost breakdown", () => {
    expect(content).toContain("groupBy=costName");
    expect(content).toContain("externalServices.runs");
    // Response uses .groups with .key field
    expect(content).toContain("costBreakdown.groups");
    expect(content).toContain("g.key");
  });
});
