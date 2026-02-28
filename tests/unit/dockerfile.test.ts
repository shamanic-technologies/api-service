import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Dockerfile", () => {
  const root = resolve(import.meta.dirname, "../..");
  const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf-8");

  it("does not use pnpm deploy (unsupported for root workspace package)", () => {
    expect(dockerfile).not.toContain("pnpm deploy");
  });

  it("installs prod-only deps in the production stage", () => {
    expect(dockerfile).toContain("pnpm install --prod");
  });

  it("copies shared package build output to production stage", () => {
    expect(dockerfile).toContain("shared/content/dist");
    expect(dockerfile).toContain("shared/runs-client/dist");
  });

  it("uses multi-stage build", () => {
    const fromStatements = dockerfile.match(/^FROM /gm);
    expect(fromStatements!.length).toBeGreaterThanOrEqual(2);
  });

  it("sets IPv4-first DNS for Neon compatibility", () => {
    expect(dockerfile).toContain("dns-result-order=ipv4first");
  });
});
