import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const invitesRoutePath = path.join(__dirname, "../../src/routes/invites.ts");
const invitesContent = fs.readFileSync(invitesRoutePath, "utf-8");

const waitlistRoutePath = path.join(__dirname, "../../src/routes/waitlist.ts");
const waitlistContent = fs.readFileSync(waitlistRoutePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

function blockFor(file: string, method: string, routePath: string): string {
  const escPath = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sigRe = new RegExp(`router\\.${method}\\(\\s*"${escPath}"`);
  const m = sigRe.exec(file);
  if (!m) return "";
  const start = m.index;
  const rest = file.slice(start + m[0].length);
  const nextRouter = rest.search(/\nrouter\.[a-z]+\(/);
  const nextExport = rest.search(/\nexport default/);
  const ends = [nextRouter, nextExport].filter((n) => n >= 0);
  const end = ends.length > 0 ? Math.min(...ends) : rest.length;
  return file.substring(start, start + m[0].length + end);
}

describe("Invites proxy routes", () => {
  it("POST /invites/validate is public (no authenticate middleware)", () => {
    const block = blockFor(invitesContent, "post", "/invites/validate");
    expect(block).not.toBe("");
    expect(block).not.toContain("authenticate");
    expect(block).toContain("/public/invites/validate");
  });

  it("GET /orgs/:orgId/invites/status uses authenticate + requireOrg + requireUser", () => {
    const block = blockFor(invitesContent, "get", "/orgs/:orgId/invites/status");
    expect(block).not.toBe("");
    expect(block).toContain("authenticate");
    expect(block).toContain("requireOrg");
    expect(block).toContain("requireUser");
    expect(block).toContain("/internal/orgs/");
    expect(block).toContain("/invites/status");
  });

  it("POST /orgs/:orgId/invites/claim uses authenticate + requireOrg + requireUser", () => {
    const block = blockFor(invitesContent, "post", "/orgs/:orgId/invites/claim");
    expect(block).not.toBe("");
    expect(block).toContain("authenticate");
    expect(block).toContain("requireOrg");
    expect(block).toContain("requireUser");
    expect(block).toContain("/internal/orgs/");
    expect(block).toContain("/invites/claim");
  });

  it("authed routes guard params.orgId !== req.orgId with 403", () => {
    expect(invitesContent).toContain("req.params.orgId");
    expect(invitesContent).toContain("!== req.orgId");
    expect(invitesContent).toContain("res.status(403)");
  });

  it("uses callExternalService(externalServices.client, ...)", () => {
    expect(invitesContent).toContain("externalServices.client");
    expect(invitesContent).toContain("callExternalService");
  });

  it("does NOT call billing or transactional-email (no aggregation per CLAUDE.md #2)", () => {
    expect(invitesContent).not.toContain("externalServices.billing");
    expect(invitesContent).not.toContain("externalServices.transactionalEmail");
  });

  it("forwards identity headers via buildInternalHeaders on authed routes", () => {
    expect(invitesContent).toContain("buildInternalHeaders(req)");
  });

  it("propagates upstream status + error message verbatim (CLAUDE.md #7)", () => {
    expect(invitesContent).toContain("error.statusCode");
    expect(invitesContent).toContain("error.message");
  });
});

describe("Waitlist proxy routes", () => {
  it("POST /waitlist/request-access is public (no authenticate middleware)", () => {
    const block = blockFor(waitlistContent, "post", "/waitlist/request-access");
    expect(block).not.toBe("");
    expect(block).not.toContain("authenticate");
    expect(block).toContain("/public/waitlist/request-access");
  });

  it("GET /waitlist/position is public (no authenticate middleware)", () => {
    const block = blockFor(waitlistContent, "get", "/waitlist/position");
    expect(block).not.toBe("");
    expect(block).not.toContain("authenticate");
    expect(block).toContain("/public/waitlist/position");
  });

  it("forwards email query param to downstream", () => {
    expect(waitlistContent).toContain("req.query");
    expect(waitlistContent).toContain('"email"');
  });

  it("uses callExternalService(externalServices.client, ...)", () => {
    expect(waitlistContent).toContain("externalServices.client");
    expect(waitlistContent).toContain("callExternalService");
  });

  it("does NOT call transactional-email (orchestration is client-service's job)", () => {
    expect(waitlistContent).not.toContain("externalServices.transactionalEmail");
  });

  it("propagates upstream status + error message verbatim (CLAUDE.md #7)", () => {
    expect(waitlistContent).toContain("error.statusCode");
    expect(waitlistContent).toContain("error.message");
  });
});

describe("Invites + Waitlist OpenAPI schemas", () => {
  it("registers all five paths in src/schemas.ts", () => {
    expect(schemaContent).toContain('path: "/v1/invites/validate"');
    expect(schemaContent).toContain('path: "/v1/waitlist/request-access"');
    expect(schemaContent).toContain('path: "/v1/waitlist/position"');
    expect(schemaContent).toContain('path: "/v1/orgs/{orgId}/invites/status"');
    expect(schemaContent).toContain('path: "/v1/orgs/{orgId}/invites/claim"');
  });

  it("all response schemas are passthrough (CLAUDE.md #8)", () => {
    expect(schemaContent).toContain(
      'z.object({}).passthrough().openapi("InviteValidateResponse")',
    );
    expect(schemaContent).toContain(
      'z.object({}).passthrough().openapi("WaitlistRequestAccessResponse")',
    );
    expect(schemaContent).toContain(
      'z.object({}).passthrough().openapi("WaitlistPositionResponse")',
    );
    expect(schemaContent).toContain(
      'z.object({}).passthrough().openapi("OrgInvitesStatusResponse")',
    );
    expect(schemaContent).toContain(
      'z.object({}).passthrough().openapi("OrgInvitesClaimResponse")',
    );
  });

  it("uses Invites + Waitlist tags", () => {
    expect(schemaContent).toContain('tags: ["Invites"]');
    expect(schemaContent).toContain('tags: ["Waitlist"]');
  });

  it("authed paths declare security: authed", () => {
    const statusBlock = schemaContent.match(
      /path: "\/v1\/orgs\/\{orgId\}\/invites\/status"[\s\S]*?\}\);/,
    );
    const claimBlock = schemaContent.match(
      /path: "\/v1\/orgs\/\{orgId\}\/invites\/claim"[\s\S]*?\}\);/,
    );
    expect(statusBlock).not.toBeNull();
    expect(claimBlock).not.toBeNull();
    expect(statusBlock![0]).toContain("security: authed");
    expect(claimBlock![0]).toContain("security: authed");
  });

  it("public paths do NOT declare security", () => {
    const validateBlock = schemaContent.match(
      /path: "\/v1\/invites\/validate"[\s\S]*?\}\);/,
    );
    const reqAccessBlock = schemaContent.match(
      /path: "\/v1\/waitlist\/request-access"[\s\S]*?\}\);/,
    );
    const positionBlock = schemaContent.match(
      /path: "\/v1\/waitlist\/position"[\s\S]*?\}\);/,
    );
    expect(validateBlock).not.toBeNull();
    expect(reqAccessBlock).not.toBeNull();
    expect(positionBlock).not.toBeNull();
    expect(validateBlock![0]).not.toContain("security: authed");
    expect(reqAccessBlock![0]).not.toContain("security: authed");
    expect(positionBlock![0]).not.toContain("security: authed");
  });
});

describe("Invites + Waitlist routes wired in index.ts", () => {
  it("imports both routers from ./routes/invites and ./routes/waitlist", () => {
    expect(indexContent).toContain("invitesRoutes");
    expect(indexContent).toContain("./routes/invites");
    expect(indexContent).toContain("waitlistRoutes");
    expect(indexContent).toContain("./routes/waitlist");
  });

  it("mounts both under /v1", () => {
    expect(indexContent).toMatch(/app\.use\("\/v1",\s*invitesRoutes\)/);
    expect(indexContent).toMatch(/app\.use\("\/v1",\s*waitlistRoutes\)/);
  });
});
