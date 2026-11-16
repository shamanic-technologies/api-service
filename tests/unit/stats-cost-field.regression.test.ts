/**
 * Regression test: the stats endpoints must include totalCostInUsdCents
 * from runs-service (the ledger), read NET (STATS-NET-1116), not just emailgen/delivery stats.
 *
 * After PR #116/#117:
 * - The batch stats endpoint (POST /v1/campaigns/stats/batch) was removed
 * - Single campaign stats reads totalCostInUsdCents from runs-service /v1/stats/costs?groupBy=campaignId
 *   (net); campaign-service /stats/batch-budget is no longer read (it served gross)
 * - Cost breakdown uses runs-service /v1/stats/costs?groupBy=costName with { groups: [{ dimensions: { costName }, ... }] } format
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Campaign stats endpoints include totalCostInUsdCents", () => {
  const routePath = path.join(__dirname, "../../src/routes/campaigns.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should NOT read campaign-service /stats/batch-budget (gross spend)", () => {
    expect(content).not.toContain("/stats/batch-budget");
  });

  it("should set totalCostInUsdCents on the single stats response from the net spend", () => {
    expect(content).toContain("groupBy=campaignId");
    expect(content).toContain("stats.totalCostInUsdCents = netSpendCents(spendGroup)");
  });

  it("should NOT have a batch stats endpoint (removed in PR #116)", () => {
    // The POST /campaigns/stats/batch endpoint was removed
    expect(content).not.toContain('"/campaigns/stats/batch"');
  });

  it("should use runs-service /v1/stats/costs with groupBy=costName for cost breakdown", () => {
    expect(content).toContain("groupBy=costName");
    expect(content).toContain("externalServices.runs");
    // Response uses .groups with .dimensions.costName field
    expect(content).toContain("costBreakdown.groups");
    expect(content).toContain("g.dimensions.costName");
  });
});
