import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("PUT /workflows/:id — fork/conflict support", () => {
  const routePath = path.join(__dirname, "../../src/routes/workflows.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should use callExternalServiceWithStatus for PUT /workflows/:id", () => {
    const putStart = content.indexOf('router.put("/workflows/:id"');
    const putEnd = content.indexOf("router.", putStart + 10);
    const block = content.slice(putStart, putEnd);

    expect(block).toContain("callExternalServiceWithStatus");
  });

  it("should forward the upstream status code (200 or 201)", () => {
    const putStart = content.indexOf('router.put("/workflows/:id"');
    const putEnd = content.indexOf("router.", putStart + 10);
    const block = content.slice(putStart, putEnd);

    expect(block).toContain("res.status(status).json(data)");
  });

  it("should import callExternalServiceWithStatus", () => {
    expect(content).toContain("callExternalServiceWithStatus");
    const importLine = content.slice(0, content.indexOf("\n\n"));
    expect(importLine).toContain("callExternalServiceWithStatus");
  });
});

describe("PUT /workflows/{id} OpenAPI spec — fork/conflict responses", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  // Find the PUT /workflows/{id} block by locating 'summary: "Update a workflow"'
  const updateSummaryIdx = content.indexOf('summary: "Update a workflow"');
  const putBlockStart = content.lastIndexOf("registry.registerPath", updateSummaryIdx);
  const putEnd = content.indexOf("registry.registerPath", updateSummaryIdx + 30);
  const putBlock = content.slice(putBlockStart, putEnd);

  it("should document 200 response with _action: updated", () => {
    expect(putBlock).toContain("200:");
    expect(putBlock).toContain('"updated"');
    expect(putBlock).toContain("UpdateWorkflowResponse");
  });

  it("should document 201 response with _action: forked", () => {
    expect(putBlock).toContain("201:");
    expect(putBlock).toContain('"forked"');
    expect(putBlock).toContain("ForkedWorkflowResponse");
  });

  it("should include _forkedFromName and _forkedFromId in 201 response", () => {
    expect(putBlock).toContain("_forkedFromName");
    expect(putBlock).toContain("_forkedFromId");
    expect(putBlock).toContain("_sourceDynastyDeprecated");
  });

  it("should document 409 conflict response", () => {
    expect(putBlock).toContain("409:");
    expect(putBlock).toContain("Conflict");
  });

  it("should mention fork behavior in the endpoint description", () => {
    expect(putBlock).toContain("forked");
    expect(putBlock).toContain("signature");
  });
});

describe("Generated openapi.json reflects fork/conflict changes", () => {
  const openapiPath = path.join(__dirname, "../../openapi.json");
  const spec = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));
  const putEndpoint = spec.paths["/v1/workflows/{id}"]?.put;
  const putResponses = putEndpoint?.responses;
  const schemas = spec.components?.schemas;

  it("should have 200 response", () => {
    expect(putResponses).toHaveProperty("200");
  });

  it("should have 201 response", () => {
    expect(putResponses).toHaveProperty("201");
    expect(putResponses["201"].description).toContain("forked");
  });

  it("should have 409 response", () => {
    expect(putResponses).toHaveProperty("409");
    expect(putResponses["409"].description).toContain("Conflict");
  });

  it("should reference ForkedWorkflowResponse schema", () => {
    const ref201 = putResponses["201"]?.content?.["application/json"]?.schema?.$ref;
    expect(ref201).toContain("ForkedWorkflowResponse");
  });

  it("should have WorkflowConflictResponse schema with existingWorkflowId and existingWorkflowSlug", () => {
    const conflictSchema = schemas?.WorkflowConflictResponse;
    expect(conflictSchema).toBeDefined();
    expect(conflictSchema.properties).toHaveProperty("existingWorkflowId");
    expect(conflictSchema.properties).toHaveProperty("existingWorkflowSlug");
    expect(conflictSchema.required).toContain("error");
    expect(conflictSchema.required).toContain("existingWorkflowId");
    expect(conflictSchema.required).toContain("existingWorkflowSlug");
  });

  it("should reference WorkflowConflictResponse in 409 response", () => {
    const ref409 = putResponses["409"]?.content?.["application/json"]?.schema?.$ref;
    expect(ref409).toContain("WorkflowConflictResponse");
  });

  it("should have an example on UpdateWorkflowRequest schema", () => {
    const reqSchema = schemas?.UpdateWorkflowRequest;
    expect(reqSchema).toBeDefined();
    expect(reqSchema.example).toBeDefined();
    expect(reqSchema.example.dag).toBeDefined();
    expect(reqSchema.example.dag.nodes).toBeInstanceOf(Array);
  });

  it("should have a detailed description with markdown formatting", () => {
    expect(putEndpoint.description).toContain("**Metadata only**");
    expect(putEndpoint.description).toContain("**DAG with same signature**");
    expect(putEndpoint.description).toContain("**DAG with new signature**");
    expect(putEndpoint.description).toContain("existingWorkflowId");
  });
});
