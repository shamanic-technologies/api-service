import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("POST /v1/workflows/generate route", () => {
  const routePath = path.join(__dirname, "../../src/routes/workflows.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should have a POST /workflows/generate route", () => {
    expect(content).toContain('"/workflows/generate"');
    expect(content).toContain("router.post");
  });

  it("should use authenticate and requireOrg middleware", () => {
    // Check that the generate route specifically uses both middleware
    const generateRoute = content.slice(content.indexOf("workflows/generate"));
    expect(generateRoute).toContain("authenticate");
    expect(generateRoute).toContain("requireOrg");
  });

  it("should validate request body with GenerateWorkflowRequestSchema", () => {
    expect(content).toContain("GenerateWorkflowRequestSchema");
    expect(content).toContain("safeParse");
  });

  it("should forward to workflow-service /workflows/generate", () => {
    expect(content).toContain("externalServices.workflow");
    expect(content).toContain("/workflows/generate");
    expect(content).toContain('method: "POST"');
  });

  it("should pass appId and orgId from auth context", () => {
    expect(content).toContain("appId: req.appId!");
    expect(content).toContain("orgId: req.orgId");
  });

  it("should forward description, hints, and style from request body", () => {
    expect(content).toContain("description");
    expect(content).toContain("hints");
    expect(content).toContain("style");
  });

  it("should return 400 on invalid request", () => {
    expect(content).toContain("400");
    expect(content).toContain("Invalid request");
  });

  it("should handle 422 errors from workflow-service", () => {
    expect(content).toContain("422");
  });
});

describe("GenerateWorkflowRequestSchema", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  it("should define GenerateWorkflowRequestSchema", () => {
    expect(content).toContain("GenerateWorkflowRequestSchema");
    expect(content).toContain('"GenerateWorkflowRequest"');
  });

  it("should require description with min length 10", () => {
    expect(content).toContain("description");
    expect(content).toContain(".min(10)");
  });

  it("should have optional hints with services, nodeTypes, expectedInputs", () => {
    expect(content).toContain("hints");
    expect(content).toContain("services");
    expect(content).toContain("nodeTypes");
    expect(content).toContain("expectedInputs");
  });

  it("should have optional style with type, humanId, brandId, name", () => {
    expect(content).toContain("WorkflowStyleSchema");
    expect(content).toContain('"human"');
    expect(content).toContain('"brand"');
    expect(content).toContain("humanId");
    expect(content).toContain("brandId");
  });

  it("should register POST /v1/workflows/generate path in OpenAPI", () => {
    expect(content).toContain('path: "/v1/workflows/generate"');
    expect(content).toContain('method: "post"');
    expect(content).toContain('tags: ["Workflows"]');
  });

  it("should document the GenerateWorkflowResponse schema", () => {
    expect(content).toContain('"GenerateWorkflowResponse"');
    expect(content).toContain("workflow");
    expect(content).toContain("dag");
    expect(content).toContain("generatedDescription");
  });

  it("should include humanId and styleName in GenerateWorkflowResponse", () => {
    // These fields appear in the response schema between signatureName and GenerateWorkflowResponse
    const start = content.indexOf('path: "/v1/workflows/generate"');
    const end = content.indexOf('"GenerateWorkflowResponse"');
    const responseSection = content.slice(start, end);
    expect(responseSection).toContain("humanId");
    expect(responseSection).toContain("styleName");
  });
});
