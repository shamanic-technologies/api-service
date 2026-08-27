import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildDocument } from "../../src/openapi/document.js";

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

  // Assert against the document the build actually produces, not against the
  // source that produces it — the generator moved once already and a
  // source-substring assertion followed it silently.
  it("names the product distribute.you in the OpenAPI title", () => {
    const info = buildDocument().info as { title: string; description: string };
    expect(info.title).toBe("distribute.you API");
    expect(info.description).not.toContain("MCPFactory");
    // The product name is searchable only as `distribute.you` — a bare
    // `distribute` is an ordinary English verb and an unrelated npm package.
    expect(info.description).toContain("API Gateway for distribute.you.");
    expect(info.description).toContain("distribute.you dashboard");
  });
});
