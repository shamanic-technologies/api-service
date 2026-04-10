import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression: scraping proxy routes MUST be transparent.
 *
 * The previous implementation (in brand.ts) manually constructed the request body,
 * which silently dropped new fields added by scraping-service (e.g. `provider`).
 * These routes now live in scraping.ts and forward req.body as-is.
 */

const src = fs.readFileSync(
  path.join(__dirname, "../../src/routes/scraping.ts"),
  "utf-8"
);

describe("scraping.ts — transparent proxy regression", () => {
  it("POST /scraping/scrape should forward req.body as-is (no field cherry-picking)", () => {
    const postBlock = src.match(
      /router\.post\("\/scraping\/scrape"[\s\S]*?}\);/
    );
    expect(postBlock).not.toBeNull();
    expect(postBlock![0]).toContain("body: req.body");
    // Must NOT manually construct body fields
    expect(postBlock![0]).not.toContain("sourceService");
    expect(postBlock![0]).not.toContain("sourceOrgId");
  });

  it("should NOT validate/filter the body with a Zod schema", () => {
    expect(src).not.toContain("safeParse");
    expect(src).not.toContain("BrandScrapeRequestSchema");
  });

  it("all routes should forward headers via buildInternalHeaders", () => {
    const callBlocks = src.match(/callExternalService\(/g);
    const headerBlocks = src.match(/headers: buildInternalHeaders\(req\)/g);
    expect(callBlocks).not.toBeNull();
    expect(headerBlocks).not.toBeNull();
    expect(headerBlocks!.length).toBe(callBlocks!.length);
  });

  it("scraping routes should no longer exist in brand.ts", () => {
    const brandSrc = fs.readFileSync(
      path.join(__dirname, "../../src/routes/brand.ts"),
      "utf-8"
    );
    expect(brandSrc).not.toContain('"/brand/scrape"');
    expect(brandSrc).not.toContain('"/brand/by-url"');
    expect(brandSrc).not.toContain('"/brand/:id"');
    expect(brandSrc).not.toContain("externalServices.scraping");
  });
});
