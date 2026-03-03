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

  it("should not reference Platform section or app registration", () => {
    expect(schemasContent).not.toContain("Platform section");
    expect(schemasContent).not.toContain("/v1/apps/register");
  });
});

describe("OpenAPI spec — info description", () => {
  it("should include Quick Start section in API description", () => {
    expect(generatorContent).toContain("## Quick Start");
  });

  it("should document user key flow with example", () => {
    expect(generatorContent).toContain("Authorization: Bearer distrib.usr_abc123");
  });

  it("should include BYOK section without keySource", () => {
    expect(generatorContent).toContain("## Storing provider keys (BYOK)");
    expect(generatorContent).not.toContain('"keySource"');
  });

  it("should document error codes for auth failures", () => {
    expect(generatorContent).toContain("Organization context required");
    expect(generatorContent).toContain("Identity resolution failed");
  });

  it("should not include Advanced: Platform integration section", () => {
    expect(generatorContent).not.toContain("## Advanced: Platform integration");
    expect(generatorContent).not.toContain("/v1/apps/register");
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

  it("should not have Platform tag", () => {
    expect(generatorContent).not.toContain('"Platform"');
    expect(schemasContent).not.toContain('tags: ["Platform"]');
  });

  it("should define Authentication tag before Keys tag", () => {
    const authTagPos = generatorContent.indexOf('"Authentication"');
    const keysTagPos = generatorContent.indexOf('"Keys"');
    expect(authTagPos).toBeLessThan(keysTagPos);
  });
});

describe("OpenAPI spec — keySource clarity", () => {
  it("should not have keySource in UpsertKeyRequestSchema (route hardcodes it)", () => {
    const upsertBlock = schemasContent.slice(
      schemasContent.indexOf("UpsertKeyRequestSchema"),
      schemasContent.indexOf("UpsertKeyRequestSchema") + 300,
    );
    // keySource is no longer in the public schema — the route hardcodes "org"
    expect(upsertBlock).not.toContain("keySource");
  });
});
