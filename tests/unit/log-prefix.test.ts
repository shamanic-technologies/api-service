import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const indexPath = path.join(__dirname, "../../src/index.ts");
const content = fs.readFileSync(indexPath, "utf-8");

describe("Console log prefix", () => {
  it("should override console.log with [api-service] prefix", () => {
    expect(content).toContain('console.log = ');
    expect(content).toContain('[api-service]');
  });

  it("should override console.error with [api-service] prefix", () => {
    expect(content).toContain('console.error = ');
  });

  it("should override console.warn with [api-service] prefix", () => {
    expect(content).toContain('console.warn = ');
  });

  it("should set up prefix before any imports that might log", () => {
    const prefixLine = content.indexOf('const PREFIX = "[api-service]"');
    const sentryImport = content.indexOf('import * as Sentry');
    expect(prefixLine).toBeGreaterThan(-1);
    expect(sentryImport).toBeGreaterThan(prefixLine);
  });
});
