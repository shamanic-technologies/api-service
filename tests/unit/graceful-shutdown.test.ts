import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(__dirname, "../../src/index.ts"), "utf-8");

/**
 * Regression test: the api-service must handle SIGTERM/SIGINT gracefully
 * so that in-flight requests complete before the process exits.
 * Without this, Railway container restarts cause 500s on slow endpoints.
 */
describe("graceful shutdown", () => {
  it("should register SIGTERM handler", () => {
    expect(indexSrc).toContain('process.on("SIGTERM"');
  });

  it("should register SIGINT handler", () => {
    expect(indexSrc).toContain('process.on("SIGINT"');
  });

  it("should call server.close() for connection draining", () => {
    expect(indexSrc).toContain("server.close(");
  });

  it("should have a forced exit timeout shorter than Railway's SIGKILL delay", () => {
    // Railway sends SIGKILL ~10s after SIGTERM; our timeout must be less
    const match = indexSrc.match(/SHUTDOWN_TIMEOUT_MS\s*=\s*(\d[\d_]*)/);
    expect(match).not.toBeNull();
    const ms = Number(match![1].replace(/_/g, ""));
    expect(ms).toBeLessThan(10_000);
    expect(ms).toBeGreaterThan(0);
  });

  it("should export the server instance for testability", () => {
    expect(indexSrc).toContain("export { server }");
  });
});
