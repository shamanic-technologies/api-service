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

  it("should forward featureSlug query param on GET /workflows", () => {
    const listStart = content.indexOf('router.get("/workflows"');
    const rankedStart = content.indexOf('router.get("/workflows/ranked"');
    const listBlock = content.slice(listStart, rankedStart);

    expect(listBlock).toContain('req.query.featureSlug');
    expect(listBlock).toContain('params.set("featureSlug"');
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

  it("should use groupBy=feature instead of groupBy=section in ranked query params", () => {
    const start = content.indexOf("const rankedQueryParams");
    const end = content.indexOf("});", start) + 3;
    const rankedSection = content.slice(start, end);
    expect(rankedSection).toContain("feature");
    expect(rankedSection).not.toContain("'section'");
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
