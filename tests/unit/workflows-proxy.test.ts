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

  it("should use workflow.distribute.org as default URL", () => {
    expect(serviceClientContent).toContain("workflow.distribute.org");
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
    expect(content).toContain("req.params.id");
  });

  it("should proxy GET /workflows/best", () => {
    expect(content).toContain('"/workflows/best"');
    expect(content).toContain("/workflows/best?");
  });

  it("should define /workflows/best before /workflows/:id to avoid param capture", () => {
    const bestIndex = content.indexOf('"/workflows/best"');
    const idIndex = content.indexOf('"/workflows/:id"');
    expect(bestIndex).toBeLessThan(idIndex);
  });

  it("should forward query params on /workflows/best", () => {
    // Extract the best workflow handler block
    const bestStart = content.indexOf('"/workflows/best"');
    const bestEnd = content.indexOf('"/workflows/:id"');
    const bestBlock = content.slice(bestStart, bestEnd);

    expect(bestBlock).toContain("category");
    expect(bestBlock).toContain("channel");
    expect(bestBlock).toContain("audienceType");
    expect(bestBlock).toContain("objective");
  });

  it("should not default appId — it is an opt-in filter", () => {
    // appId should only be forwarded if explicitly passed in query params
    const listStart = content.indexOf('"/workflows"');
    const bestStart = content.indexOf('"/workflows/best"');
    const listBlock = content.slice(listStart, bestStart);

    expect(listBlock).toContain('req.query.appId');
    expect(listBlock).not.toContain('"distribute"');
  });

  it("should forward humanId query param on GET /workflows", () => {
    const listStart = content.indexOf('"/workflows"');
    const bestStart = content.indexOf('"/workflows/best"');
    const listBlock = content.slice(listStart, bestStart);

    expect(listBlock).toContain("humanId");
  });
});

describe("Workflow response schemas include style fields", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  it("should include humanId and styleName in BestWorkflowResponse", () => {
    const bestSection = content.slice(content.indexOf('"BestWorkflowResponse"'));
    expect(bestSection).toContain("humanId");
    expect(bestSection).toContain("styleName");
  });

  it("should include humanId query param on GET /v1/workflows", () => {
    const listSection = content.slice(
      content.indexOf('path: "/v1/workflows"'),
      content.indexOf('path: "/v1/workflows/{id}"')
    );
    expect(listSection).toContain("humanId");
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
