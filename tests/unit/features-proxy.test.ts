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

  it("should forward brandId, campaignId, workflowSlug, groupBy and pricing on GET /features/:slug/revenue", () => {
    const revenueIdx = content.indexOf('"/features/:slug/revenue"');
    const revenueBlock = content.slice(revenueIdx, revenueIdx + 400);
    expect(revenueBlock).toContain('"brandId"');
    expect(revenueBlock).toContain('"campaignId"');
    expect(revenueBlock).toContain('"workflowSlug"');
    expect(revenueBlock).toContain('"groupBy"');
    expect(revenueBlock).toContain('"pricing"');
    expect(revenueBlock).toContain("/revenue");
  });

  it("should have GET /features/:slug/audience-stats with auth + requireOrg + requireUser", () => {
    expect(content).toContain('"/features/:slug/audience-stats"');
    const line = content.split("\n").find((l) =>
      l.includes('"/features/:slug/audience-stats"')
    );
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should forward brandId, goal, brandProfileId, limit, statuses, and pricing on GET /features/:slug/audience-stats", () => {
    const audienceStatsIdx = content.indexOf('"/features/:slug/audience-stats"');
    const audienceStatsBlock = content.slice(audienceStatsIdx, audienceStatsIdx + 500);
    expect(audienceStatsBlock).toContain('"brandId"');
    expect(audienceStatsBlock).toContain('"goal"');
    expect(audienceStatsBlock).toContain('"brandProfileId"');
    expect(audienceStatsBlock).toContain('"limit"');
    expect(audienceStatsBlock).toContain('"statuses"');
    expect(audienceStatsBlock).toContain('"pricing"');
    expect(audienceStatsBlock).toContain("/audience-stats");
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

  it("should forward ALL query params transparently on GET /features/:slug/workflow-projection", () => {
    const projectionIdx = content.indexOf('"/features/:slug/workflow-projection"');
    const projectionBlock = content.slice(projectionIdx, projectionIdx + 700);
    // Passthrough: no per-key whitelist — forwards every query param (brandId, goal,
    // objective, audienceId, budgetUsd, …) so new downstream params need no api-service edit.
    expect(projectionBlock).toContain("Object.entries(req.query)");
    expect(projectionBlock).toContain("/workflow-projection");
  });

  it("should NOT have a candidates route (endpoint removed downstream, folded into workflow-projection)", () => {
    expect(content).not.toContain('"/features/:slug/candidates"');
  });

  it("should enforce requireOrg + requireUser on ALL org-scoped authenticated feature routes", () => {
    const routeLines = content.split("\n").filter((l) =>
      /router\.(get|post|put)\(/.test(l) &&
      l.includes('"/') &&
      !l.includes("/public/") &&
      // Staff-only cross-org route: gated by authenticatePlatform + requireStaff, no org context.
      !l.includes("/features/audit/")
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

  it("should register GET /v1/features/{featureSlug}/audience-stats", () => {
    expect(schemaContent).toContain('path: "/v1/features/{featureSlug}/audience-stats"');
    expect(schemaContent).toContain("FeatureAudienceStatsResponse");
  });

  it("should register GET /v1/features/{featureSlug}/pipeline-activity", () => {
    expect(schemaContent).toContain('path: "/v1/features/{featureSlug}/pipeline-activity"');
    expect(schemaContent).toContain("FeaturePipelineActivityResponse");
  });

  it("should register GET /v1/features/{featureSlug}/workflow-projection", () => {
    expect(schemaContent).toContain('path: "/v1/features/{featureSlug}/workflow-projection"');
  });

  it("should document goal + audienceId query params on workflow-projection", () => {
    const projIdx = schemaContent.indexOf('path: "/v1/features/{featureSlug}/workflow-projection"');
    const projBlock = schemaContent.slice(projIdx, projIdx + 1400);
    expect(projBlock).toContain("brandId:");
    expect(projBlock).toContain("goal:");
    expect(projBlock).toContain("objective:");
    expect(projBlock).toContain("audienceId:");
    expect(projBlock).toContain("budgetUsd:");
  });

  it("should NOT register the removed candidates endpoint", () => {
    expect(schemaContent).not.toContain('path: "/v1/features/{featureSlug}/candidates"');
    expect(schemaContent).not.toContain("FeatureCandidatesResponse");
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

  it("should have GET /public/features/cost-per-outcome-trend without auth middleware", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/public/features/cost-per-outcome-trend"')
    );
    expect(line).toBeDefined();
    expect(line).not.toContain("authenticate");
    expect(line).not.toContain("requireOrg");
  });

  it("should proxy public cost-per-outcome trend to /public/stats/cost-per-outcome-trend on features-service", () => {
    expect(content).toContain('"/public/features/cost-per-outcome-trend"');
    expect(content).toContain("`/public/stats/cost-per-outcome-trend");
  });

  it("should have GET /public/features/workflow-cost-per-outcome without auth middleware", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/public/features/workflow-cost-per-outcome"')
    );
    expect(line).toBeDefined();
    expect(line).not.toContain("authenticate");
    expect(line).not.toContain("requireOrg");
  });

  it("should proxy public workflow cost-per-outcome to /public/stats/workflow-cost-per-outcome on features-service", () => {
    expect(content).toContain('"/public/features/workflow-cost-per-outcome"');
    expect(content).toContain("`/public/stats/workflow-cost-per-outcome");
  });

  it("should have GET /public/features/cost-per-outcome-lifetime without auth middleware", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/public/features/cost-per-outcome-lifetime"')
    );
    expect(line).toBeDefined();
    expect(line).not.toContain("authenticate");
    expect(line).not.toContain("requireOrg");
  });

  it("should proxy public cost-per-outcome lifetime to /public/stats/cost-per-outcome-lifetime on features-service", () => {
    expect(content).toContain('"/public/features/cost-per-outcome-lifetime"');
    expect(content).toContain("`/public/stats/cost-per-outcome-lifetime");
  });

  it("should have GET /public/features/cost-per-outcome-distribution without auth middleware", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/public/features/cost-per-outcome-distribution"')
    );
    expect(line).toBeDefined();
    expect(line).not.toContain("authenticate");
    expect(line).not.toContain("requireOrg");
  });

  it("should proxy public cost-per-outcome distribution to /public/stats/cost-per-outcome-distribution on features-service", () => {
    expect(content).toContain('"/public/features/cost-per-outcome-distribution"');
    expect(content).toContain("`/public/stats/cost-per-outcome-distribution");
  });

  it("should NOT expose a public send-forecast route (cross-org fleet financials moved to staff)", () => {
    expect(content).not.toContain('"/public/features/send-forecast"');
    expect(content).not.toContain("/public/stats/send-forecast");
    expect(schemaContent).not.toContain('path: "/v1/public/features/send-forecast"');
    expect(schemaContent).not.toContain("PublicSendForecastResponse");
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

  it("should register GET /v1/public/features/cost-per-outcome-trend", () => {
    expect(schemaContent).toContain('path: "/v1/public/features/cost-per-outcome-trend"');
    expect(schemaContent).toContain("PublicCostPerOutcomeTrendResponse");
  });

  it("should register GET /v1/public/features/workflow-cost-per-outcome", () => {
    expect(schemaContent).toContain('path: "/v1/public/features/workflow-cost-per-outcome"');
    expect(schemaContent).toContain("PublicWorkflowCostPerOutcomeResponse");
  });

  it("should register GET /v1/public/features/cost-per-outcome-lifetime", () => {
    expect(schemaContent).toContain('path: "/v1/public/features/cost-per-outcome-lifetime"');
    expect(schemaContent).toContain("PublicCostPerOutcomeLifetimeResponse");
  });

  it("should register GET /v1/public/features/cost-per-outcome-distribution", () => {
    expect(schemaContent).toContain('path: "/v1/public/features/cost-per-outcome-distribution"');
    expect(schemaContent).toContain("PublicCostPerOutcomeDistributionResponse");
  });

  it("should NOT register GET /v1/public/features/send-forecast (moved to staff)", () => {
    expect(schemaContent).not.toContain('path: "/v1/public/features/send-forecast"');
    expect(schemaContent).not.toContain("PublicSendForecastResponse");
  });
});

describe("Staff fleet send-forecast proxy route (source)", () => {
  it("registers GET /features/audit/send-forecast on the router", () => {
    expect(content).toContain('"/features/audit/send-forecast"');
    expect(content).toContain("router.get");
  });

  it("is staff-gated with authenticatePlatform + requireStaff (no org)", () => {
    const mountIdx = content.indexOf('"/features/audit/send-forecast"');
    const chain = content.slice(mountIdx, content.indexOf("async (req", mountIdx));
    expect(chain).toContain("authenticatePlatform,");
    expect(chain).toContain("requireStaff,");
    expect(chain).not.toContain("requireOrg");
  });

  it("proxies to features-service GET /internal/stats/send-forecast", () => {
    expect(content).toContain("externalServices.features");
    expect(content).toContain("`/internal/stats/send-forecast");
  });

  it("forwards the days query param", () => {
    expect(content).toContain('AUDIT_SEND_FORECAST_PARAMS = ["days"]');
  });

  it("forwards the verified staff x-email downstream for attribution", () => {
    expect(content).toContain("req.staffEmail");
    expect(content).toContain('"x-email"');
  });

  it("registers the OpenAPI path with passthrough response + platform auth", () => {
    expect(schemaContent).toContain('path: "/v1/features/audit/send-forecast"');
    expect(schemaContent).toContain("StaffSendForecastResponse");
    expect(schemaContent).toContain("security: platformAuth");
  });
});

describe("Staff fleet accounts audit proxy route (source)", () => {
  it("registers GET /features/audit/accounts on the router", () => {
    expect(content).toContain('"/features/audit/accounts"');
    expect(content).toContain("router.get");
  });

  it("is staff-gated with authenticatePlatform + requireStaff (no org)", () => {
    const mountIdx = content.indexOf('"/features/audit/accounts"');
    const chain = content.slice(mountIdx, content.indexOf("async (req", mountIdx));
    expect(chain).toContain("authenticatePlatform,");
    expect(chain).toContain("requireStaff,");
    expect(chain).not.toContain("requireOrg");
  });

  it("proxies to features-service GET /internal/stats/accounts", () => {
    const mountIdx = content.indexOf('"/features/audit/accounts"');
    const block = content.slice(mountIdx, mountIdx + 500);
    expect(block).toContain("externalServices.features");
    expect(block).toContain("`/internal/stats/accounts`");
  });

  it("forwards the verified staff x-email downstream for attribution", () => {
    const mountIdx = content.indexOf('"/features/audit/accounts"');
    const block = content.slice(mountIdx, mountIdx + 500);
    expect(block).toContain("staffHeaders(req)");
  });

  it("registers the OpenAPI path with passthrough response + platform auth", () => {
    expect(schemaContent).toContain('path: "/v1/features/audit/accounts"');
    expect(schemaContent).toContain("StaffAccountsResponse");
  });
});

describe("Staff fleet active-users audit proxy route (source)", () => {
  it("registers GET /features/audit/active-users on the router", () => {
    expect(content).toContain('"/features/audit/active-users"');
    expect(content).toContain("router.get");
  });

  it("is staff-gated with authenticatePlatform + requireStaff (no org)", () => {
    const mountIdx = content.indexOf('"/features/audit/active-users"');
    const chain = content.slice(mountIdx, content.indexOf("async (req", mountIdx));
    expect(chain).toContain("authenticatePlatform,");
    expect(chain).toContain("requireStaff,");
    expect(chain).not.toContain("requireOrg");
  });

  it("proxies to features-service GET /internal/stats/active-users", () => {
    const mountIdx = content.indexOf('"/features/audit/active-users"');
    const block = content.slice(mountIdx, mountIdx + 700);
    expect(block).toContain("externalServices.features");
    expect(block).toContain("`/internal/stats/active-users");
  });

  it("forwards the days/weeks/months window query params", () => {
    expect(content).toContain('AUDIT_ACTIVE_USERS_PARAMS = ["days", "weeks", "months"]');
  });

  it("forwards the verified staff x-email downstream for attribution", () => {
    const mountIdx = content.indexOf('"/features/audit/active-users"');
    const block = content.slice(mountIdx, mountIdx + 700);
    expect(block).toContain("staffHeaders(req)");
  });

  it("registers the OpenAPI path with passthrough response + platform auth", () => {
    expect(schemaContent).toContain('path: "/v1/features/audit/active-users"');
    expect(schemaContent).toContain("StaffActiveUsersResponse");
    expect(schemaContent).toContain("security: platformAuth");
  });
});

describe("Staff fleet active-users-by-user audit proxy route (source)", () => {
  it("registers GET /features/audit/active-users-by-user on the router", () => {
    expect(content).toContain('"/features/audit/active-users-by-user"');
    expect(content).toContain("router.get");
  });

  it("is staff-gated with authenticatePlatform + requireStaff (no org)", () => {
    const mountIdx = content.indexOf('"/features/audit/active-users-by-user"');
    const chain = content.slice(mountIdx, content.indexOf("async (req", mountIdx));
    expect(chain).toContain("authenticatePlatform,");
    expect(chain).toContain("requireStaff,");
    expect(chain).not.toContain("requireOrg");
  });

  it("proxies to features-service GET /internal/stats/active-users-by-user", () => {
    const mountIdx = content.indexOf('"/features/audit/active-users-by-user"');
    const block = content.slice(mountIdx, mountIdx + 600);
    expect(block).toContain("externalServices.features");
    expect(block).toContain("`/internal/stats/active-users-by-user`");
  });

  it("forwards the verified staff x-email downstream for attribution", () => {
    const mountIdx = content.indexOf('"/features/audit/active-users-by-user"');
    const block = content.slice(mountIdx, mountIdx + 600);
    expect(block).toContain("staffHeaders(req)");
  });

  it("registers the OpenAPI path with passthrough response + platform auth", () => {
    expect(schemaContent).toContain('path: "/v1/features/audit/active-users-by-user"');
    expect(schemaContent).toContain("StaffActiveUsersByUserResponse");
    expect(schemaContent).toContain("security: platformAuth");
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
