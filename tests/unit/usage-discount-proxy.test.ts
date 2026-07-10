import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const routePath = path.join(__dirname, "../../src/routes/usage-discount.ts");
const content = fs.readFileSync(routePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

describe("Usage-discount proxy routes (source)", () => {
  it("should have GET/PUT/DELETE /billing/usage-discount routes", () => {
    expect(content).toContain('"/billing/usage-discount"');
    expect(content).toContain("router.get");
    expect(content).toContain("router.put");
    expect(content).toContain("router.delete");
  });

  it("should gate all three routes with authenticate + requireOrg + requireStaff", () => {
    // Match the route middleware chain only (followed by the async handler), so the
    // import statement's identical identifier list is not counted.
    const matches = content.match(/authenticate,\s*requireOrg,\s*requireStaff,\s*async \(req/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("should forward correct downstream billing paths (byte-equal to deployed contract)", () => {
    // billing-service GET/PUT/DELETE /v1/usage-discount
    const matches = content.match(/"\/v1\/usage-discount"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it("should proxy to externalServices.billing", () => {
    expect(content).toContain("externalServices.billing");
  });

  it("should forward body as-is on set (no transform)", () => {
    expect(content).toContain("body: req.body");
  });

  it("should forward the verified staff x-email downstream (setBy attribution)", () => {
    expect(content).toContain('headers["x-email"] = req.staffEmail');
  });
});

describe("Usage-discount OpenAPI schemas", () => {
  it("should register all three usage-discount paths", () => {
    expect(schemaContent).toContain('path: "/v1/billing/usage-discount"');
    const matches = schemaContent.match(/path: "\/v1\/billing\/usage-discount"/g);
    expect(matches!.length).toBe(3);
  });

  it("response schemas are passthrough (transparent proxy contract)", () => {
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("UsageDiscountResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("SetUsageDiscountResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("RemoveUsageDiscountResponse")');
  });

  it("should declare SetUsageDiscountRequest with discountPct", () => {
    expect(schemaContent).toContain("SetUsageDiscountRequest");
    expect(schemaContent).toContain("discountPct");
  });

  it("should gate the routes with the staff 403 response", () => {
    expect(schemaContent).toContain('403: { description: "Not staff"');
  });
});

describe("Usage-discount routes mounted in index.ts", () => {
  it("should import and mount usageDiscountRoutes", () => {
    expect(indexContent).toContain("usageDiscountRoutes");
    expect(indexContent).toContain("./routes/usage-discount");
  });
});
