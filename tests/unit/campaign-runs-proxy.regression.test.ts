import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/campaigns.ts");
const routeContent = fs.readFileSync(routePath, "utf-8");

/**
 * Regression test: GET /v1/campaigns/:id/runs must proxy to runs-service
 * (NOT campaign-service). campaign-service has no /campaigns/{id}/runs endpoint;
 * the correct source is runs-service filtered by campaignId.
 *
 * Root cause: the original proxy called campaign-service at /campaigns/{id}/runs,
 * which returned 404 because that endpoint doesn't exist on campaign-service.
 */
describe("campaign runs proxy targets runs-service", () => {
  it("should proxy to externalServices.runs, not externalServices.campaign", () => {
    // Find the campaign runs route handler block
    const runsRouteIdx = routeContent.indexOf('"/campaigns/:id/runs"');
    expect(runsRouteIdx).toBeGreaterThan(-1);

    // Get the block from the route declaration to the next router.* call
    const afterRoute = routeContent.slice(runsRouteIdx);
    const nextRouteMatch = afterRoute.indexOf("\nrouter.", 10);
    const routeBlock = nextRouteMatch > 0 ? afterRoute.slice(0, nextRouteMatch) : afterRoute;

    expect(routeBlock).toContain("externalServices.runs");
    expect(routeBlock).not.toContain("externalServices.campaign");
  });

  it("should filter by campaignId query param", () => {
    const runsRouteIdx = routeContent.indexOf('"/campaigns/:id/runs"');
    const afterRoute = routeContent.slice(runsRouteIdx);
    const nextRouteMatch = afterRoute.indexOf("\nrouter.", 10);
    const routeBlock = nextRouteMatch > 0 ? afterRoute.slice(0, nextRouteMatch) : afterRoute;

    expect(routeBlock).toContain("campaignId");
  });

  it("should call runs-service /v1/runs path", () => {
    const runsRouteIdx = routeContent.indexOf('"/campaigns/:id/runs"');
    const afterRoute = routeContent.slice(runsRouteIdx);
    const nextRouteMatch = afterRoute.indexOf("\nrouter.", 10);
    const routeBlock = nextRouteMatch > 0 ? afterRoute.slice(0, nextRouteMatch) : afterRoute;

    expect(routeBlock).toContain("/v1/runs");
  });
});
