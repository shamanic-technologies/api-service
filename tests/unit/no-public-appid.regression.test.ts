import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression test: appId must NOT appear in the public API surface.
 *
 * Internal usage of req.appId (from auth middleware) is fine — it flows to
 * downstream services via internal headers. But no public endpoint should
 * accept, return, or document appId as a query param, body field, or path param.
 */

const schemasPath = path.join(__dirname, "../../src/schemas.ts");
const schemas = fs.readFileSync(schemasPath, "utf-8");

const routesDir = path.join(__dirname, "../../src/routes");
const routeFiles = fs
  .readdirSync(routesDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({
    name: f,
    content: fs.readFileSync(path.join(routesDir, f), "utf-8"),
  }));

describe("No public appId regression", () => {
  it("should not have appId in any registered OpenAPI path", () => {
    // Match path: "...{appId}..." patterns in registry.registerPath calls
    const pathMatches = schemas.match(/path:\s*"[^"]*\{appId\}[^"]*"/g);
    expect(pathMatches).toBeNull();
  });

  it("should not have appId as a query parameter in any OpenAPI schema", () => {
    // Look for appId in query schemas (z.object blocks used in request.query)
    // This checks that no registered query schema includes appId
    const lines = schemas.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("request:") || lines[i].includes("query:")) {
        // Check next 20 lines for appId in query context
        const block = lines.slice(i, i + 20).join("\n");
        if (block.includes("query:") && block.includes("appId")) {
          throw new Error(
            `Found appId in query schema near line ${i + 1} of schemas.ts`,
          );
        }
      }
    }
  });

  it("should not expose /v1/apps/register endpoint", () => {
    expect(schemas).not.toContain('"/v1/apps/register"');
    const appsRoute = path.join(routesDir, "apps.ts");
    expect(fs.existsSync(appsRoute)).toBe(false);
  });

  it("should not have keySource 'app' in UpsertKeyRequestSchema", () => {
    const upsertBlock = schemas.slice(
      schemas.indexOf("UpsertKeyRequestSchema"),
      schemas.indexOf("UpsertKeyRequestSchema") + 300,
    );
    // Should only have "org", not "app"
    expect(upsertBlock).toContain('"org"');
    expect(upsertBlock).not.toMatch(/enum\(\[.*"app".*\]\)/);
  });

  it("should not accept appId from query params in any route", () => {
    for (const { name, content } of routeFiles) {
      // req.query.appId should not exist — routes should use req.appId (from auth)
      if (content.includes("req.query.appId")) {
        throw new Error(
          `Found req.query.appId in ${name} — use req.appId from auth instead`,
        );
      }
    }
  });

  it("should not have app_id in DeductCreditsRequestSchema", () => {
    const deductBlock = schemas.slice(
      schemas.indexOf("DeductCreditsRequestSchema"),
      schemas.indexOf("DeductCreditsRequestSchema") + 300,
    );
    expect(deductBlock).not.toContain("app_id");
  });

  it("should not have {appId} path param in stripe webhook path", () => {
    expect(schemas).not.toContain('"/v1/billing/webhooks/stripe/{appId}"');
  });
});
