import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

describe("railway.json", () => {
  const root = resolve(import.meta.dirname, "../..");
  const config = JSON.parse(
    readFileSync(resolve(root, "railway.json"), "utf-8"),
  );

  it("references a Dockerfile that exists", () => {
    const dockerfilePath = resolve(root, config.build.dockerfilePath);
    expect(existsSync(dockerfilePath)).toBe(true);
  });

  it("uses DOCKERFILE builder", () => {
    expect(config.build.builder).toBe("DOCKERFILE");
  });

  it("has a health check configured", () => {
    expect(config.deploy.healthcheckPath).toBe("/health");
  });

  it("watches source and shared directories", () => {
    const patterns: string[] = config.build.watchPatterns;
    expect(patterns).toContain("/src/**");
    expect(patterns).toContain("/shared/**");
    expect(patterns).toContain("/pnpm-lock.yaml");
    expect(patterns).toContain("/Dockerfile");
  });

  it("has restart policy configured", () => {
    expect(config.deploy.restartPolicyType).toBe("ON_FAILURE");
    expect(config.deploy.restartPolicyMaxRetries).toBe(5);
  });
});
