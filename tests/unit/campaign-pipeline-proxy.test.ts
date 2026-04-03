import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/campaigns.ts");
const routeContent = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const openapiPath = path.join(__dirname, "../../openapi.json");
const openapiContent = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));

describe("Campaign pipeline proxy routes", () => {
  it("should have POST /campaigns/pipeline/gate-check endpoint", () => {
    expect(routeContent).toContain('"/campaigns/pipeline/gate-check"');
    expect(routeContent).toContain("router.post");
  });

  it("should have POST /campaigns/pipeline/start-run endpoint", () => {
    expect(routeContent).toContain('"/campaigns/pipeline/start-run"');
  });

  it("should have POST /campaigns/pipeline/end-run endpoint", () => {
    expect(routeContent).toContain('"/campaigns/pipeline/end-run"');
  });

  it("should proxy gate-check to campaign-service /gate-check", () => {
    expect(routeContent).toContain('"/gate-check"');
  });

  it("should proxy start-run to campaign-service /start-run", () => {
    expect(routeContent).toContain('"/start-run"');
  });

  it("should proxy end-run to campaign-service /end-run", () => {
    expect(routeContent).toContain('"/end-run"');
  });

  it("should use authenticate, requireOrg, requireUser on all pipeline endpoints", () => {
    // All 3 pipeline routes use the full auth chain
    const pipelineBlock = routeContent.slice(routeContent.indexOf("Pipeline endpoints"));
    const authMatches = pipelineBlock.match(/authenticate, requireOrg, requireUser/g);
    expect(authMatches).not.toBeNull();
    expect(authMatches!.length).toBe(3);
  });

  it("should use buildInternalHeaders on all pipeline endpoints", () => {
    const pipelineBlock = routeContent.slice(routeContent.indexOf("Pipeline endpoints"));
    const headerMatches = pipelineBlock.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(3);
  });

  it("should proxy to externalServices.campaign", () => {
    const pipelineBlock = routeContent.slice(routeContent.indexOf("Pipeline endpoints"));
    const serviceMatches = pipelineBlock.match(/externalServices\.campaign/g);
    expect(serviceMatches).not.toBeNull();
    expect(serviceMatches!.length).toBe(3);
  });
});

describe("End-run request body validation", () => {
  it("should validate end-run body with EndRunRequestSchema", () => {
    expect(routeContent).toContain("EndRunRequestSchema.safeParse(req.body)");
  });

  it("should return 400 on invalid end-run body", () => {
    expect(routeContent).toContain("res.status(400)");
    expect(routeContent).toContain("success: boolean, stopCampaign: boolean");
  });

  it("should import EndRunRequestSchema from schemas", () => {
    expect(routeContent).toContain("EndRunRequestSchema");
  });

  it("should NOT accept leadFound in EndRunRequestSchema", () => {
    expect(schemaContent).not.toContain("leadFound");
  });

  it("EndRunRequestSchema requires both success and stopCampaign", () => {
    expect(schemaContent).toContain('success: z.boolean()');
    expect(schemaContent).toContain('stopCampaign: z.boolean()');
  });
});

describe("Campaign pipeline OpenAPI schemas", () => {
  it("should register gate-check path", () => {
    expect(schemaContent).toContain('path: "/v1/campaigns/pipeline/gate-check"');
  });

  it("should register start-run path", () => {
    expect(schemaContent).toContain('path: "/v1/campaigns/pipeline/start-run"');
  });

  it("should register end-run path", () => {
    expect(schemaContent).toContain('path: "/v1/campaigns/pipeline/end-run"');
  });

  it("should have all three pipeline paths in openapi.json", () => {
    expect(openapiContent.paths["/v1/campaigns/pipeline/gate-check"]).toBeDefined();
    expect(openapiContent.paths["/v1/campaigns/pipeline/gate-check"].post).toBeDefined();

    expect(openapiContent.paths["/v1/campaigns/pipeline/start-run"]).toBeDefined();
    expect(openapiContent.paths["/v1/campaigns/pipeline/start-run"].post).toBeDefined();

    expect(openapiContent.paths["/v1/campaigns/pipeline/end-run"]).toBeDefined();
    expect(openapiContent.paths["/v1/campaigns/pipeline/end-run"].post).toBeDefined();
  });

  it("end-run openapi should have EndRunRequest body schema with success and stopCampaign", () => {
    const endRunPost = openapiContent.paths["/v1/campaigns/pipeline/end-run"].post;
    const ref = endRunPost.requestBody?.content?.["application/json"]?.schema?.$ref;
    expect(ref).toBe("#/components/schemas/EndRunRequest");
    const resolved = openapiContent.components.schemas.EndRunRequest;
    expect(resolved.required).toContain("success");
    expect(resolved.required).toContain("stopCampaign");
    expect(resolved.properties.success.type).toBe("boolean");
    expect(resolved.properties.stopCampaign.type).toBe("boolean");
  });

  it("end-run openapi should NOT reference leadFound", () => {
    const endRunPost = openapiContent.paths["/v1/campaigns/pipeline/end-run"].post;
    const bodyStr = JSON.stringify(endRunPost);
    expect(bodyStr).not.toContain("leadFound");
  });

  it("gate-check response should reference GateCheckResponse schema with allowed boolean", () => {
    const gateCheckPost = openapiContent.paths["/v1/campaigns/pipeline/gate-check"].post;
    const ref = gateCheckPost.responses["200"]?.content?.["application/json"]?.schema?.$ref;
    expect(ref).toBe("#/components/schemas/GateCheckResponse");
    const resolved = openapiContent.components.schemas.GateCheckResponse;
    expect(resolved.properties.allowed.type).toBe("boolean");
  });

  it("start-run response should reference StartRunResponse schema with runId and campaignId", () => {
    const startRunPost = openapiContent.paths["/v1/campaigns/pipeline/start-run"].post;
    const ref = startRunPost.responses["200"]?.content?.["application/json"]?.schema?.$ref;
    expect(ref).toBe("#/components/schemas/StartRunResponse");
    const resolved = openapiContent.components.schemas.StartRunResponse;
    expect(resolved.properties.runId).toBeDefined();
    expect(resolved.properties.campaignId).toBeDefined();
  });
});
