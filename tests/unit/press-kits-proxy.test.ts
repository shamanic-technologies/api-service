import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/press-kits.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

describe("Press Kits proxy routes", () => {
  // ── Public endpoints (no auth) ──────────────────────────────────────────

  it("should have public GET /press-kits/public/:token without auth", () => {
    expect(content).toContain('"/press-kits/public/:token"');
    // Public route should NOT have authenticate middleware on this line
    const publicLine = content.split("\n").find((l) => l.includes('"/press-kits/public/:token"'));
    expect(publicLine).not.toContain("authenticate");
  });

  it("should have public GET /press-kits/public-media-kit/:token without auth", () => {
    expect(content).toContain('"/press-kits/public-media-kit/:token"');
    const publicLine = content.split("\n").find((l) => l.includes('"/press-kits/public-media-kit/:token"'));
    expect(publicLine).not.toContain("authenticate");
  });

  it("should have public GET /press-kits/email-data/press-kit/:orgId without auth", () => {
    expect(content).toContain('"/press-kits/email-data/press-kit/:orgId"');
    const publicLine = content.split("\n").find((l) => l.includes('"/press-kits/email-data/press-kit/:orgId"'));
    expect(publicLine).not.toContain("authenticate");
  });

  // ── Authenticated endpoints ─────────────────────────────────────────────

  it("should have POST /press-kits/organizations with auth", () => {
    expect(content).toContain('"/press-kits/organizations"');
    expect(content).toContain("router.post");
  });

  it("should have GET /press-kits/organizations/share-token/:orgId with auth", () => {
    expect(content).toContain('"/press-kits/organizations/share-token/:orgId"');
  });

  it("should have GET /press-kits/organizations/exists with auth", () => {
    expect(content).toContain('"/press-kits/organizations/exists"');
  });

  it("should have GET /press-kits/media-kit with auth", () => {
    expect(content).toContain('"/press-kits/media-kit"');
  });

  it("should have GET /press-kits/media-kit/:id with auth", () => {
    expect(content).toContain('"/press-kits/media-kit/:id"');
  });

  it("should have POST /press-kits/edit-media-kit with auth", () => {
    expect(content).toContain('"/press-kits/edit-media-kit"');
  });

  it("should have POST /press-kits/update-mdx with auth", () => {
    expect(content).toContain('"/press-kits/update-mdx"');
  });

  it("should have POST /press-kits/update-status with auth", () => {
    expect(content).toContain('"/press-kits/update-status"');
  });

  it("should have POST /press-kits/validate with auth", () => {
    expect(content).toContain('"/press-kits/validate"');
  });

  it("should have POST /press-kits/cancel-draft with auth", () => {
    expect(content).toContain('"/press-kits/cancel-draft"');
  });

  // ── Admin endpoints ───────────────────────────────────────────────────

  it("should have GET /press-kits/admin/organizations with auth", () => {
    expect(content).toContain('"/press-kits/admin/organizations"');
  });

  it("should have DELETE /press-kits/admin/organizations/:id with auth", () => {
    expect(content).toContain('"/press-kits/admin/organizations/:id"');
    expect(content).toContain("router.delete");
  });

  // ── Internal endpoints ────────────────────────────────────────────────

  it("should have GET /press-kits/internal/media-kit/by-org/:orgId with auth", () => {
    expect(content).toContain('"/press-kits/internal/media-kit/by-org/:orgId"');
  });

  it("should have GET /press-kits/internal/generation-data with auth", () => {
    expect(content).toContain('"/press-kits/internal/generation-data"');
  });

  it("should have POST /press-kits/internal/upsert-generation-result with auth", () => {
    expect(content).toContain('"/press-kits/internal/upsert-generation-result"');
  });

  it("should have GET /press-kits/clients-media-kits-need-update with auth", () => {
    expect(content).toContain('"/press-kits/clients-media-kits-need-update"');
  });

  it("should have GET /press-kits/media-kit-setup with auth", () => {
    expect(content).toContain('"/press-kits/media-kit-setup"');
  });

  it("should have GET /press-kits/health/bulk with auth", () => {
    expect(content).toContain('"/press-kits/health/bulk"');
  });

  // ── Auth & middleware checks ──────────────────────────────────────────

  it("should use authenticate and requireOrg on all authenticated endpoints", () => {
    const authMatches = content.match(/authenticate, requireOrg/g);
    expect(authMatches).not.toBeNull();
    // 18 authenticated routes + 1 import = 19
    expect(authMatches!.length).toBe(19);
  });

  it("should use buildInternalHeaders for all authenticated endpoints", () => {
    expect(content).toContain("buildInternalHeaders");
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(18);
  });

  it("should proxy to externalServices.pressKits", () => {
    expect(content).toContain("externalServices.pressKits");
  });
});

describe("Press Kits service client", () => {
  it("should have pressKits in externalServices", () => {
    expect(serviceClientContent).toContain("pressKits:");
    expect(serviceClientContent).toContain("PRESS_KITS_SERVICE_URL");
    expect(serviceClientContent).toContain("PRESS_KITS_SERVICE_API_KEY");
  });
});

describe("Press Kits OpenAPI schemas", () => {
  it("should register public paths", () => {
    expect(schemaContent).toContain('path: "/press-kits/public/{token}"');
    expect(schemaContent).toContain('path: "/press-kits/public-media-kit/{token}"');
    expect(schemaContent).toContain('path: "/press-kits/email-data/press-kit/{orgId}"');
  });

  it("should register authenticated paths", () => {
    expect(schemaContent).toContain('path: "/v1/press-kits/organizations"');
    expect(schemaContent).toContain('path: "/v1/press-kits/organizations/share-token/{orgId}"');
    expect(schemaContent).toContain('path: "/v1/press-kits/organizations/exists"');
    expect(schemaContent).toContain('path: "/v1/press-kits/media-kit"');
    expect(schemaContent).toContain('path: "/v1/press-kits/media-kit/{id}"');
    expect(schemaContent).toContain('path: "/v1/press-kits/edit-media-kit"');
    expect(schemaContent).toContain('path: "/v1/press-kits/update-mdx"');
    expect(schemaContent).toContain('path: "/v1/press-kits/update-status"');
    expect(schemaContent).toContain('path: "/v1/press-kits/validate"');
    expect(schemaContent).toContain('path: "/v1/press-kits/cancel-draft"');
  });

  it("should register admin paths", () => {
    expect(schemaContent).toContain('path: "/v1/press-kits/admin/organizations"');
    expect(schemaContent).toContain('path: "/v1/press-kits/admin/organizations/{id}"');
  });

  it("should register internal paths", () => {
    expect(schemaContent).toContain('path: "/v1/press-kits/internal/media-kit/by-org/{orgId}"');
    expect(schemaContent).toContain('path: "/v1/press-kits/internal/generation-data"');
    expect(schemaContent).toContain('path: "/v1/press-kits/internal/upsert-generation-result"');
    expect(schemaContent).toContain('path: "/v1/press-kits/clients-media-kits-need-update"');
    expect(schemaContent).toContain('path: "/v1/press-kits/media-kit-setup"');
    expect(schemaContent).toContain('path: "/v1/press-kits/health/bulk"');
  });

  it("should use Press Kits tag for non-internal endpoints", () => {
    expect(schemaContent).toContain('tags: ["Press Kits"]');
  });

  it("should use Internal tag for internal endpoints", () => {
    // Internal press-kit endpoints should use Internal tag
    const internalPaths = [
      "/v1/press-kits/internal/media-kit/by-org/{orgId}",
      "/v1/press-kits/internal/generation-data",
      "/v1/press-kits/internal/upsert-generation-result",
      "/v1/press-kits/clients-media-kits-need-update",
      "/v1/press-kits/media-kit-setup",
      "/v1/press-kits/health/bulk",
    ];
    for (const p of internalPaths) {
      expect(schemaContent).toContain(`path: "${p}"`);
    }
  });
});

describe("Press Kits routes are mounted in index.ts", () => {
  it("should import and mount press-kits routes", () => {
    expect(indexContent).toContain("pressKitsRoutes");
    expect(indexContent).toContain("./routes/press-kits");
  });

  it("should mount at root for public endpoints", () => {
    expect(indexContent).toContain("app.use(pressKitsRoutes)");
  });

  it("should mount at /v1 for authenticated endpoints", () => {
    expect(indexContent).toContain('app.use("/v1", pressKitsRoutes)');
  });
});
