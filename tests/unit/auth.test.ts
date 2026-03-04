import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const authPath = path.join(__dirname, "../../src/middleware/auth.ts");
const content = fs.readFileSync(authPath, "utf-8");

describe("Auth middleware — Bearer key authentication", () => {
  it("should only accept Bearer token authentication", () => {
    expect(content).toContain('authorization');
    expect(content).toContain('startsWith("Bearer ")');
  });

  it("should not use Clerk JWT verification", () => {
    expect(content).not.toContain("verifyToken");
    expect(content).not.toContain("@clerk/backend");
    expect(content).not.toContain("clerkJwt");
  });
});

describe("Auth middleware — admin key authentication", () => {
  it("should check Bearer token against ADMIN_DISTRIBUTE_API_KEY env var", () => {
    expect(content).toContain("ADMIN_DISTRIBUTE_API_KEY");
    expect(content).toContain("process.env.ADMIN_DISTRIBUTE_API_KEY");
  });

  it("should set authType to admin for admin key", () => {
    expect(content).toContain('"admin"');
  });

  it("should resolve external IDs via client-service for admin requests", () => {
    expect(content).toContain("Admin identity resolution");
    expect(content).toContain("resolveExternalIds");
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

  it("should not have app_key auth type", () => {
    expect(content).not.toContain('"app_key"');
    expect(content).not.toContain("app_key");
  });
});

describe("Auth middleware — identity resolution", () => {
  it("should read external IDs from x-org-id and x-user-id headers", () => {
    expect(content).toContain('"x-org-id"');
    expect(content).toContain('"x-user-id"');
  });

  it("should NOT set appId on the request", () => {
    expect(content).not.toContain("req.appId");
    expect(content).not.toContain("appId?: string");
  });

  it("should resolve external IDs via client-service POST /resolve", () => {
    expect(content).toContain('"/resolve"');
    expect(content).toContain("externalServices.client");
    expect(content).toContain('method: "POST"');
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

describe("Auth middleware — user key authentication", () => {
  it("should use orgId directly from key-service for user keys", () => {
    expect(content).toContain("validation.orgId");
  });

  it("should set authType to user_key for user key authentication", () => {
    expect(content).toContain('"user_key"');
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
