import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const schemasPath = path.join(__dirname, "../../src/schemas.ts");
const schemasContent = fs.readFileSync(schemasPath, "utf-8");

const generatorPath = path.join(__dirname, "../../scripts/generate-openapi.ts");
const generatorContent = fs.readFileSync(generatorPath, "utf-8");

describe("OpenAPI spec — auth documentation", () => {
  it("should document user key as the default in security scheme", () => {
    expect(schemasContent).toContain("distrib.usr_*");
    expect(schemasContent).toContain("POST /v1/api-keys");
  });

  it("should mention app key as multi-tenant platform option", () => {
    expect(schemasContent).toContain("distrib.app_*");
    expect(schemasContent).toContain("multi-tenant platform");
  });

  it("should reference Platform section for app key details", () => {
    expect(schemasContent).toContain("Platform section");
  });
});

describe("OpenAPI spec — info description", () => {
  it("should include Quick Start section in API description", () => {
    expect(generatorContent).toContain("## Quick Start");
  });

  it("should document user key flow with example", () => {
    expect(generatorContent).toContain("Authorization: Bearer distrib.usr_abc123");
  });

  it("should include BYOK section with org keySource example", () => {
    expect(generatorContent).toContain("## Storing provider keys (BYOK)");
    expect(generatorContent).toContain('"keySource": "org"');
  });

  it("should document error codes for auth failures", () => {
    expect(generatorContent).toContain("Organization context required");
    expect(generatorContent).toContain("Identity resolution failed");
  });

  it("should push app key docs to Advanced: Platform integration section", () => {
    expect(generatorContent).toContain("## Advanced: Platform integration");
    expect(generatorContent).toContain("multi-tenant platform");
  });

  it("should document app key flow with identity headers in platform section", () => {
    expect(generatorContent).toContain("Authorization: Bearer distrib.app_abc123");
    expect(generatorContent).toContain("x-org-id: org_2xyzABC");
    expect(generatorContent).toContain("x-user-id: user_2abcDEF");
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

describe("OpenAPI spec — tag structure", () => {
  it("should use Authentication tag for API key endpoints", () => {
    expect(schemasContent).toContain('tags: ["Authentication"]');
  });

  it("should use Platform tag for app registration", () => {
    expect(schemasContent).toContain('tags: ["Platform"]');
  });

  it("should define Authentication tag before Keys tag", () => {
    const authTagPos = generatorContent.indexOf('"Authentication"');
    const keysTagPos = generatorContent.indexOf('"Keys"');
    expect(authTagPos).toBeLessThan(keysTagPos);
  });

  it("should define Platform tag last", () => {
    const platformTagPos = generatorContent.indexOf('"Platform"');
    const billingTagPos = generatorContent.indexOf('"Billing"');
    expect(platformTagPos).toBeGreaterThan(billingTagPos);
  });
});

describe("OpenAPI spec — keySource clarity", () => {
  it("should describe keySource 'app' as multi-tenant platforms only", () => {
    expect(schemasContent).toContain("multi-tenant platforms only");
  });

  it("should recommend 'org' as the default keySource", () => {
    expect(schemasContent).toContain("Most users should use keySource: 'org'");
  });
});
