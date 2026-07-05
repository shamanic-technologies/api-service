import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/admin-brands.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

describe("Admin brands proxy route", () => {
  it("should have GET /admin/brands staff-gated (authenticatePlatform + requireStaff)", () => {
    const line = content.split("\n").find((l) =>
      l.includes("router.get") && l.includes('"/admin/brands"')
    );
    expect(line).toBeDefined();
    expect(line).toContain("authenticatePlatform");
    expect(line).toContain("requireStaff");
  });

  it("should proxy to brand-service /internal/brands/all (no path renaming)", () => {
    expect(content).toContain("externalServices.brand");
    expect(content).toContain('"/internal/brands/all"');
  });

  it("should forward response verbatim (no aggregation/transform)", () => {
    expect(content).toContain("res.json(result)");
  });
});

describe("Admin brands OpenAPI schema", () => {
  it("should register GET /v1/admin/brands with platformAuth", () => {
    expect(schemaContent).toContain('path: "/v1/admin/brands"');
    expect(schemaContent).toContain("AdminBrandsResponse");
  });

  it("should include /v1/admin/brands GET in committed openapi.json", () => {
    const openapiPath = path.join(__dirname, "../../openapi.json");
    const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));
    expect(openapi.paths["/v1/admin/brands"]).toBeDefined();
    expect(openapi.paths["/v1/admin/brands"].get).toBeDefined();
  });
});

describe("Admin brands route is mounted in index.ts", () => {
  it("should import and mount admin-brands routes at /v1", () => {
    expect(indexContent).toContain("adminBrandsRoutes");
    expect(indexContent).toContain("./routes/admin-brands");
    expect(indexContent).toContain('app.use("/v1", adminBrandsRoutes)');
  });
});
