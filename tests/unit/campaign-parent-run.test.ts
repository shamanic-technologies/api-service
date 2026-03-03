import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Run tracking is now handled by the auth middleware (creates a run per request)
 * and propagated via the x-run-id header in buildInternalHeaders().
 * Campaign routes should NOT create their own runs or pass parentRunId.
 */
describe("Campaign routes delegate run tracking to middleware", () => {
  const routePath = path.join(__dirname, "../../src/routes/campaigns.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should NOT import createRun from runs-client", () => {
    // createRun should not appear in the import statement
    const importLine = content.match(/import\s*{[^}]*}\s*from\s*["']@distribute\/runs-client["']/)?.[0] ?? "";
    expect(importLine).not.toContain("createRun");
  });

  it("should NOT import updateRun from runs-client", () => {
    const importLine = content.match(/import\s*{[^}]*}\s*from\s*["']@distribute\/runs-client["']/)?.[0] ?? "";
    expect(importLine).not.toContain("updateRun");
  });

  it("should NOT pass parentRunId in any request body", () => {
    expect(content).not.toContain("parentRunId");
  });

  it("should still import getRunsBatch for cost enrichment", () => {
    expect(content).toContain("getRunsBatch");
  });
});
