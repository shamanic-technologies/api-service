import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Workflow proxy route configuration", () => {
  const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
  const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

  it("should have workflow in externalServices", () => {
    expect(serviceClientContent).toContain("workflow:");
    expect(serviceClientContent).toContain("WORKFLOW_SERVICE_URL");
    expect(serviceClientContent).toContain("WORKFLOW_SERVICE_API_KEY");
  });

  it("should use workflow.distribute.you as default URL", () => {
    expect(serviceClientContent).toContain("workflow.distribute.you");
  });
});

describe("Workflow proxy routes", () => {
  const routePath = path.join(__dirname, "../../src/routes/workflows.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should use authenticate and requireOrg middleware", () => {
    expect(content).toContain("authenticate");
    expect(content).toContain("requireOrg");
  });

  it("should proxy GET /workflows without forced filters", () => {
    expect(content).toContain('"/workflows"');
    expect(content).toContain("externalServices.workflow");
    // orgId should NOT be force-injected — it's an opt-in filter like all others
    expect(content).not.toContain('params.set("orgId", req.orgId!)');
  });

  it("should proxy GET /workflows/:id", () => {
    expect(content).toContain('"/workflows/:id"');
    expect(content).toContain("req.params");
  });

  it("should proxy GET /workflows/ranked and /workflows/best", () => {
    expect(content).toContain('"/workflows/ranked"');
    expect(content).toContain('"/workflows/best"');
    expect(content).toContain("/workflows/ranked?");
    expect(content).toContain("/workflows/best?");
  });

  it("should define /workflows/ranked and /workflows/best before /workflows/:id to avoid param capture", () => {
    const rankedIndex = content.indexOf('"/workflows/ranked"');
    const bestIndex = content.indexOf('"/workflows/best"');
    // Find the standalone /:id route (not /:id/summary or /:id/key-status)
    const idMatch = content.match(/router\.\w+\("\/workflows\/:id"[^/]/);
    expect(idMatch).not.toBeNull();
    const idIndex = idMatch!.index!;
    expect(rankedIndex).toBeLessThan(idIndex);
    expect(bestIndex).toBeLessThan(idIndex);
  });

  it("should define public workflow routes", () => {
    expect(content).toContain('"/public/workflows/ranked"');
    expect(content).toContain('"/public/workflows/best"');
  });

  it("should proxy public ranked/best to features-service, not workflow-service", () => {
    // Extract public ranked block
    const pubRankedStart = content.indexOf('"/public/workflows/ranked"');
    const pubRankedEnd = content.indexOf("});", pubRankedStart) + 3;
    const pubRankedBlock = content.slice(pubRankedStart, pubRankedEnd);
    expect(pubRankedBlock).toContain("externalServices.features");
    expect(pubRankedBlock).toContain("/public/stats/ranked");
    expect(pubRankedBlock).not.toContain("externalServices.workflow");

    // Extract public best block
    const pubBestStart = content.indexOf('"/public/workflows/best"');
    const pubBestEnd = content.indexOf("});", pubBestStart) + 3;
    const pubBestBlock = content.slice(pubBestStart, pubBestEnd);
    expect(pubBestBlock).toContain("externalServices.features");
    expect(pubBestBlock).toContain("/public/stats/best");
    expect(pubBestBlock).not.toContain("externalServices.workflow");
  });

  it("should use PUBLIC_RANKED_PARAMS and PUBLIC_BEST_PARAMS for public routes", () => {
    expect(content).toContain("PUBLIC_RANKED_PARAMS");
    expect(content).toContain("PUBLIC_BEST_PARAMS");
  });

  it("should forward featureSlug query param on ranked endpoints", () => {
    expect(content).toContain('"featureSlug"');
  });

  it("should not expose appId as a query param", () => {
    // appId is no longer a public-facing query param — it's resolved from auth
    const listStart = content.indexOf('"/workflows"');
    const bestStart = content.indexOf('"/workflows/best"');
    const listBlock = content.slice(listStart, bestStart);

    expect(listBlock).not.toContain('req.query.appId');
  });

  it("should forward humanId query param on GET /workflows", () => {
    const listStart = content.indexOf('"/workflows"');
    const bestStart = content.indexOf('"/workflows/best"');
    const listBlock = content.slice(listStart, bestStart);

    expect(listBlock).toContain("humanId");
  });

  it("should forward featureSlug and dynasty slug query params on GET /workflows", () => {
    const listStart = content.indexOf('router.get("/workflows"');
    const rankedStart = content.indexOf('router.get("/workflows/ranked"');
    const listBlock = content.slice(listStart, rankedStart);

    // All slug params are forwarded via the loop
    expect(listBlock).toContain('"featureSlug"');
    expect(listBlock).toContain('"featureDynastySlug"');
    expect(listBlock).toContain('"workflowSlug"');
    expect(listBlock).toContain('"workflowDynastySlug"');
  });

  it("should not forward category/channel/audienceType on GET /workflows", () => {
    const listStart = content.indexOf('router.get("/workflows"');
    const rankedStart = content.indexOf('router.get("/workflows/ranked"');
    const listBlock = content.slice(listStart, rankedStart);

    expect(listBlock).not.toContain('req.query.category');
    expect(listBlock).not.toContain('req.query.channel');
    expect(listBlock).not.toContain('req.query.audienceType');
  });

  it("should not include category/channel/audienceType in RANKED_PARAMS", () => {
    const rankedLine = content.slice(
      content.indexOf("RANKED_PARAMS"),
      content.indexOf("];", content.indexOf("RANKED_PARAMS")) + 2
    );
    expect(rankedLine).not.toContain('"category"');
    expect(rankedLine).not.toContain('"channel"');
    expect(rankedLine).not.toContain('"audienceType"');
  });

  it("should forward featureSlug in POST /workflows/generate body", () => {
    const genStart = content.indexOf('"/workflows/generate"');
    const genBlock = content.slice(genStart, genStart + 500);
    expect(genBlock).toContain("featureSlug");
  });
});

describe("Workflow proxy routes — new endpoints", () => {
  const routePath = path.join(__dirname, "../../src/routes/workflows.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should define GET /workflows/:id/summary", () => {
    expect(content).toContain('"/workflows/:id/summary"');
  });

  it("should define GET /workflows/:id/key-status", () => {
    expect(content).toContain('"/workflows/:id/key-status"');
  });

  it("should define summary and key-status before /:id to avoid param capture", () => {
    const summaryIndex = content.indexOf('"/workflows/:id/summary"');
    const keyStatusIndex = content.indexOf('"/workflows/:id/key-status"');
    const idMatch = content.match(/router\.\w+\("\/workflows\/:id"[^/]/);
    expect(idMatch).not.toBeNull();
    const idIndex = idMatch!.index!;
    expect(summaryIndex).toBeLessThan(idIndex);
    expect(keyStatusIndex).toBeLessThan(idIndex);
  });

  it("should export fetchRequiredProviders and fetchOrgKeys helpers", () => {
    expect(content).toContain("export { fetchRequiredProviders");
    expect(content).toContain("fetchOrgKeys");
  });
});

describe("Workflow schemas — summary and key-status endpoints", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  it("should register /v1/workflows/{id}/summary path", () => {
    expect(content).toContain('path: "/v1/workflows/{id}/summary"');
  });

  it("should register /v1/workflows/{id}/key-status path", () => {
    expect(content).toContain('path: "/v1/workflows/{id}/key-status"');
  });

  it("should define WorkflowSummaryResponse schema", () => {
    expect(content).toContain('"WorkflowSummaryResponse"');
    expect(content).toContain("requiredProviders");
  });

  it("should define WorkflowKeyStatusResponse schema", () => {
    expect(content).toContain('"WorkflowKeyStatusResponse"');
  });

  it("should define MissingKeysError schema", () => {
    expect(content).toContain('"MissingKeysError"');
    expect(content).toContain('"missing_keys"');
  });
});

describe("Workflow schemas — ranked and best endpoints", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  it("should register /v1/workflows/ranked and /v1/workflows/best paths", () => {
    expect(content).toContain('path: "/v1/workflows/ranked"');
    expect(content).toContain('path: "/v1/workflows/best"');
  });

  it("should register public /v1/public/workflows/* paths", () => {
    expect(content).toContain('path: "/v1/public/workflows/ranked"');
    expect(content).toContain('path: "/v1/public/workflows/best"');
  });

  it("should include humanId query param on GET /v1/workflows", () => {
    const listSection = content.slice(
      content.indexOf('path: "/v1/workflows"'),
      content.indexOf('path: "/v1/workflows/{id}"')
    );
    expect(listSection).toContain("humanId");
  });

  it("should include featureSlug query param on GET /v1/workflows", () => {
    const listSection = content.slice(
      content.indexOf('path: "/v1/workflows"'),
      content.indexOf('path: "/v1/workflows/{id}"')
    );
    expect(listSection).toContain("featureSlug");
  });

  it("should include featureSlug in WorkflowMetadata schema", () => {
    const metaSection = content.slice(
      content.indexOf("WorkflowMetadataSchema"),
      content.indexOf(".openapi(\"WorkflowMetadata\")")
    );
    expect(metaSection).toContain("featureSlug");
  });

  it("should have category/channel/audienceType as optional in WorkflowMetadata", () => {
    const metaSection = content.slice(
      content.indexOf("WorkflowMetadataSchema"),
      content.indexOf(".openapi(\"WorkflowMetadata\")")
    );
    // Each of these fields should have .optional()
    const categoryLine = metaSection.slice(metaSection.indexOf("category:"), metaSection.indexOf("channel:"));
    expect(categoryLine).toContain(".optional()");
    const channelLine = metaSection.slice(metaSection.indexOf("channel:"), metaSection.indexOf("audienceType:"));
    expect(channelLine).toContain(".optional()");
    const audienceLine = metaSection.slice(metaSection.indexOf("audienceType:"), metaSection.indexOf("featureSlug:"));
    expect(audienceLine).toContain(".optional()");
  });

  it("should use groupBy=feature in authenticated ranked query params", () => {
    const start = content.indexOf("const rankedQueryParams");
    const end = content.indexOf("});", start) + 3;
    const rankedSection = content.slice(start, end);
    expect(rankedSection).toContain("feature");
    expect(rankedSection).not.toContain("'section'");
  });

  it("should define publicRankedQueryParams with required featureDynastySlug and objective", () => {
    const start = content.indexOf("const publicRankedQueryParams");
    const end = content.indexOf("});", start) + 3;
    const section = content.slice(start, end);
    expect(section).toContain("featureDynastySlug: z.string()");
    expect(section).toContain("objective: z.string()");
    expect(section).not.toContain("featureSlug");
  });

  it("should define publicBestQueryParams with required featureDynastySlug and no featureSlug/objective", () => {
    const start = content.indexOf("const publicBestQueryParams");
    const end = content.indexOf("});", start) + 3;
    const section = content.slice(start, end);
    expect(section).toContain("featureDynastySlug: z.string()");
    expect(section).not.toContain("featureSlug");
    expect(section).not.toContain("objective");
  });

  it("should not include category/channel/audienceType in rankedQueryParams", () => {
    const start = content.indexOf("const rankedQueryParams");
    const end = content.indexOf("});", start) + 3;
    const rankedSection = content.slice(start, end);
    expect(rankedSection).not.toContain("category");
    expect(rankedSection).not.toContain("channel");
    expect(rankedSection).not.toContain("audienceType");
  });

  it("should not include category/channel/audienceType in GET /v1/workflows query params", () => {
    const listSection = content.slice(
      content.indexOf('path: "/v1/workflows"'),
      content.indexOf('path: "/v1/workflows/{id}"')
    );
    expect(listSection).not.toContain("category");
    expect(listSection).not.toContain("channel");
    expect(listSection).not.toContain("audienceType");
  });

  it("should require featureSlug in GenerateWorkflowRequestSchema", () => {
    const start = content.indexOf("GenerateWorkflowRequestSchema");
    const end = content.indexOf(".openapi(\"GenerateWorkflowRequest\")", start);
    const genSchema = content.slice(start, end);
    expect(genSchema).toContain("featureSlug");
    expect(genSchema).toContain(".min(1)");
  });

  it("should include featureSlug in GenerateWorkflowResponse instead of category/channel/audienceType", () => {
    const genSection = content.slice(
      content.indexOf("GenerateWorkflowResponse"),
      content.indexOf("GenerateWorkflowResponse") + 500
    );
    expect(genSection).not.toContain("category");
    expect(genSection).not.toContain("channel");
    expect(genSection).not.toContain("audienceType");
  });
});

describe("Workflow routes are mounted in index.ts", () => {
  const indexPath = path.join(__dirname, "../../src/index.ts");
  const content = fs.readFileSync(indexPath, "utf-8");

  it("should import and mount workflows routes", () => {
    expect(content).toContain("workflowsRoutes");
    expect(content).toContain("./routes/workflows");
  });
});
