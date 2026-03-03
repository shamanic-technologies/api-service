import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression: api-service previously forwarded provider key CRUD to key-service
 * at /internal/keys. After key-service breaking change, all /internal/* routes
 * were removed. Routes now use /keys, /api-keys, /platform-keys directly.
 *
 * Also: orgId is no longer sent in request bodies or query params — key-service
 * reads it from x-org-id header.
 */
describe("provider key routes forward to /keys (no /internal/ prefix)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../src/routes/keys.ts"),
    "utf-8"
  );

  it("GET /v1/keys should forward to /keys on key-service", () => {
    expect(src).toContain('"/keys"');
  });

  it("POST /v1/keys should forward to /keys on key-service", () => {
    expect(src).toContain('"/keys"');
  });

  it("DELETE /v1/keys/:provider should forward to /keys/:provider on key-service", () => {
    expect(src).toContain('`/keys/${encodeURIComponent(provider)}`');
  });

  it("should NOT use /internal/ prefix for any key-service calls", () => {
    const internalCalls = src.match(/\/internal\//g);
    expect(internalCalls).toBeNull();
  });

  it("should NOT pass orgId in request bodies", () => {
    // Ensure no body contains orgId for key-service calls
    const orgIdInBody = src.match(/body:\s*\{[^}]*orgId/g);
    expect(orgIdInBody).toBeNull();
  });
});

describe("workflows fetchOrgKeys forwards to /keys (no /internal/ prefix)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../src/routes/workflows.ts"),
    "utf-8"
  );

  it("fetchOrgKeys should call /keys on key-service", () => {
    expect(src).toContain('"/keys"');
  });

  it("should NOT use /internal/ prefix for key-service calls", () => {
    const keyServiceInternalCalls = src.match(/externalServices\.key[^)]*\/internal\//g);
    expect(keyServiceInternalCalls).toBeNull();
  });
});
