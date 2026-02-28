import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const schemasPath = path.join(__dirname, "../../src/schemas.ts");
const schemasContent = fs.readFileSync(schemasPath, "utf-8");

const generatorPath = path.join(__dirname, "../../scripts/generate-openapi.ts");
const generatorContent = fs.readFileSync(generatorPath, "utf-8");

describe("OpenAPI spec — auth documentation", () => {
  it("should document both key types in security scheme description", () => {
    expect(schemasContent).toContain("User key");
    expect(schemasContent).toContain("mcpf_*");
    expect(schemasContent).toContain("App key");
    expect(schemasContent).toContain("mcpf_app_*");
  });

  it("should mention x-org-id and x-user-id headers in security scheme", () => {
    expect(schemasContent).toContain("x-org-id");
    expect(schemasContent).toContain("x-user-id");
  });

  it("should explain identity resolution via client-service in security scheme", () => {
    expect(schemasContent).toContain("client-service");
  });

  it("should reference Clerk IDs as example external IDs in security scheme", () => {
    expect(schemasContent).toContain("Clerk");
  });
});

describe("OpenAPI spec — info description", () => {
  it("should include Authentication section in API description", () => {
    expect(generatorContent).toContain("## Authentication");
  });

  it("should document user key flow with example", () => {
    expect(generatorContent).toContain("Authorization: Bearer mcpf_abc123");
  });

  it("should document app key flow with identity headers example", () => {
    expect(generatorContent).toContain("Authorization: Bearer mcpf_app_abc123");
    expect(generatorContent).toContain("x-org-id: org_2xyzABC");
    expect(generatorContent).toContain("x-user-id: user_2abcDEF");
  });

  it("should document error codes for auth failures", () => {
    expect(generatorContent).toContain("Organization context required");
    expect(generatorContent).toContain("Identity resolution failed");
  });

  it("should explain that identity headers are optional for app keys", () => {
    expect(generatorContent).toContain("Both headers are **optional**");
  });
});

describe("OpenAPI spec — server URL", () => {
  it("should default to api.distribute.you", () => {
    expect(generatorContent).toContain("https://api.distribute.you");
  });
});

describe("OpenAPI spec — identity header parameters on authenticated endpoints", () => {
  it("should inject x-org-id and x-user-id header parameters for authenticated operations", () => {
    expect(generatorContent).toContain('"x-org-id"');
    expect(generatorContent).toContain('"x-user-id"');
    expect(generatorContent).toContain('in: "header"');
  });

  it("should only add headers to operations that have security defined", () => {
    expect(generatorContent).toContain("operation?.security && operation.security.length > 0");
  });

  it("should preserve existing parameters when adding identity headers", () => {
    expect(generatorContent).toContain("operation.parameters ?? []");
  });
});
