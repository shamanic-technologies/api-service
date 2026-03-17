import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Workflow validate endpoint", () => {
  const routePath = path.join(__dirname, "../../src/routes/workflows.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should define POST /workflows/:id/validate", () => {
    expect(content).toContain('"/workflows/:id/validate"');
    expect(content).toContain("router.post");
  });

  it("should proxy to workflow-service /workflows/{id}/validate", () => {
    const validateStart = content.indexOf('"/workflows/:id/validate"');
    const validateEnd = content.indexOf('"/workflows/:id"', validateStart + 30);
    const block = content.slice(validateStart, validateEnd);

    expect(block).toContain("externalServices.workflow");
    expect(block).toContain("`/workflows/${id}/validate`");
    expect(block).toContain('method: "POST"');
  });

  it("should use authenticate, requireOrg, requireUser middleware", () => {
    const validateStart = content.indexOf('"/workflows/:id/validate"');
    const line = content.slice(validateStart - 100, validateStart + 100);
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("should be defined before GET /workflows/:id to avoid param capture", () => {
    const validateIndex = content.indexOf('"/workflows/:id/validate"');
    const idMatch = content.match(/router\.\w+\("\/workflows\/:id"[^/]/);
    expect(idMatch).not.toBeNull();
    const idIndex = idMatch!.index!;
    expect(validateIndex).toBeLessThan(idIndex);
  });
});

describe("Workflow update endpoint", () => {
  const routePath = path.join(__dirname, "../../src/routes/workflows.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should define PUT /workflows/:id", () => {
    expect(content).toContain("router.put");
    expect(content).toMatch(/router\.put\("\/workflows\/:id"/);
  });

  it("should validate body with UpdateWorkflowRequestSchema", () => {
    const putStart = content.indexOf('router.put("/workflows/:id"');
    const putEnd = content.indexOf("router.", putStart + 10);
    const block = content.slice(putStart, putEnd);

    expect(block).toContain("UpdateWorkflowRequestSchema");
    expect(block).toContain("safeParse");
  });

  it("should proxy to workflow-service PUT /workflows/{id}", () => {
    const putStart = content.indexOf('router.put("/workflows/:id"');
    const putEnd = content.indexOf("router.", putStart + 10);
    const block = content.slice(putStart, putEnd);

    expect(block).toContain("externalServices.workflow");
    expect(block).toContain('method: "PUT"');
    expect(block).toContain("`/workflows/${id}`");
  });

  it("should return 400 on invalid body", () => {
    const putStart = content.indexOf('router.put("/workflows/:id"');
    const putEnd = content.indexOf("router.", putStart + 10);
    const block = content.slice(putStart, putEnd);

    expect(block).toContain("400");
    expect(block).toContain("Invalid request");
  });

  it("should import UpdateWorkflowRequestSchema", () => {
    expect(content).toContain("UpdateWorkflowRequestSchema");
  });
});

describe("Workflow validate & update schemas", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  it("should register POST /v1/workflows/{id}/validate path", () => {
    expect(content).toContain('path: "/v1/workflows/{id}/validate"');
    expect(content).toContain('method: "post"');
  });

  it("should register PUT /v1/workflows/{id} path", () => {
    expect(content).toContain('path: "/v1/workflows/{id}"');
    expect(content).toContain('method: "put"');
  });

  it("should define ValidationResult schema", () => {
    expect(content).toContain('"ValidationResult"');
    expect(content).toContain("templateContract");
  });

  it("should define UpdateWorkflowRequest schema", () => {
    expect(content).toContain('"UpdateWorkflowRequest"');
    expect(content).toContain("dag:");
  });

  it("should define DAG, DAGNode, DAGEdge schemas", () => {
    expect(content).toContain('"DAG"');
    expect(content).toContain('"DAGNode"');
    expect(content).toContain('"DAGEdge"');
  });

  it("should define TemplateRef and TemplateContractIssue schemas", () => {
    expect(content).toContain('"TemplateRef"');
    expect(content).toContain('"TemplateContractIssue"');
  });

  it("should export UpdateWorkflowRequestSchema", () => {
    expect(content).toContain("export const UpdateWorkflowRequestSchema");
  });
});
