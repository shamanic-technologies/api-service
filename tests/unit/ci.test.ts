import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

describe("GitHub Actions CI", () => {
  const root = resolve(import.meta.dirname, "../..");
  const ciPath = resolve(root, ".github/workflows/ci.yml");

  it("ci.yml exists", () => {
    expect(existsSync(ciPath)).toBe(true);
  });

  const ci = readFileSync(ciPath, "utf-8");

  it("runs unit tests", () => {
    expect(ci).toContain("pnpm test:unit");
  });

  it("checks openapi.json stays in sync with Zod schemas", () => {
    expect(ci).toContain("pnpm generate:openapi");
    expect(ci).toContain("git diff --exit-code openapi.json");
  });

  it("builds shared packages before tests", () => {
    expect(ci).toContain('pnpm --filter "./shared/*" build');
  });
});
