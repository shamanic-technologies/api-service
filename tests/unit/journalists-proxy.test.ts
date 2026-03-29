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

  it("should have POST /journalists/discover with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/journalists/discover"') && !l.includes("emails")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have POST /journalists/discover-emails with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/journalists/discover-emails"')
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

  it("should use buildInternalHeaders for all endpoints", () => {
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(4);
  });

  it("should proxy to externalServices.journalist", () => {
    expect(content).toContain("externalServices.journalist");
  });

  it("should forward request body on discover and discover-emails endpoints", () => {
    const bodyMatches = content.match(/body: req\.body/g);
    expect(bodyMatches).not.toBeNull();
    expect(bodyMatches!.length).toBe(2);
  });

  it("should translate resolve to GET /campaign-outlet-journalists on journalist-service", () => {
    expect(content).toContain("/campaign-outlet-journalists");
    expect(content).toContain("campaign_id");
    expect(content).toContain("outlet_id");
  });

  it("should require x-campaign-id header or brandId for resolve endpoint", () => {
    expect(content).toContain("req.campaignId");
    expect(content).toContain("brandId");
    expect(content).toContain("Either x-campaign-id header or brandId in request body is required");
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

  it("should register POST /v1/journalists/discover-emails", () => {
    expect(schemaContent).toContain('path: "/v1/journalists/discover-emails"');
    expect(schemaContent).toContain("DiscoverEmailsRequest");
    expect(schemaContent).toContain("DiscoverEmailsResponse");
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

  it("should define journalist entity type enum", () => {
    expect(schemaContent).toContain('"individual"');
    expect(schemaContent).toContain('"organization"');
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
