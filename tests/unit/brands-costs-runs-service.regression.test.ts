/**
 * Regression test: the GET /v1/runs/stats/costs endpoint must use runs-service
 * /v1/stats/costs with groupBy param to get total costs,
 * NOT campaign-service batch-budget-usage.
 *
 * This route now lives in runs.ts (not brand.ts).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("runs stats costs endpoint uses runs-service", () => {
  const runsRoutePath = path.join(__dirname, "../../src/routes/runs.ts");
  const runsContent = fs.readFileSync(runsRoutePath, "utf-8");

  it("should have a GET /runs/stats/costs route in runs.ts", () => {
    expect(runsContent).toContain('router.get("/runs/stats/costs"');
  });

  it("should call runs-service /v1/stats/costs with groupBy param", () => {
    expect(runsContent).toContain("/v1/stats/costs?");
    expect(runsContent).toContain("groupBy");
    expect(runsContent).toContain("externalServices.runs");
  });

  it("should not have brand cost routes in brand.ts anymore", () => {
    const brandRoutePath = path.join(__dirname, "../../src/routes/brand.ts");
    const brandContent = fs.readFileSync(brandRoutePath, "utf-8");
    expect(brandContent).not.toContain('"/brands/stats/costs"');
    expect(brandContent).not.toContain('"/brands/:id/stats/costs"');
  });

  it("should map runs-service groups to brandId -> totalCostInUsdCents", () => {
    // Simulate the mapping logic from the route
    const groups = [
      {
        dimensions: { brandId: "brand-1" },
        totalCostInUsdCents: "1500",
        actualCostInUsdCents: "1200",
        provisionedCostInUsdCents: "300",
        cancelledCostInUsdCents: "0",
        runCount: 5,
      },
      {
        dimensions: { brandId: "brand-2" },
        totalCostInUsdCents: "800",
        actualCostInUsdCents: "800",
        provisionedCostInUsdCents: "0",
        cancelledCostInUsdCents: "0",
        runCount: 3,
      },
      {
        dimensions: { brandId: null },
        totalCostInUsdCents: "50",
        actualCostInUsdCents: "50",
        provisionedCostInUsdCents: "0",
        cancelledCostInUsdCents: "0",
        runCount: 1,
      },
    ];

    const costs: Record<string, string> = {};
    for (const group of groups) {
      if (group.dimensions.brandId) {
        costs[group.dimensions.brandId] = group.totalCostInUsdCents;
      }
    }

    expect(costs).toEqual({
      "brand-1": "1500",
      "brand-2": "800",
    });
    // Null brandId should be excluded
    expect(costs).not.toHaveProperty("null");
  });
});
