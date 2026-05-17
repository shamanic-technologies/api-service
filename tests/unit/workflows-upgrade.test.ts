import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { UpgradeWorkflowRequestSchema } from "../../src/schemas";

describe("POST /v1/workflows/upgrade route", () => {
  const routePath = path.join(__dirname, "../../src/routes/workflows.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should have a POST /workflows/upgrade route", () => {
    expect(content).toContain('"/workflows/upgrade"');
    expect(content).toContain("router.post");
  });

  it("should use authenticate, requireOrg, requireUser middleware on /upgrade", () => {
    const upgradeIdx = content.indexOf('router.post("/workflows/upgrade"');
    expect(upgradeIdx).toBeGreaterThan(-1);
    const upgradeRoute = content.slice(upgradeIdx, upgradeIdx + 200);
    expect(upgradeRoute).toContain("authenticate");
    expect(upgradeRoute).toContain("requireOrg");
    expect(upgradeRoute).toContain("requireUser");
  });

  it("should validate request body with UpgradeWorkflowRequestSchema", () => {
    expect(content).toContain("UpgradeWorkflowRequestSchema");
    const upgradeIdx = content.indexOf('router.post("/workflows/upgrade"');
    const block = content.slice(upgradeIdx, upgradeIdx + 1000);
    expect(block).toContain("UpgradeWorkflowRequestSchema");
    expect(block).toContain("safeParse");
  });

  it("should forward to workflow-service /workflows/upgrade", () => {
    const upgradeIdx = content.indexOf('router.post("/workflows/upgrade"');
    const block = content.slice(upgradeIdx, upgradeIdx + 1000);
    expect(block).toContain("externalServices.workflow");
    expect(block).toContain('"/workflows/upgrade"');
    expect(block).toContain('method: "POST"');
  });

  it("should pass orgId and userId from auth context", () => {
    const upgradeIdx = content.indexOf('router.post("/workflows/upgrade"');
    const block = content.slice(upgradeIdx, upgradeIdx + 1000);
    expect(block).toContain("orgId: req.orgId");
    expect(block).toContain("userId: req.userId");
  });

  it("should forward workflowSlug, description, and hints from request body", () => {
    const upgradeIdx = content.indexOf('router.post("/workflows/upgrade"');
    const block = content.slice(upgradeIdx, upgradeIdx + 1000);
    expect(block).toContain("workflowSlug");
    expect(block).toContain("description");
    expect(block).toContain("hints");
  });

  it("should return 400 on invalid request", () => {
    const upgradeIdx = content.indexOf('router.post("/workflows/upgrade"');
    const block = content.slice(upgradeIdx, upgradeIdx + 1000);
    expect(block).toContain("400");
    expect(block).toContain("Invalid request");
  });
});

describe("UpgradeWorkflowRequestSchema", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  it("should define UpgradeWorkflowRequestSchema", () => {
    expect(content).toContain("UpgradeWorkflowRequestSchema");
    expect(content).toContain('"UpgradeWorkflowRequest"');
  });

  it("should require workflowSlug", () => {
    const start = content.indexOf("UpgradeWorkflowRequestSchema");
    const end = content.indexOf('.openapi("UpgradeWorkflowRequest")', start);
    const schemaSection = content.slice(start, end);
    expect(schemaSection).toContain("workflowSlug");
  });

  it("should require description", () => {
    const start = content.indexOf("UpgradeWorkflowRequestSchema");
    const end = content.indexOf('.openapi("UpgradeWorkflowRequest")', start);
    const schemaSection = content.slice(start, end);
    expect(schemaSection).toContain("description");
  });

  it("should have optional hints", () => {
    const start = content.indexOf("UpgradeWorkflowRequestSchema");
    const end = content.indexOf('.openapi("UpgradeWorkflowRequest")', start);
    const schemaSection = content.slice(start, end);
    expect(schemaSection).toContain("hints");
    expect(schemaSection).toContain(".optional()");
  });

  it("should register POST /v1/workflows/upgrade path in OpenAPI", () => {
    expect(content).toContain('path: "/v1/workflows/upgrade"');
  });

  it("should document the UpgradeWorkflowResponse schema", () => {
    expect(content).toContain('"UpgradeWorkflowResponse"');
  });
});

describe("UpgradeWorkflowRequestSchema parsing", () => {
  it("accepts hints as an object (matches workflow-service contract)", () => {
    const result = UpgradeWorkflowRequestSchema.safeParse({
      workflowSlug: "pr-cold-email-outreach",
      description: "Add a wait step before sending the email",
      hints: { services: ["lead-service"], nodeTypes: ["wait"] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects hints as an array (the prod-breaking shape)", () => {
    const result = UpgradeWorkflowRequestSchema.safeParse({
      workflowSlug: "pr-cold-email-outreach",
      description: "Add a wait step before sending the email",
      hints: ["lead-service"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty hints object", () => {
    const result = UpgradeWorkflowRequestSchema.safeParse({
      workflowSlug: "pr-cold-email-outreach",
      description: "Add a wait step before sending the email",
      hints: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts missing hints (field is optional)", () => {
    const result = UpgradeWorkflowRequestSchema.safeParse({
      workflowSlug: "pr-cold-email-outreach",
      description: "Add a wait step before sending the email",
    });
    expect(result.success).toBe(true);
  });

  it("passes through unknown hint keys (downstream owns the shape)", () => {
    const result = UpgradeWorkflowRequestSchema.safeParse({
      workflowSlug: "pr-cold-email-outreach",
      description: "Add a wait step before sending the email",
      hints: { futureKey: "value", services: ["x"] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hints).toEqual({ futureKey: "value", services: ["x"] });
    }
  });
});
