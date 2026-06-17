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

  it("should forward status query param on GET /features", () => {
    expect(content).toContain('"status"');
  });

  it("should have GET /features/:slug with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes('router.get("/features/:slug"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should use buildInternalHeaders for all authenticated endpoints", () => {
    expect(content).toContain("buildInternalHeaders");
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBeGreaterThan(0);
  });

  it("should proxy to externalServices.features", () => {
    expect(content).toContain("externalServices.features");
  });

  it("should have GET /features/entities/registry with auth + requireOrg + requireUser", () => {
    expect(content).toContain('"/features/entities/registry"');
    const line = content.split("\n").find((l) =>
      l.includes('"/features/entities/registry"')
    );
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
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

  it("should have GET /features/:slug/revenue with auth + requireOrg + requireUser", () => {
    expect(content).toContain('"/features/:slug/revenue"');
    const line = content.split("\n").find((l) =>
      l.includes('"/features/:slug/revenue"')
    );
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward brandId, campaignId, workflowSlug and groupBy on GET /features/:slug/revenue", () => {
    const revenueIdx = content.indexOf('"/features/:slug/revenue"');
    const revenueBlock = content.slice(revenueIdx, revenueIdx + 400);
    expect(revenueBlock).toContain('"brandId"');
    expect(revenueBlock).toContain('"campaignId"');
    expect(revenueBlock).toContain('"workflowSlug"');
    expect(revenueBlock).toContain('"groupBy"');
    expect(revenueBlock).toContain("/revenue");
  });

  it("should have GET /features/:slug/persona-stats with auth + requireOrg + requireUser", () => {
    expect(content).toContain('"/features/:slug/persona-stats"');
    const line = content.split("\n").find((l) =>
      l.includes('"/features/:slug/persona-stats"')
    );
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward brandId, goal, brandProfileId, and limit on GET /features/:slug/persona-stats", () => {
    const personaStatsIdx = content.indexOf('"/features/:slug/persona-stats"');
    const personaStatsBlock = content.slice(personaStatsIdx, personaStatsIdx + 500);
    expect(personaStatsBlock).toContain('"brandId"');
    expect(personaStatsBlock).toContain('"goal"');
    expect(personaStatsBlock).toContain('"brandProfileId"');
    expect(personaStatsBlock).toContain('"limit"');
    expect(personaStatsBlock).toContain("/persona-stats");
  });

  it("should have GET /features/:slug/pipeline-activity with auth + requireOrg + requireUser", () => {
    expect(content).toContain('"/features/:slug/pipeline-activity"');
    const line = content.split("\n").find((l) =>
      l.includes('"/features/:slug/pipeline-activity"')
    );
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward brandId, days, and timezone on GET /features/:slug/pipeline-activity", () => {
    const pipelineActivityIdx = content.indexOf('"/features/:slug/pipeline-activity"');
    const pipelineActivityBlock = content.slice(pipelineActivityIdx, pipelineActivityIdx + 500);
    expect(pipelineActivityBlock).toContain('"brandId"');
    expect(pipelineActivityBlock).toContain('"days"');
    expect(pipelineActivityBlock).toContain('"timezone"');
    expect(pipelineActivityBlock).toContain("/pipeline-activity");
  });

  it("should have GET /features/:slug/workflow-projection with auth + requireOrg + requireUser", () => {
    expect(content).toContain('"/features/:slug/workflow-projection"');
    const line = content.split("\n").find((l) =>
      l.includes('"/features/:slug/workflow-projection"')
    );
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward brandId, objective and budgetUsd on GET /features/:slug/workflow-projection", () => {
    const projectionIdx = content.indexOf('"/features/:slug/workflow-projection"');
    const projectionBlock = content.slice(projectionIdx, projectionIdx + 400);
    expect(projectionBlock).toContain('"brandId"');
    expect(projectionBlock).toContain('"objective"');
    expect(projectionBlock).toContain('"budgetUsd"');
    expect(projectionBlock).toContain("/workflow-projection");
  });

  it("should enforce requireOrg + requireUser on ALL authenticated feature routes", () => {
    const routeLines = content.split("\n").filter((l) =>
      /router\.(get|post|put)\(/.test(l) && l.includes('"/') && !l.includes("/public/")
    );
    expect(routeLines.length).toBeGreaterThan(0);
    for (const line of routeLines) {
      expect(line).toContain("authenticate");
      expect(line).toContain("requireOrg");
      expect(line).toContain("requireUser");
    }
  });

  it("should register static routes before parameterized :slug route", () => {
    const entitiesRegistryIdx = content.indexOf('"/features/entities/registry"');
    const registryIdx = content.indexOf('"/features/stats/registry"');
    const globalStatsIdx = content.indexOf('"/features/stats"');
    const slugIdx = content.indexOf('router.get("/features/:slug",');
    expect(entitiesRegistryIdx).toBeLessThan(slugIdx);
    expect(registryIdx).toBeLessThan(slugIdx);
    expect(globalStatsIdx).toBeLessThan(slugIdx);
  });

  it("should register pipeline-activity before parameterized :slug route", () => {
    const pipelineActivityIdx = content.indexOf('"/features/:slug/pipeline-activity"');
    const slugIdx = content.indexOf('router.get("/features/:slug",');
    expect(pipelineActivityIdx).toBeGreaterThanOrEqual(0);
    expect(slugIdx).toBeGreaterThanOrEqual(0);
    expect(pipelineActivityIdx).toBeLessThan(slugIdx);
  });

  it("should NOT have dynasty-specific routes (dynasty concept removed)", () => {
    expect(content).not.toContain('"/features/dynasty"');
    expect(content).not.toContain('"/features/by-dynasty/');
    expect(content).not.toContain('"/public/features/dynasty/slugs"');
    expect(content).not.toContain('"/features/stats/dynasty"');
  });

  it("should NOT have removed endpoints (inputs, create, update, batch upsert)", () => {
    expect(content).not.toContain('"/features/:slug/inputs"');
    expect(content).not.toContain("router.put");
  });

  it("should have POST /features/:slug/prefill with auth + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/features/:slug/prefill"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should validate brandIds in prefill body", () => {
    expect(content).toContain("brandIds");
    expect(content).toContain("brandIds (non-empty string array) is required");
  });

  it("should forward format query param on prefill", () => {
    const prefillIdx = content.indexOf('"/features/:slug/prefill"');
    const prefillBlock = content.slice(prefillIdx, prefillIdx + 600);
    expect(prefillBlock).toContain("format");
  });

  it("should set x-brand-id header from brandIds body on prefill", () => {
    const prefillIdx = content.indexOf('"/features/:slug/prefill"');
    const prefillBlock = content.slice(prefillIdx, prefillIdx + 900);
    expect(prefillBlock).toContain('"x-brand-id"');
    expect(prefillBlock).toContain("brandIds.join");
  });
});

describe("Features service client", () => {
  it("should have features in externalServices", () => {
    expect(serviceClientContent).toContain("features:");
    expect(serviceClientContent).toContain("FEATURES_SERVICE_URL");
    expect(serviceClientContent).toContain("FEATURES_SERVICE_API_KEY");
  });
});

describe("Features OpenAPI schemas", () => {
  it("should register GET /v1/features", () => {
    expect(schemaContent).toContain('path: "/v1/features"');
  });

  it("should register GET /v1/features/{slug}", () => {
    expect(schemaContent).toContain('path: "/v1/features/{slug}"');
  });

  it("should register GET /v1/features/entities/registry", () => {
    expect(schemaContent).toContain('path: "/v1/features/entities/registry"');
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

  it("should register GET /v1/features/{featureSlug}/revenue", () => {
    expect(schemaContent).toContain('path: "/v1/features/{featureSlug}/revenue"');
  });

  it("should register GET /v1/features/{featureSlug}/persona-stats", () => {
    expect(schemaContent).toContain('path: "/v1/features/{featureSlug}/persona-stats"');
    expect(schemaContent).toContain("FeaturePersonaStatsResponse");
  });

  it("should register GET /v1/features/{featureSlug}/pipeline-activity", () => {
    expect(schemaContent).toContain('path: "/v1/features/{featureSlug}/pipeline-activity"');
    expect(schemaContent).toContain("FeaturePipelineActivityResponse");
  });

  it("should register GET /v1/features/{featureSlug}/workflow-projection", () => {
    expect(schemaContent).toContain('path: "/v1/features/{featureSlug}/workflow-projection"');
  });

  it("should document groupBy query param on stats endpoints", () => {
    expect(schemaContent).toContain("groupBy:");
  });

  it("should use Features tag", () => {
    expect(schemaContent).toContain('tags: ["Features"]');
  });

  it("should register POST /v1/features/{featureSlug}/prefill", () => {
    expect(schemaContent).toContain('path: "/v1/features/{featureSlug}/prefill"');
  });

  it("should NOT register removed dynasty/write endpoints", () => {
    expect(schemaContent).not.toContain('path: "/v1/features/dynasty"');
    expect(schemaContent).not.toContain('path: "/v1/features/by-dynasty/');
    expect(schemaContent).not.toContain('path: "/v1/features/stats/dynasty"');
    expect(schemaContent).not.toContain('path: "/v1/features/{slug}/inputs"');
    expect(schemaContent).not.toContain('path: "/public/features/dynasty/slugs"');
  });
});

describe("Public features proxy routes", () => {
  it("should have GET /public/features without auth middleware", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/public/features"') && !l.includes("dynasty")
    );
    expect(line).toBeDefined();
    expect(line).not.toContain("authenticate");
    expect(line).not.toContain("requireOrg");
  });

  it("should proxy to /public/features on features-service", () => {
    expect(content).toContain('"/public/features"');
  });

  it("should have GET /public/features/revenue without auth middleware", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/public/features/revenue"')
    );
    expect(line).toBeDefined();
    expect(line).not.toContain("authenticate");
    expect(line).not.toContain("requireOrg");
  });

  it("should proxy public feature revenue to /public/stats/revenue on features-service", () => {
    expect(content).toContain('"/public/features/revenue"');
    expect(content).toContain("`/public/stats/revenue");
  });

  it("should have GET /public/features/workflow-engagement-latency without auth middleware", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/public/features/workflow-engagement-latency"')
    );
    expect(line).toBeDefined();
    expect(line).not.toContain("authenticate");
    expect(line).not.toContain("requireOrg");
  });

  it("should proxy public workflow engagement latency to /public/stats/workflow-engagement-latency on features-service", () => {
    expect(content).toContain('"/public/features/workflow-engagement-latency"');
    expect(content).toContain("`/public/stats/workflow-engagement-latency");
  });

  it("should have GET /public/features/cost-projection without auth middleware", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/public/features/cost-projection"')
    );
    expect(line).toBeDefined();
    expect(line).not.toContain("authenticate");
    expect(line).not.toContain("requireOrg");
  });

  it("should proxy public feature cost projection to /public/stats/cost-projection on features-service", () => {
    expect(content).toContain('"/public/features/cost-projection"');
    expect(content).toContain("`/public/stats/cost-projection");
  });

  it("should not require auth on public feature endpoints", () => {
    const publicFeaturesBlock = schemaContent.slice(
      schemaContent.indexOf('path: "/public/features"'),
      schemaContent.indexOf('path: "/public/features"') + 500
    );
    expect(publicFeaturesBlock).not.toContain("security:");
  });
});

describe("Public features OpenAPI schemas", () => {
  it("should register GET /public/features", () => {
    expect(schemaContent).toContain('path: "/public/features"');
  });

  it("should register GET /v1/public/features/revenue", () => {
    expect(schemaContent).toContain('path: "/v1/public/features/revenue"');
    expect(schemaContent).toContain("PublicFeatureRevenueResponse");
  });

  it("should register GET /v1/public/features/workflow-engagement-latency", () => {
    expect(schemaContent).toContain('path: "/v1/public/features/workflow-engagement-latency"');
    expect(schemaContent).toContain("PublicWorkflowEngagementLatencyResponse");
  });

  it("should register GET /v1/public/features/cost-projection", () => {
    expect(schemaContent).toContain('path: "/v1/public/features/cost-projection"');
    expect(schemaContent).toContain("PublicCostProjectionResponse");
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

  it("should mount at root for public endpoints", () => {
    expect(indexContent).toContain("app.use(featuresRoutes)");
  });
});
