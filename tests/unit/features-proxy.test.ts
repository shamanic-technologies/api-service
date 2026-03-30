import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/features.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

describe("Features proxy routes", () => {
  it("should have GET /features with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/features"') && !l.includes("/:slug") && !l.includes("/stats")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward query params on GET /features", () => {
    for (const param of ["status", "category", "channel", "audienceType", "implemented"]) {
      expect(content).toContain(`"${param}"`);
    }
  });

  it("should have GET /features/:slug with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/features/:slug"') && !l.includes("/inputs") && !l.includes("/stats")
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have GET /features/dynasty with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/features/dynasty"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should validate slug query param on GET /features/dynasty", () => {
    const dynastySection = content.slice(content.indexOf('"/features/dynasty"'));
    expect(dynastySection).toContain("req.query.slug");
    expect(dynastySection).toContain("/features/dynasty?slug=");
  });

  it("should have GET /features/:slug/inputs with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/features/:slug/inputs"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have POST /features/:slug/prefill with auth + requireOrg + requireUser", () => {
    expect(content).toContain('"/features/:slug/prefill"');
    const prefillLine = content.split("\n").find((l) =>
      l.includes('"/features/:slug/prefill"')
    );
    expect(prefillLine).toContain("authenticate");
    expect(prefillLine).toContain("requireOrg");
    expect(prefillLine).toContain("requireUser");
  });

  it("should forward format query param on POST /features/:slug/prefill", () => {
    expect(content).toContain("req.query.format");
    expect(content).toContain("?format=");
  });

  it("should have POST /features with auth + requireOrg + requireUser", () => {
    const postLine = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/features"')
    );
    expect(postLine).toBeDefined();
    expect(postLine).toContain("authenticate");
    expect(postLine).toContain("requireOrg");
    expect(postLine).toContain("requireUser");
  });

  it("should return 201 on POST /features", () => {
    expect(content).toContain("res.status(201)");
  });

  it("should have PUT /features for batch upsert with auth + requireOrg + requireUser", () => {
    expect(content).toContain("router.put");
    const putLine = content.split("\n").find((l) =>
      l.includes("router.put") && l.includes('"/features"') && !l.includes(":slug")
    );
    expect(putLine).toBeDefined();
    expect(putLine).toContain("authenticate");
    expect(putLine).toContain("requireOrg");
    expect(putLine).toContain("requireUser");
  });

  it("should have PUT /features/:slug with auth + requireOrg + requireUser", () => {
    const putSlugLine = content.split("\n").find((l) =>
      l.includes("router.put") && l.includes('"/features/:slug"')
    );
    expect(putSlugLine).toBeDefined();
    expect(putSlugLine).toContain("authenticate");
    expect(putSlugLine).toContain("requireOrg");
    expect(putSlugLine).toContain("requireUser");
  });

  it("should forward upstream status code on PUT /features/:slug (fork-on-write)", () => {
    expect(content).toContain("callExternalServiceWithStatus");
    // The route should use res.status(status) to forward 200 or 201
    expect(content).toContain("res.status(status).json(data)");
  });

  it("should use buildInternalHeaders for all endpoints", () => {
    expect(content).toContain("buildInternalHeaders");
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(12);
  });

  it("should proxy to externalServices.features", () => {
    expect(content).toContain("externalServices.features");
  });

  it("should have GET /features/stats/registry with auth + requireOrg + requireUser", () => {
    expect(content).toContain('"/features/stats/registry"');
    const line = content.split("\n").find((l) =>
      l.includes('"/features/stats/registry"')
    );
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should have GET /features/stats with auth + requireOrg + requireUser", () => {
    expect(content).toContain('"/features/stats"');
    const line = content.split("\n").find((l) =>
      l.includes('router.get') && l.includes('"/features/stats"')
    );
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward groupBy and brandId on GET /features/stats", () => {
    expect(content).toContain('"groupBy"');
    expect(content).toContain('"brandId"');
  });

  it("should forward campaignId and workflowDynastySlug on GET /features/stats", () => {
    const statsBlock = content.slice(
      content.indexOf('"/features/stats"'),
      content.indexOf('"/features/stats"') + 300
    );
    expect(statsBlock).toContain('"campaignId"');
    expect(statsBlock).toContain('"workflowDynastySlug"');
  });

  it("should have GET /features/:slug/stats with auth + requireOrg + requireUser", () => {
    expect(content).toContain('"/features/:slug/stats"');
    const line = content.split("\n").find((l) =>
      l.includes('"/features/:slug/stats"')
    );
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward groupBy, brandId, campaignId, workflowSlug, workflowDynastySlug on GET /features/:slug/stats", () => {
    expect(content).toContain('"campaignId"');
    expect(content).toContain('"workflowSlug"');
    expect(content).toContain('"workflowDynastySlug"');
  });

  it("should enforce requireOrg + requireUser on ALL feature routes", () => {
    // Every router.get / router.post / router.put line must include both guards
    const routeLines = content.split("\n").filter((l) =>
      /router\.(get|post|put)\(/.test(l) && l.includes('"/')
    );
    expect(routeLines.length).toBeGreaterThan(0);
    for (const line of routeLines) {
      expect(line).toContain("authenticate");
      expect(line).toContain("requireOrg");
      expect(line).toContain("requireUser");
    }
  });

  it("should register static routes before parameterized :slug route", () => {
    const registryIdx = content.indexOf('"/features/stats/registry"');
    const globalStatsIdx = content.indexOf('"/features/stats"');
    const dynastyIdx = content.indexOf('"/features/dynasty"');
    const slugIdx = content.indexOf('"/features/:slug"');
    expect(registryIdx).toBeLessThan(slugIdx);
    expect(globalStatsIdx).toBeLessThan(slugIdx);
    expect(dynastyIdx).toBeLessThan(slugIdx);
  });
});

describe("Features service client", () => {
  it("should have features in externalServices", () => {
    expect(serviceClientContent).toContain("features:");
    expect(serviceClientContent).toContain("FEATURES_SERVICE_URL");
    expect(serviceClientContent).toContain("FEATURES_SERVICE_API_KEY");
  });

  it("should export callExternalServiceWithStatus", () => {
    expect(serviceClientContent).toContain("export async function callExternalServiceWithStatus");
  });
});

describe("Features OpenAPI schemas", () => {
  it("should register GET /v1/features", () => {
    expect(schemaContent).toContain('path: "/v1/features"');
  });

  it("should register GET /v1/features/{slug}", () => {
    expect(schemaContent).toContain('path: "/v1/features/{slug}"');
  });

  it("should register GET /v1/features/dynasty", () => {
    expect(schemaContent).toContain('path: "/v1/features/dynasty"');
  });

  it("should define FeatureDynastyResponse schema", () => {
    expect(schemaContent).toContain("FeatureDynastyResponse");
    expect(schemaContent).toContain("feature_dynasty_name");
    expect(schemaContent).toContain("feature_dynasty_slug");
  });

  it("should register GET /v1/features/{slug}/inputs", () => {
    expect(schemaContent).toContain('path: "/v1/features/{slug}/inputs"');
  });

  it("should register POST /v1/features/{slug}/prefill", () => {
    expect(schemaContent).toContain('path: "/v1/features/{slug}/prefill"');
  });

  it("should document format query param on prefill endpoint", () => {
    expect(schemaContent).toContain('"text", "full"');
    expect(schemaContent).toContain("format:");
  });

  it("should define typed response schemas for both prefill formats", () => {
    expect(schemaContent).toContain("FeaturePrefillFullResponse");
    expect(schemaContent).toContain("FeaturePrefillTextResponse");
    expect(schemaContent).toContain("FeaturePrefillFullValue");
    // full format fields
    expect(schemaContent).toContain("cached");
    expect(schemaContent).toContain("sourceUrls");
  });

  it("should register PUT /v1/features for batch upsert", () => {
    const putMatch = schemaContent.match(/method: "put",\s*\n\s*path: "\/v1\/features"/);
    expect(putMatch).not.toBeNull();
  });

  it("should register PUT /v1/features/{slug} for single update", () => {
    const putSlugMatch = schemaContent.match(/method: "put",\s*\n\s*path: "\/v1\/features\/\{slug\}"/);
    expect(putSlugMatch).not.toBeNull();
  });

  it("should document 201 fork-on-write response on PUT /v1/features/{slug}", () => {
    expect(schemaContent).toContain("ForkedFeatureResponse");
    expect(schemaContent).toContain("Fork created");
    expect(schemaContent).toContain("forkedFrom");
  });

  it("should use Features tag", () => {
    expect(schemaContent).toContain('tags: ["Features"]');
  });

  it("should define FeaturePrefillRequest schema with brandId", () => {
    expect(schemaContent).toContain("FeaturePrefillRequest");
    expect(schemaContent).toContain("brandId");
  });

  it("should register GET /v1/features/stats/registry", () => {
    expect(schemaContent).toContain('path: "/v1/features/stats/registry"');
  });

  it("should register GET /v1/features/stats", () => {
    expect(schemaContent).toContain('path: "/v1/features/stats"');
  });

  it("should register GET /v1/features/{featureSlug}/stats", () => {
    expect(schemaContent).toContain('path: "/v1/features/{featureSlug}/stats"');
  });

  it("should document groupBy query param on stats endpoints", () => {
    expect(schemaContent).toContain("groupBy:");
  });
});

describe("Features routes are mounted in index.ts", () => {
  it("should import and mount features routes", () => {
    expect(indexContent).toContain("featuresRoutes");
    expect(indexContent).toContain("./routes/features");
  });

  it("should mount at /v1", () => {
    expect(indexContent).toContain('app.use("/v1", featuresRoutes)');
  });
});
