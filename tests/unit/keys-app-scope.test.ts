import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const keysRoutePath = path.join(__dirname, "../../src/routes/keys.ts");
const content = fs.readFileSync(keysRoutePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

describe("POST /v1/keys — unified keySource support", () => {
  it("should use UpsertKeyRequestSchema with keySource field", () => {
    expect(schemaContent).toContain("keySource");
    expect(schemaContent).toContain('"org"');
    expect(schemaContent).toContain('"app"');
    expect(schemaContent).toContain('"platform"');
  });

  it("should forward to unified /keys endpoint (not /internal/*)", () => {
    // POST handler should call key-service POST /keys
    expect(content).toContain('"/keys"');
    // Should NOT use old /internal/app-keys or /internal/keys paths for provider keys
    expect(content).not.toContain('"/internal/app-keys"');
    expect(content).not.toContain('"/internal/keys"');
  });

  it("should inject orgId for keySource org", () => {
    expect(content).toContain("orgId");
    expect(content).toContain('Organization context required for org keys');
  });

  it("should inject appId for keySource app", () => {
    expect(content).toContain("appId");
    expect(content).toContain('App key authentication required for app keys');
  });

  it("should not expose a decrypt proxy", () => {
    expect(content).not.toContain("/decrypt");
    expect(content).not.toContain("decrypt");
  });
});

describe("GET /v1/keys — unified keySource support", () => {
  it("should accept keySource query param", () => {
    expect(content).toContain("req.query.keySource");
  });

  it("should default keySource to org", () => {
    expect(content).toContain('|| "org"');
  });
});

describe("DELETE /v1/keys/:provider — unified keySource support", () => {
  it("should accept keySource query param", () => {
    // DELETE handler also reads keySource from query
    const deleteSection = content.slice(content.indexOf('router.delete("/keys/:provider"'));
    expect(deleteSection).toContain("req.query.keySource");
  });
});
