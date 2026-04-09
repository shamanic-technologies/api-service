import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/journalists.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

describe("Journalists proxy routes", () => {
  it("should have GET /journalists with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/journalists"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should proxy GET /journalists to /campaign-outlet-journalists with brand_id", () => {
    // The route should forward brandId as brand_id query param to journalist-service
    expect(content).toContain('params.set("brand_id", brandId)');
  });

  it("should require brandId query parameter on GET /journalists", () => {
    expect(content).toContain("Missing required query parameter: brandId");
  });

  it("should forward featureDynastySlug as feature_dynasty_slug on GET /journalists", () => {
    const getSection = content.slice(
      content.indexOf('"/journalists"'),
      content.indexOf('"/journalists/list"')
    );
    expect(getSection).toContain("feature_dynasty_slug");
    expect(getSection).toContain("featureDynastySlug");
  });

  it("should have POST /journalists/discover with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/journalists/discover"') && !l.includes("emails")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });


  it("should have POST /journalists/resolve with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/journalists/resolve"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have POST /journalists/buffer/next with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/journalists/buffer/next"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should proxy POST /journalists/discover to /discover on journalist-service", () => {
    // The callExternalService call should use "/discover" as the path
    const lines = content.split("\n");
    const routeIdx = lines.findIndex((l) => l.includes('router.post') && l.includes('"/journalists/discover"') && !l.includes("emails"));
    expect(routeIdx).toBeGreaterThan(-1);
    // Find the callExternalService line within the handler
    const handlerLines = lines.slice(routeIdx + 1, routeIdx + 10);
    const serviceLine = handlerLines.find((l) => l.includes("callExternalService"));
    expect(serviceLine).toBeDefined();
    // The next line or same block should reference "/discover" not "/journalists/discover"
    const serviceBlock = handlerLines.join("\n");
    expect(serviceBlock).toContain('"/orgs/discover"');
  });

  it("should forward runId query parameter on GET /journalists", () => {
    expect(content).toContain("runId");
    expect(content).toContain('params.set("run_id", runId)');
  });

  it("should forward campaignId query parameter on GET /journalists", () => {
    expect(content).toContain("campaignId");
    expect(content).toContain('params.set("campaign_id", campaignId)');
  });

  it("should enrich workflow headers from campaign-service when campaignId query param is present but headers are missing", () => {
    // The GET /journalists handler fetches campaign metadata to populate x-campaign-id, x-brand-id, x-feature-slug, x-workflow-slug
    expect(content).toContain("externalServices.campaign");
    expect(content).toContain("/campaigns/");
    // Should only enrich when workflow headers are missing
    expect(content).toContain("!req.campaignId || !req.brandId || !req.featureSlug || !req.workflowSlug");
    // Should set missing headers from campaign data
    expect(content).toContain('headers["x-campaign-id"] = campaignId');
    expect(content).toContain('headers["x-brand-id"]');
    expect(content).toContain('headers["x-feature-slug"]');
    expect(content).toContain('headers["x-workflow-slug"]');
  });

  it("should proxy POST /journalists/buffer/next to /buffer/next on journalist-service", () => {
    expect(content).toContain('"/orgs/buffer/next"');
  });

  it("should use buildInternalHeaders for all endpoints", () => {
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(7);
  });

  it("should proxy to externalServices.journalist", () => {
    expect(content).toContain("externalServices.journalist");
  });

  it("should forward request body on discover and buffer/next endpoints", () => {
    const bodyMatches = content.match(/body: req\.body/g);
    expect(bodyMatches).not.toBeNull();
    expect(bodyMatches!.length).toBe(2);
  });

  it("should translate resolve to GET /campaign-outlet-journalists on journalist-service", () => {
    expect(content).toContain("/campaign-outlet-journalists");
    expect(content).toContain("campaign_id");
    expect(content).toContain("outlet_id");
  });

  it("should require x-campaign-id header for resolve endpoint", () => {
    expect(content).toContain("req.campaignId");
    expect(content).toContain("x-campaign-id header is required");
  });

  it("should have GET /journalists/stats with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/journalists/stats"') && !l.includes("costs")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should proxy GET /journalists/stats to /stats on journalist-service", () => {
    expect(content).toContain('`/orgs/stats${qs}`');
  });

  it("should forward all filter params on GET /journalists/stats", () => {
    const statsBlock = content.slice(
      content.indexOf('"/journalists/stats"'),
      content.indexOf('"/journalists/stats"') + 600
    );
    for (const param of ["orgId", "campaignId", "outletId", "brandId", "featureSlug", "workflowSlug", "workflowSlugs", "featureDynastySlug", "workflowDynastySlug", "groupBy"]) {
      expect(statsBlock).toContain(`"${param}"`);
    }
  });

  it("should have GET /journalists/stats/costs with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/journalists/stats/costs"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should proxy GET /journalists/stats/costs to /journalists/stats/costs on journalist-service", () => {
    expect(content).toContain('`/orgs/journalists/stats/costs${qs}`');
  });

  it("should require brandId on GET /journalists/stats/costs", () => {
    // The route validates brandId is present
    expect(content).toContain("Missing required query parameter: brandId");
  });

  it("should forward groupBy and campaignId query params on stats/costs", () => {
    // The route forwards brandId, campaignId, groupBy
    const statsBlock = content.slice(
      content.indexOf('"/journalists/stats/costs"'),
      content.indexOf('"/journalists/stats/costs"') + 600
    );
    expect(statsBlock).toContain('"brandId"');
    expect(statsBlock).toContain('"campaignId"');
    expect(statsBlock).toContain('"groupBy"');
  });

  it("should enforce requireOrg + requireUser on ALL journalist routes", () => {
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

describe("Journalists service client", () => {
  it("should have journalist in externalServices", () => {
    expect(serviceClientContent).toContain("journalist:");
    expect(serviceClientContent).toContain("JOURNALISTS_SERVICE_URL");
    expect(serviceClientContent).toContain("JOURNALISTS_SERVICE_API_KEY");
  });
});

describe("Journalists OpenAPI schemas", () => {
  it("should register GET /v1/journalists", () => {
    expect(schemaContent).toContain('path: "/v1/journalists"');
    expect(schemaContent).toContain("ListJournalistsQuery");
    expect(schemaContent).toContain("ListJournalistsResponse");
  });

  it("should register POST /v1/journalists/discover", () => {
    expect(schemaContent).toContain('path: "/v1/journalists/discover"');
    expect(schemaContent).toContain("DiscoverJournalistsRequest");
    expect(schemaContent).toContain("DiscoverJournalistsResponse");
  });


  it("should register POST /v1/journalists/buffer/next", () => {
    expect(schemaContent).toContain('path: "/v1/journalists/buffer/next"');
    expect(schemaContent).toContain("BufferNextJournalistResponse");
  });

  it("should register POST /v1/journalists/resolve", () => {
    expect(schemaContent).toContain('path: "/v1/journalists/resolve"');
    expect(schemaContent).toContain("ResolveJournalistsRequest");
    expect(schemaContent).toContain("ResolveJournalistsResponse");
  });

  it("should use Journalists tag", () => {
    expect(schemaContent).toContain('tags: ["Journalists"]');
  });

  it("should NOT include featureInputs, brandId, or campaignId in DiscoverJournalistsRequest body (convention: use headers)", () => {
    const start = schemaContent.indexOf("DiscoverJournalistsRequest");
    const blockBefore = schemaContent.slice(Math.max(0, start - 400), start);
    expect(blockBefore).not.toContain("featureInputs:");
    expect(blockBefore).not.toContain("brandId:");
    expect(blockBefore).not.toContain("campaignId:");
  });

  it("should keep outletId in DiscoverJournalistsRequest (endpoint-specific required field)", () => {
    const start = schemaContent.indexOf("DiscoverJournalistsRequest");
    const blockBefore = schemaContent.slice(Math.max(0, start - 400), start);
    expect(blockBefore).toContain("outletId:");
  });

  it("should have runId in DiscoverJournalistsResponse (new async response shape)", () => {
    const start = schemaContent.indexOf("DiscoverJournalistsResponse");
    const block = schemaContent.slice(Math.max(0, start - 600), start);
    expect(block).toContain("runId:");
    expect(block).toContain("discovered:");
  });

  it("should have runId in ListJournalistsResponse rows", () => {
    const start = schemaContent.indexOf("ListJournalistsResponse");
    const block = schemaContent.slice(Math.max(0, start - 800), start);
    expect(block).toContain("runId:");
  });

  it("should have runId query param in ListJournalistsQuery", () => {
    const start = schemaContent.indexOf("ListJournalistsQuery");
    const block = schemaContent.slice(Math.max(0, start - 400), start);
    expect(block).toContain("runId:");
  });

  it("should have campaignId query param in ListJournalistsQuery", () => {
    const start = schemaContent.indexOf("ListJournalistsQuery");
    const block = schemaContent.slice(Math.max(0, start - 400), start);
    expect(block).toContain("campaignId:");
  });

  it("should have outreachStatus in ListJournalistsResponse (replaces consolidatedStatus/localStatus/emailGatewayStatus)", () => {
    const start = schemaContent.indexOf("ListJournalistsResponse");
    const block = schemaContent.slice(Math.max(0, start - 800), start);
    expect(block).toContain("outreachStatus:");
    expect(block).not.toContain("consolidatedStatus:");
    expect(block).not.toContain("localStatus:");
    expect(block).not.toContain("emailGatewayStatus:");
    expect(block).toContain('"buffered"');
    expect(block).toContain('"delivered"');
    expect(block).toContain('"replied"');
    expect(block).not.toContain('"bounced"');
  });

  it("should register GET /v1/journalists/stats", () => {
    expect(schemaContent).toContain('path: "/v1/journalists/stats"');
    expect(schemaContent).toContain("JournalistStatsResponse");
  });

  it("should register GET /v1/journalists/stats/costs", () => {
    expect(schemaContent).toContain('path: "/v1/journalists/stats/costs"');
    expect(schemaContent).toContain("JournalistStatsCostsResponse");
  });

  it("should define journalist entity type enum", () => {
    expect(schemaContent).toContain('"individual"');
    expect(schemaContent).toContain('"organization"');
  });
});

describe("Journalists OpenAPI — required workflow headers", () => {
  const openapiPath = path.join(__dirname, "../../openapi.json");
  const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

  const workflowHeaders = ["x-campaign-id", "x-brand-id", "x-feature-slug", "x-workflow-slug"];

  // Non-stats endpoints require all 4 workflow headers
  const requiredHeaderPaths = [
    "/v1/journalists",
    "/v1/journalists/discover",
    "/v1/journalists/buffer/next",
    "/v1/journalists/resolve",
  ];

  for (const pathKey of requiredHeaderPaths) {
    it(`${pathKey} should declare all 4 workflow headers as required parameters`, () => {
      const pathEntry = openapi.paths[pathKey];
      expect(pathEntry).toBeDefined();

      const method = Object.keys(pathEntry).find((k) => ["get", "post"].includes(k));
      expect(method).toBeDefined();

      const operation = pathEntry[method!];
      const params: Array<{ name: string; in: string; required?: boolean }> = operation.parameters || [];
      const headerParams = params.filter((p) => p.in === "header");

      for (const header of workflowHeaders) {
        const param = headerParams.find((p) => p.name === header);
        expect(param, `Missing header parameter: ${header} on ${pathKey}`).toBeDefined();
        expect(param!.required, `${header} should be required on ${pathKey}`).toBe(true);
      }
    });
  }

  // Stats endpoints accept workflow headers as optional (dashboard queries have no workflow context)
  const optionalHeaderPaths = [
    "/v1/journalists/stats",
    "/v1/journalists/stats/costs",
  ];

  for (const pathKey of optionalHeaderPaths) {
    it(`${pathKey} should declare all 4 workflow headers as optional parameters`, () => {
      const pathEntry = openapi.paths[pathKey];
      expect(pathEntry).toBeDefined();

      const method = Object.keys(pathEntry).find((k) => ["get", "post"].includes(k));
      expect(method).toBeDefined();

      const operation = pathEntry[method!];
      const params: Array<{ name: string; in: string; required?: boolean }> = operation.parameters || [];
      const headerParams = params.filter((p) => p.in === "header");

      for (const header of workflowHeaders) {
        const param = headerParams.find((p) => p.name === header);
        expect(param, `Missing header parameter: ${header} on ${pathKey}`).toBeDefined();
        expect(param!.required, `${header} should NOT be required on ${pathKey}`).toBeFalsy();
      }
    });
  }

  it("schemas.ts should define journalistsRequiredHeaders with all 4 headers", () => {
    for (const header of workflowHeaders) {
      expect(schemaContent).toContain(`"${header}"`);
    }
    expect(schemaContent).toContain("journalistsRequiredHeaders");
  });

  it("schemas.ts should define journalistsStatsOptionalHeaders with all 4 headers as optional", () => {
    expect(schemaContent).toContain("journalistsStatsOptionalHeaders");
  });
});

describe("Journalists routes are mounted in index.ts", () => {
  it("should import and mount journalists routes", () => {
    expect(indexContent).toContain("journalistsRoutes");
    expect(indexContent).toContain("./routes/journalists");
  });

  it("should mount at /v1", () => {
    expect(indexContent).toContain('app.use("/v1", journalistsRoutes)');
  });
});
