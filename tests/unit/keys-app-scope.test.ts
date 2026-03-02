import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const keysRoutePath = path.join(__dirname, "../../src/routes/keys.ts");
const content = fs.readFileSync(keysRoutePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

describe("POST /v1/keys — unified keySource support", () => {
  it("should use UpsertKeyRequestSchema with keySource field (org and app only)", () => {
    expect(schemaContent).toContain("keySource");
    expect(schemaContent).toContain('"org"');
    expect(schemaContent).toContain('"app"');
  });

  it("should not accept platform as a keySource in the schema", () => {
    // UpsertKeyRequestSchema should only allow org and app
    const schemaSection = schemaContent.slice(
      schemaContent.indexOf("UpsertKeyRequestSchema"),
      schemaContent.indexOf(".openapi(", schemaContent.indexOf("UpsertKeyRequestSchema")) + 30
    );
    expect(schemaSection).not.toContain('"platform"');
  });

  it("should forward to unified /keys endpoint (not /internal/*)", () => {
    expect(content).toContain('"/keys"');
    expect(content).not.toContain('"/internal/app-keys"');
    expect(content).not.toContain('"/internal/keys"');
  });

  it("should validate keySource access with authType", () => {
    expect(content).toContain("validateKeySourceAccess");
    expect(content).toContain("req.authType");
  });

  it("should block platform keySource via public API", () => {
    expect(content).toContain("not allowed via the public API");
  });

  it("should require app_key auth for keySource app", () => {
    expect(content).toContain("requires app key authentication");
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
    const deleteSection = content.slice(content.indexOf('router.delete("/keys/:provider"'));
    expect(deleteSection).toContain("req.query.keySource");
  });
});
