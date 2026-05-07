import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("POST /v1/workflows/create route", () => {
  const routePath = path.join(__dirname, "../../src/routes/workflows.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should have a POST /workflows/create route", () => {
    expect(content).toContain('"/workflows/create"');
    expect(content).toContain("router.post");
  });

  it("should NOT have a POST /workflows/generate route (renamed to /create)", () => {
    expect(content).not.toContain('"/workflows/generate"');
  });

  it("should use authenticate, requireOrg, requireUser middleware on /create", () => {
    const createRoute = content.slice(content.indexOf('"/workflows/create"'));
    expect(createRoute).toContain("authenticate");
    expect(createRoute).toContain("requireOrg");
    expect(createRoute).toContain("requireUser");
  });

  it("should validate request body with CreateWorkflowRequestSchema", () => {
    expect(content).toContain("CreateWorkflowRequestSchema");
    expect(content).toContain("safeParse");
  });

  it("should forward to workflow-service /workflows/create", () => {
    const createIdx = content.indexOf('router.post("/workflows/create"');
    const block = content.slice(createIdx, createIdx + 1000);
    expect(block).toContain("externalServices.workflow");
    expect(block).toContain('"/workflows/create"');
    expect(block).toContain('method: "POST"');
  });

  it("should pass orgId and userId from auth context", () => {
    const createIdx = content.indexOf('router.post("/workflows/create"');
    const block = content.slice(createIdx, createIdx + 1000);
    expect(block).toContain("orgId: req.orgId");
    expect(block).toContain("userId: req.userId");
  });

  it("should forward featureSlug, description, hints, and style from request body", () => {
    const createIdx = content.indexOf('router.post("/workflows/create"');
    const block = content.slice(createIdx, createIdx + 1000);
    expect(block).toContain("featureSlug");
    expect(block).toContain("description");
    expect(block).toContain("hints");
    expect(block).toContain("style");
  });

  it("should return 400 on invalid request", () => {
    const createIdx = content.indexOf('router.post("/workflows/create"');
    const block = content.slice(createIdx, createIdx + 1000);
    expect(block).toContain("400");
    expect(block).toContain("Invalid request");
  });
});

describe("CreateWorkflowRequestSchema", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  it("should define CreateWorkflowRequestSchema", () => {
    expect(content).toContain("CreateWorkflowRequestSchema");
    expect(content).toContain('"CreateWorkflowRequest"');
  });

  it("should NOT define GenerateWorkflowRequestSchema (renamed)", () => {
    expect(content).not.toContain("GenerateWorkflowRequestSchema");
    expect(content).not.toContain('"GenerateWorkflowRequest"');
  });

  it("should require featureSlug with min length 1", () => {
    const start = content.indexOf("CreateWorkflowRequestSchema");
    const end = content.indexOf('.openapi("CreateWorkflowRequest")', start);
    const schemaSection = content.slice(start, end);
    expect(schemaSection).toContain("featureSlug");
    expect(schemaSection).toContain(".min(1)");
  });

  it("should require description with min length 10", () => {
    const start = content.indexOf("CreateWorkflowRequestSchema");
    const end = content.indexOf('.openapi("CreateWorkflowRequest")', start);
    const schemaSection = content.slice(start, end);
    expect(schemaSection).toContain("description");
    expect(schemaSection).toContain(".min(10)");
  });

  it("should have optional hints with services, nodeTypes, expectedInputs", () => {
    const start = content.indexOf("CreateWorkflowRequestSchema");
    const end = content.indexOf('.openapi("CreateWorkflowRequest")', start);
    const schemaSection = content.slice(start, end);
    expect(schemaSection).toContain("hints");
    expect(schemaSection).toContain("services");
    expect(schemaSection).toContain("nodeTypes");
    expect(schemaSection).toContain("expectedInputs");
  });

  it("should have optional style referencing WorkflowStyleSchema", () => {
    const start = content.indexOf("CreateWorkflowRequestSchema");
    const end = content.indexOf('.openapi("CreateWorkflowRequest")', start);
    const schemaSection = content.slice(start, end);
    expect(schemaSection).toContain("WorkflowStyleSchema");
  });

  it("should register POST /v1/workflows/create path in OpenAPI", () => {
    expect(content).toContain('path: "/v1/workflows/create"');
    expect(content).not.toContain('path: "/v1/workflows/generate"');
  });

  it("should document the CreateWorkflowResponse schema", () => {
    expect(content).toContain('"CreateWorkflowResponse"');
  });
});
