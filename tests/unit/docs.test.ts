import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("API docs configuration", () => {
  const indexSource = readFileSync(
    join(__dirname, "../../src/index.ts"),
    "utf-8",
  );

  it("imports @scalar/express-api-reference", () => {
    expect(indexSource).toContain(
      'import { apiReference } from "@scalar/express-api-reference"',
    );
  });

  it("mounts /docs route with Scalar", () => {
    expect(indexSource).toContain('"/docs"');
    expect(indexSource).toContain("apiReference(");
  });

  it("points Scalar at /openapi.json", () => {
    expect(indexSource).toContain('url: "/openapi.json"');
  });

  const openapiSource = readFileSync(
    join(__dirname, "../../scripts/generate-openapi.ts"),
    "utf-8",
  );

  it("uses distribute branding in OpenAPI title", () => {
    expect(openapiSource).toContain('title: "distribute API"');
    expect(openapiSource).not.toContain("MCPFactory");
  });
});
