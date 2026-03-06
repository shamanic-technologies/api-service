import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const authPath = path.join(__dirname, "../../src/middleware/auth.ts");
const content = fs.readFileSync(authPath, "utf-8");

describe("Auth middleware — X-API-Key for admin, Bearer for user keys", () => {
  it("should check X-API-Key header for admin auth", () => {
    expect(content).toContain('"x-api-key"');
    expect(content).toContain("ADMIN_DISTRIBUTE_API_KEY");
    expect(content).toContain("process.env.ADMIN_DISTRIBUTE_API_KEY");
  });

  it("should accept Bearer token for user key auth", () => {
    expect(content).toContain('authorization');
    expect(content).toContain('startsWith("Bearer ")');
  });

  it("should not use Clerk JWT verification", () => {
    expect(content).not.toContain("verifyToken");
    expect(content).not.toContain("@clerk/backend");
    expect(content).not.toContain("clerkJwt");
  });

  it("should not reference Clerk anywhere", () => {
    expect(content.toLowerCase()).not.toContain("clerk");
  });
});

describe("Auth middleware — admin auth requires both external ID headers", () => {
  it("should read external IDs from x-external-org-id and x-external-user-id headers", () => {
    expect(content).toContain('"x-external-org-id"');
    expect(content).toContain('"x-external-user-id"');
  });

  it("should NOT read from legacy x-org-id / x-user-id for admin identity", () => {
    // x-org-id and x-user-id should only appear in requireOrg logging, not in admin identity resolution
    const adminSection = content.split("Path 2")[0]; // everything before user key path
    expect(adminSection).not.toContain('"x-org-id"');
    expect(adminSection).not.toContain('"x-user-id"');
  });

  it("should return 400 when either external ID header is missing", () => {
    expect(content).toContain("Admin auth requires both x-external-org-id and x-external-user-id");
  });

  it("should NOT have single-ID resolution functions", () => {
    expect(content).not.toContain("resolveExternalUserId");
    expect(content).not.toContain("resolveExternalOrgId");
    expect(content).not.toContain("by-clerk");
    expect(content).not.toContain("by-external");
  });

  it("should set authType to admin for admin key", () => {
    expect(content).toContain('"admin"');
  });
});

describe("Auth middleware — identity resolution via POST /resolve", () => {
  it("should resolve external IDs via client-service POST /resolve", () => {
    expect(content).toContain('"/resolve"');
    expect(content).toContain("externalServices.client");
    expect(content).toContain('method: "POST"');
  });

  it("should forward optional profile headers (x-email, x-first-name, x-last-name)", () => {
    expect(content).toContain('"x-email"');
    expect(content).toContain('"x-first-name"');
    expect(content).toContain('"x-last-name"');
  });

  it("should NOT set appId on the request", () => {
    expect(content).not.toContain("req.appId");
    expect(content).not.toContain("appId?: string");
  });

  it("should return 502 when identity resolution fails", () => {
    expect(content).toContain("502");
    expect(content).toContain("Identity resolution failed");
  });

  it("should return 502 when identity resolution returns incomplete data", () => {
    expect(content).toContain("Identity resolution returned incomplete data");
    expect(content).toContain("!resolved.orgId || !resolved.userId");
  });
});

describe("Auth middleware — key-service validation (user keys only)", () => {
  it("should validate user keys via key-service /validate using callExternalService", () => {
    expect(content).toContain("/validate");
    expect(content).toContain("externalServices.key");
    expect(content).toContain("callExternalService");
  });

  it("should pass the API key as a query parameter", () => {
    expect(content).toContain("?key=");
    expect(content).toContain("encodeURIComponent(apiKey)");
  });

  it("should use orgId directly from key-service for user keys", () => {
    expect(content).toContain("validation.orgId");
  });

  it("should set authType to user_key for user key authentication", () => {
    expect(content).toContain('"user_key"');
  });

  it("should not have app_key auth type", () => {
    expect(content).not.toContain('"app_key"');
    expect(content).not.toContain("app_key");
  });
});

describe("Auth middleware — run creation is mandatory (not best-effort)", () => {
  it("should return 502 when run creation fails, not silently continue", () => {
    expect(content).toContain("Run tracking unavailable");
    expect(content).toContain("return res.status(502)");
  });

  it("should not swallow run creation errors with console.warn", () => {
    expect(content).not.toContain('console.warn("[auth] Failed to create request run:');
  });
});

describe("Auth middleware — requireOrg and requireUser exports", () => {
  it("should export requireOrg middleware", () => {
    expect(content).toContain("export function requireOrg");
  });

  it("should export requireUser middleware", () => {
    expect(content).toContain("export function requireUser");
  });

  it("should return 401 when userId is missing", () => {
    expect(content).toContain("User identity required");
  });

  it("should return 400 when orgId is missing", () => {
    expect(content).toContain("Organization context required");
  });
});
