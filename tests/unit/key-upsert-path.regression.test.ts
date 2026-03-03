import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression: api-service forwarded provider key CRUD to key-service at
 * /keys (GET, POST) and /keys/:provider (DELETE). These paths don't exist
 * in key-service — they live under /internal/keys. The requests fell through
 * to key-service's 404 handler, returning {"error":"Not found"}.
 *
 * Fix: forward to /internal/keys, /internal/keys/:provider instead.
 */
describe("provider key routes forward to /internal/keys", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../src/routes/keys.ts"),
    "utf-8"
  );

  it("GET /v1/keys should forward to /internal/keys on key-service", () => {
    expect(src).toContain('`/internal/keys?${params}`');
  });

  it("POST /v1/keys should forward to /internal/keys on key-service", () => {
    expect(src).toContain('"/internal/keys"');
  });

  it("DELETE /v1/keys/:provider should forward to /internal/keys/:provider on key-service", () => {
    expect(src).toContain('`/internal/keys/${encodeURIComponent(provider)}?${params}`');
  });

  it("should NOT call /keys directly (without /internal prefix)", () => {
    // Extract only the provider keys section (before the API keys section)
    const providerSection = src.split("// API keys")[0];
    // Check that no callExternalService call uses bare /keys path
    const bareKeyCalls = providerSection.match(/callExternalService\([^)]*,\s*["'`]\/keys[^i]/g);
    expect(bareKeyCalls).toBeNull();
  });
});

describe("workflows fetchOrgKeys forwards to /internal/keys", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../src/routes/workflows.ts"),
    "utf-8"
  );

  it("fetchOrgKeys should call /internal/keys on key-service", () => {
    expect(src).toContain('`/internal/keys?orgId=${encodeURIComponent(orgId)}`');
  });

  it("should NOT call bare /keys on key-service", () => {
    const bareKeyCalls = src.match(/callExternalService\([^)]*key[^)]*,\s*["'`]\/keys[^i]/g);
    expect(bareKeyCalls).toBeNull();
  });
});
