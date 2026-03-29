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
    const publicLine = content.split("\n").find((l) => l.includes('"/press-kits/public/:token"'));
    expect(publicLine).not.toContain("authenticate");
  });

  it("should NOT have legacy /press-kits/public-media-kit route (removed upstream)", () => {
    expect(content).not.toContain("/press-kits/public-media-kit");
  });

  it("should NOT have public /press-kits/email-data route (moved to internal)", () => {
    // email-data is now internal, not public
    const publicEmailLine = content.split("\n").find((l) =>
      l.includes('"/press-kits/email-data/') && !l.includes("internal")
    );
    expect(publicEmailLine).toBeUndefined();
  });

  // ── Authenticated endpoints ─────────────────────────────────────────────

  it("should NOT have POST /press-kits/organizations (removed upstream, auto-created by POST /media-kits)", () => {
    const postOrgLine = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/press-kits/organizations"')
    );
    expect(postOrgLine).toBeUndefined();
  });

  it("should NOT have GET /press-kits/organizations/:orgId/share-token (removed upstream)", () => {
    expect(content).not.toContain('"/press-kits/organizations/:orgId/share-token"');
  });

  it("should NOT have GET /press-kits/organizations/exists (removed upstream)", () => {
    expect(content).not.toContain('"/press-kits/organizations/exists"');
  });

  it("should have GET /press-kits/media-kits (plural) with auth", () => {
    expect(content).toContain('"/press-kits/media-kits"');
  });

  it("should forward campaign_id query param on GET /media-kits", () => {
    expect(content).toContain('params.set("campaign_id"');
  });

  it("should have GET /press-kits/media-kits/:id with auth", () => {
    expect(content).toContain('"/press-kits/media-kits/:id"');
  });

  it("should have POST /press-kits/media-kits (create-or-edit) with auth", () => {
    const postLine = content.split("\n").find((l) =>
      l.includes("router.post") && l.includes('"/press-kits/media-kits"')
    );
    expect(postLine).toBeDefined();
  });

  it("should have PATCH /press-kits/media-kits/:id/mdx with auth", () => {
    expect(content).toContain('"/press-kits/media-kits/:id/mdx"');
    expect(content).toContain("router.patch");
  });

  it("should have PATCH /press-kits/media-kits/:id/status with auth", () => {
    expect(content).toContain('"/press-kits/media-kits/:id/status"');
  });

  it("should have POST /press-kits/media-kits/:id/validate with auth", () => {
    expect(content).toContain('"/press-kits/media-kits/:id/validate"');
  });

  it("should have POST /press-kits/media-kits/:id/cancel with auth", () => {
    expect(content).toContain('"/press-kits/media-kits/:id/cancel"');
  });

  // ── Stats endpoints ────────────────────────────────────────────────────

  it("should have GET /press-kits/media-kits/stats/views with auth", () => {
    expect(content).toContain('"/press-kits/media-kits/stats/views"');
  });

  it("should forward stats query params (brandId, campaignId, mediaKitId, from, to, groupBy)", () => {
    for (const key of ["brandId", "campaignId", "mediaKitId", "from", "to", "groupBy"]) {
      expect(content).toContain(`"${key}"`);
    }
  });

  // ── Admin endpoints ───────────────────────────────────────────────────

  it("should have GET /press-kits/admin/media-kits with auth", () => {
    expect(content).toContain('"/press-kits/admin/media-kits"');
  });

  it("should have DELETE /press-kits/admin/media-kits/:id with auth", () => {
    expect(content).toContain('"/press-kits/admin/media-kits/:id"');
    expect(content).toContain("router.delete");
  });

  it("should NOT have old /admin/organizations routes (moved to /admin/media-kits)", () => {
    expect(content).not.toContain('"/press-kits/admin/organizations"');
    expect(content).not.toContain('"/press-kits/admin/organizations/:id"');
  });

  // ── Internal endpoints (new REST paths) ───────────────────────────────

  it("should have GET /press-kits/internal/media-kits/current with auth", () => {
    expect(content).toContain('"/press-kits/internal/media-kits/current"');
  });

  it("should have GET /press-kits/internal/media-kits/generation-data with auth", () => {
    expect(content).toContain('"/press-kits/internal/media-kits/generation-data"');
  });

  it("should have POST /press-kits/internal/media-kits/generation-result with auth", () => {
    expect(content).toContain('"/press-kits/internal/media-kits/generation-result"');
  });

  it("should NOT have GET /press-kits/internal/media-kits/stale (removed upstream)", () => {
    expect(content).not.toContain('"/press-kits/internal/media-kits/stale"');
  });

  it("should NOT have GET /press-kits/internal/media-kits/setup (removed upstream)", () => {
    expect(content).not.toContain('"/press-kits/internal/media-kits/setup"');
  });

  it("should NOT have GET /press-kits/internal/health/bulk (removed upstream)", () => {
    expect(content).not.toContain('"/press-kits/internal/health/bulk"');
  });

  it("should have GET /press-kits/internal/email-data/:orgId with auth", () => {
    expect(content).toContain('"/press-kits/internal/email-data/:orgId"');
  });

  // ── Auth & middleware checks ──────────────────────────────────────────

  it("should use authenticate and requireOrg on all authenticated endpoints", () => {
    const authMatches = content.match(/authenticate, requireOrg/g);
    expect(authMatches).not.toBeNull();
    // 14 authenticated routes + 1 import = 15
    expect(authMatches!.length).toBe(15);
  });

  it("should use buildInternalHeaders for all authenticated endpoints", () => {
    expect(content).toContain("buildInternalHeaders");
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(14);
  });

  it("should proxy to externalServices.pressKits", () => {
    expect(content).toContain("externalServices.pressKits");
  });

  // ── Old endpoints removed ─────────────────────────────────────────────

  it("should NOT have old singular /media-kit path (now /media-kits)", () => {
    // Only /media-kits (plural) should exist, not /media-kit (singular) standalone
    expect(content).not.toContain('"/press-kits/media-kit"');
  });

  it("should NOT have old /edit-media-kit path", () => {
    expect(content).not.toContain("/edit-media-kit");
  });

  it("should NOT have old /update-mdx path", () => {
    expect(content).not.toContain('"/press-kits/update-mdx"');
  });

  it("should NOT have old /update-status path", () => {
    expect(content).not.toContain('"/press-kits/update-status"');
  });

  it("should NOT have old /validate standalone path", () => {
    expect(content).not.toContain('"/press-kits/validate"');
  });

  it("should NOT have old /cancel-draft standalone path", () => {
    expect(content).not.toContain('"/press-kits/cancel-draft"');
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
  it("should register public path", () => {
    expect(schemaContent).toContain('path: "/press-kits/public/{token}"');
  });

  it("should NOT register removed legacy public paths", () => {
    expect(schemaContent).not.toContain('path: "/press-kits/public-media-kit/{token}"');
    expect(schemaContent).not.toContain('path: "/press-kits/email-data/press-kit/{orgId}"');
  });

  it("should register REST authenticated paths", () => {
    expect(schemaContent).not.toContain('path: "/v1/press-kits/organizations"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/organizations/{orgId}/share-token"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/organizations/exists"');
    expect(schemaContent).toContain('path: "/v1/press-kits/media-kits"');
    expect(schemaContent).toContain('path: "/v1/press-kits/media-kits/{id}"');
    expect(schemaContent).toContain('path: "/v1/press-kits/media-kits/{id}/mdx"');
    expect(schemaContent).toContain('path: "/v1/press-kits/media-kits/{id}/status"');
    expect(schemaContent).toContain('path: "/v1/press-kits/media-kits/{id}/validate"');
    expect(schemaContent).toContain('path: "/v1/press-kits/media-kits/{id}/cancel"');
  });

  it("should document campaign_id query param on GET /media-kits", () => {
    expect(schemaContent).toContain("campaign_id");
  });

  it("should use PATCH for mdx and status updates", () => {
    // Find the mdx path registration and verify it uses patch
    const mdxMatch = schemaContent.match(/method: "patch",\s*\n\s*path: "\/v1\/press-kits\/media-kits\/{id}\/mdx"/);
    expect(mdxMatch).not.toBeNull();
    const statusMatch = schemaContent.match(/method: "patch",\s*\n\s*path: "\/v1\/press-kits\/media-kits\/{id}\/status"/);
    expect(statusMatch).not.toBeNull();
  });

  it("should register stats paths", () => {
    expect(schemaContent).toContain('path: "/v1/press-kits/media-kits/stats/views"');
  });

  it("should register admin paths", () => {
    expect(schemaContent).toContain('path: "/v1/press-kits/admin/media-kits"');
    expect(schemaContent).toContain('path: "/v1/press-kits/admin/media-kits/{id}"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/admin/organizations"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/admin/organizations/{id}"');
  });

  it("should register new internal paths", () => {
    expect(schemaContent).toContain('path: "/v1/press-kits/internal/media-kits/current"');
    expect(schemaContent).toContain('path: "/v1/press-kits/internal/media-kits/generation-data"');
    expect(schemaContent).toContain('path: "/v1/press-kits/internal/media-kits/generation-result"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/internal/media-kits/stale"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/internal/media-kits/setup"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/internal/health/bulk"');
    expect(schemaContent).toContain('path: "/v1/press-kits/internal/email-data/{orgId}"');
  });

  it("should NOT have old internal paths", () => {
    expect(schemaContent).not.toContain('path: "/v1/press-kits/internal/media-kit/by-org/{orgId}"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/internal/generation-data"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/internal/upsert-generation-result"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/clients-media-kits-need-update"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/media-kit-setup"');
    expect(schemaContent).not.toContain('path: "/v1/press-kits/health/bulk"');
  });

  it("should use Press Kits tag for non-internal endpoints", () => {
    expect(schemaContent).toContain('tags: ["Press Kits"]');
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
