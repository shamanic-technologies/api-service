import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/outlets.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

describe("Outlets proxy routes", () => {
  it("should have GET /outlets with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/outlets"') && !l.includes("/:id") && !l.includes("/stats")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward query params on GET /outlets", () => {
    for (const param of ["campaignId", "brandId", "status", "runId", "limit", "offset"]) {
      expect(content).toContain(`"${param}"`);
    }
  });

  it("should have GET /outlets/stats with auth", () => {
    expect(content).toContain('"/outlets/stats"');
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/outlets/stats"')
    );
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward groupBy on GET /outlets/stats", () => {
    expect(content).toContain('"groupBy"');
    expect(content).toContain('"workflowSlug"');
  });

  it("should forward workflowSlugs and featureSlugs on GET /outlets/stats", () => {
    expect(content).toContain('"workflowSlugs"');
    expect(content).toContain('"featureSlugs"');
  });

  it("should have POST /outlets with auth", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/outlets"') && !l.includes("/bulk") && !l.includes("/search") && !l.includes("/discover")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should return 201 on POST /outlets", () => {
    expect(content).toContain("res.status(201)");
  });

  it("should have POST /outlets/bulk with auth", () => {
    expect(content).toContain('"/outlets/bulk"');
  });

  it("should have POST /outlets/search with auth", () => {
    expect(content).toContain('"/outlets/search"');
  });

  it("should have POST /outlets/discover with auth", () => {
    expect(content).toContain('"/outlets/discover"');
  });

  it("should have POST /outlets/buffer/next with auth", () => {
    const line = content.split("\n").find((l: string) =>
      l.includes("router.post") && l.includes('"/outlets/buffer/next"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have GET /outlets/:id with auth", () => {
    expect(content).toContain('"/outlets/:id"');
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/outlets/:id"')
    );
    expect(line).toContain("authenticate");
  });

  it("should have PATCH /outlets/:id with auth", () => {
    const patchLine = content.split("\n").find((l) =>
      l.includes("router.patch") && l.includes('"/outlets/:id"') && !l.includes("/status")
    );
    expect(patchLine).toBeDefined();
    expect(patchLine).toContain("authenticate");
  });

  it("should have PATCH /outlets/:id/status with auth", () => {
    expect(content).toContain('"/outlets/:id/status"');
  });

  it("should forward campaignId query param on PATCH /outlets/:id/status", () => {
    const statusSection = content.slice(content.indexOf('"/outlets/:id/status"'));
    expect(statusSection).toContain("campaignId");
  });

  it("should use buildInternalHeaders for all endpoints", () => {
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(11);
  });

  it("should proxy to externalServices.outlet", () => {
    expect(content).toContain("externalServices.outlet");
  });

  it("should have GET /outlets/stats/costs with auth", () => {
    const line = content.split("\n").find((l: string) =>
      l.includes("router.get") && l.includes('"/outlets/stats/costs"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward query params on GET /outlets/stats/costs", () => {
    const costSection = content.slice(content.indexOf('"/outlets/stats/costs"'));
    expect(costSection).toContain('"brandId"');
    expect(costSection).toContain('"campaignId"');
    expect(costSection).toContain('"groupBy"');
  });

  it("should register static routes before parameterized :id route", () => {
    const statsIdx = content.indexOf('"/outlets/stats"');
    const statsCostsIdx = content.indexOf('"/outlets/stats/costs"');
    const bulkIdx = content.indexOf('"/outlets/bulk"');
    const searchIdx = content.indexOf('"/outlets/search"');
    const discoverIdx = content.indexOf('"/outlets/discover"');
    const bufferNextIdx = content.indexOf('"/outlets/buffer/next"');
    const idIdx = content.indexOf('"/outlets/:id"');
    expect(statsIdx).toBeLessThan(idIdx);
    expect(statsCostsIdx).toBeLessThan(idIdx);
    expect(bulkIdx).toBeLessThan(idIdx);
    expect(searchIdx).toBeLessThan(idIdx);
    expect(discoverIdx).toBeLessThan(idIdx);
    expect(bufferNextIdx).toBeLessThan(idIdx);
  });

  it("should enforce requireOrg + requireUser on ALL outlet routes", () => {
    const routeLines = content.split("\n").filter((l) =>
      /router\.(get|post|patch)\(/.test(l) && l.includes('"/')
    );
    expect(routeLines.length).toBeGreaterThan(0);
    for (const line of routeLines) {
      expect(line).toContain("authenticate");
      expect(line).toContain("requireOrg");
      expect(line).toContain("requireUser");
    }
  });
});

describe("Outlets service client", () => {
  it("should have outlet in externalServices", () => {
    expect(serviceClientContent).toContain("outlet:");
    expect(serviceClientContent).toContain("OUTLETS_SERVICE_URL");
    expect(serviceClientContent).toContain("OUTLETS_SERVICE_API_KEY");
  });
});

describe("Outlets OpenAPI schemas", () => {
  it("should register GET /v1/outlets", () => {
    expect(schemaContent).toContain('path: "/v1/outlets"');
  });

  it("should register POST /v1/outlets", () => {
    expect(schemaContent).toContain("CreateOutletRequest");
  });

  it("should register POST /v1/outlets/bulk", () => {
    expect(schemaContent).toContain('path: "/v1/outlets/bulk"');
    expect(schemaContent).toContain("BulkCreateOutletsRequest");
  });

  it("should register POST /v1/outlets/search", () => {
    expect(schemaContent).toContain('path: "/v1/outlets/search"');
    expect(schemaContent).toContain("SearchOutletsRequest");
  });

  it("should register POST /v1/outlets/discover with count param and response schema", () => {
    expect(schemaContent).toContain('path: "/v1/outlets/discover"');
    expect(schemaContent).toContain("DiscoverOutletsRequest");
    expect(schemaContent).toContain("DiscoverOutletsResponse");
    // count param
    const discoverSection = schemaContent.slice(
      schemaContent.indexOf("DiscoverOutletsRequest") - 500,
      schemaContent.indexOf("DiscoverOutletsRequest")
    );
    expect(discoverSection).toContain("count:");
  });

  it("should register POST /v1/outlets/buffer/next", () => {
    expect(schemaContent).toContain('path: "/v1/outlets/buffer/next"');
    expect(schemaContent).toContain("BufferNextOutletResponse");
  });

  it("should include runId filter on GET /v1/outlets query params", () => {
    const getOutletsSection = schemaContent.slice(
      schemaContent.indexOf('path: "/v1/outlets"'),
      schemaContent.indexOf('path: "/v1/outlets"') + 400
    );
    expect(getOutletsSection).toContain("runId:");
  });

  it("should register GET /v1/outlets/{id}", () => {
    expect(schemaContent).toContain('path: "/v1/outlets/{id}"');
  });

  it("should register PATCH /v1/outlets/{id}", () => {
    const patchMatch = schemaContent.match(/method: "patch",\s*\n\s*path: "\/v1\/outlets\/\{id\}"/);
    expect(patchMatch).not.toBeNull();
  });

  it("should register PATCH /v1/outlets/{id}/status", () => {
    expect(schemaContent).toContain('path: "/v1/outlets/{id}/status"');
    expect(schemaContent).toContain("UpdateOutletStatusRequest");
  });

  it("should register GET /v1/outlets/stats", () => {
    expect(schemaContent).toContain('path: "/v1/outlets/stats"');
  });

  it("should register GET /v1/outlets/stats/costs with response schema", () => {
    expect(schemaContent).toContain('path: "/v1/outlets/stats/costs"');
    expect(schemaContent).toContain("OutletStatsCostsResponse");
  });

  it("should use Outlets tag", () => {
    expect(schemaContent).toContain('tags: ["Outlets"]');
  });

  it("should NOT include brand/campaign fields in DiscoverOutletsRequest body (convention: use headers)", () => {
    const start = schemaContent.indexOf("DiscoverOutletsRequest");
    const blockBefore = schemaContent.slice(Math.max(0, start - 500), start);
    // These must come from x-brand-id / x-campaign-id headers, not the body
    expect(blockBefore).not.toContain("brandId:");
    expect(blockBefore).not.toContain("campaignId:");
    expect(blockBefore).not.toContain("brandName:");
    expect(blockBefore).not.toContain("brandDescription:");
    expect(blockBefore).not.toContain("industry:");
    expect(blockBefore).not.toContain("targetGeo:");
    expect(blockBefore).not.toContain("targetAudience:");
    expect(blockBefore).not.toContain("angles:");
  });
});

describe("Outlets routes are mounted in index.ts", () => {
  it("should import and mount outlets routes", () => {
    expect(indexContent).toContain("outletsRoutes");
    expect(indexContent).toContain("./routes/outlets");
  });

  it("should mount at /v1", () => {
    expect(indexContent).toContain('app.use("/v1", outletsRoutes)');
  });
});
