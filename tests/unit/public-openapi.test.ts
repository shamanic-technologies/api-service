import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const indexSource = readFileSync(
  join(__dirname, "../../src/index.ts"),
  "utf-8",
);

const INTERNAL_TAGS = ["Internal", "Platform", "Health", "Email Gateway", "Runs"];

describe("Public OpenAPI spec", () => {
  it("mounts /public/openapi.json endpoint", () => {
    expect(indexSource).toContain('"/public/openapi.json"');
  });

  it("mounts /public/docs with Scalar", () => {
    expect(indexSource).toContain('"/public/docs"');
    expect(indexSource).toContain('url: "/public/openapi.json"');
  });

  it("filters out all internal tags", () => {
    for (const tag of INTERNAL_TAGS) {
      expect(indexSource).toContain(`"${tag}"`);
    }
    expect(indexSource).toContain("INTERNAL_TAGS");
  });

  it("removes apiKeyAuth security scheme from public spec", () => {
    expect(indexSource).toContain("apiKeyAuth");
    expect(indexSource).toContain("delete spec.components.securitySchemes.apiKeyAuth");
  });

  describe("generated public spec filtering", () => {
    const openapiPath = join(__dirname, "../../openapi.json");
    const specExists = existsSync(openapiPath);

    it.skipIf(!specExists)("excludes internal tags from public spec", () => {
      const spec = JSON.parse(readFileSync(openapiPath, "utf-8"));
      const internalSet = new Set(INTERNAL_TAGS);
      const fullTags: string[] = (spec.tags || []).map((t: { name: string }) => t.name);

      // At least some internal tags must be present in the full spec
      const presentInternalTags = INTERNAL_TAGS.filter((t) => fullTags.includes(t));
      expect(presentInternalTags.length).toBeGreaterThan(0);

      // After filtering, none of the internal tags should remain
      const publicTags = spec.tags.filter(
        (t: { name: string }) => !internalSet.has(t.name),
      );
      expect(publicTags.length).toBeLessThan(spec.tags.length);
      for (const t of publicTags) {
        expect(internalSet.has(t.name)).toBe(false);
      }
    });

    it.skipIf(!specExists)("excludes internal paths from public spec", () => {
      const spec = JSON.parse(readFileSync(openapiPath, "utf-8"));
      const internalSet = new Set(INTERNAL_TAGS);
      const methods = ["get", "post", "put", "patch", "delete"];

      // Find paths that should be excluded
      let internalPathCount = 0;
      for (const [, pathItem] of Object.entries(spec.paths)) {
        let allInternal = true;
        let hasOps = false;
        for (const method of methods) {
          const op = (pathItem as Record<string, unknown>)[method] as
            | { tags?: string[] }
            | undefined;
          if (!op) continue;
          hasOps = true;
          const isInternal = op.tags?.some((t) => internalSet.has(t)) ?? false;
          if (!isInternal) allInternal = false;
        }
        if (hasOps && allInternal) internalPathCount++;
      }

      expect(internalPathCount).toBeGreaterThan(0);
    });

    it.skipIf(!specExists)("keeps client-facing endpoints", () => {
      const spec = JSON.parse(readFileSync(openapiPath, "utf-8"));
      const internalSet = new Set(INTERNAL_TAGS);
      const methods = ["get", "post", "put", "patch", "delete"];

      const publicPaths: string[] = [];
      for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const method of methods) {
          const op = (pathItem as Record<string, unknown>)[method] as
            | { tags?: string[] }
            | undefined;
          if (!op) continue;
          const isInternal = op.tags?.some((t) => internalSet.has(t)) ?? false;
          if (!isInternal) publicPaths.push(`${method.toUpperCase()} ${path}`);
        }
      }

      // Should have campaigns, keys, brand, etc.
      expect(publicPaths.some((p) => p.includes("/campaigns"))).toBe(true);
      expect(publicPaths.some((p) => p.includes("/keys"))).toBe(true);
      expect(publicPaths.some((p) => p.includes("/brands"))).toBe(true);
      // Should NOT have internal paths
      expect(publicPaths.some((p) => p.includes("/internal/"))).toBe(false);
      expect(publicPaths.some((p) => p.includes("/platform/"))).toBe(false);
    });
  });
});
