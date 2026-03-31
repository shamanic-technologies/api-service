import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression: ensure all downstream service calls forward required headers
 * (x-org-id, x-user-id, x-run-id) via buildInternalHeaders(req) or equivalent.
 *
 * Gaps fixed:
 * 1. brand.ts POST /scrape — was missing headers entirely
 * 2. runs-client — getRun, getRunsBatch, updateRun, addCosts, getRunSummary
 *    didn't accept caller-provided headers (x-user-id was never forwarded)
 * 3. auth.ts updateRun — was not forwarding x-user-id
 * 4. brand.ts/campaigns.ts getRunsBatch calls — were not passing request headers
 */

const readSrc = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, "../..", relativePath), "utf-8");

describe("header forwarding audit", () => {
  describe("brand.ts — scraping service calls", () => {
    const src = readSrc("src/routes/brand.ts");

    it("POST /scrape should forward internal headers", () => {
      // Find the callExternalService block for scraping /scrape POST
      const scrapingMatch = src.match(
        /callExternalService\(\s*externalServices\.scraping,\s*"\/scrape",[\s\S]*?\)/
      );
      expect(scrapingMatch).not.toBeNull();
      expect(scrapingMatch![0]).toContain("headers: buildInternalHeaders(req)");
    });

    it("getRunsBatch should forward internal headers", () => {
      expect(src).toContain("getRunsBatch(runIds, req.orgId, buildInternalHeaders(req))");
    });
  });

  describe("campaigns.ts — getRunsBatch calls", () => {
    const src = readSrc("src/routes/campaigns.ts");

    it("enrichment run batch should forward internal headers", () => {
      expect(src).toContain(
        "getRunsBatch(enrichmentRunIds, req.orgId, buildInternalHeaders(req))"
      );
    });

    it("generation run batch should forward internal headers", () => {
      expect(src).toContain(
        "getRunsBatch(generationRunIds, req.orgId, buildInternalHeaders(req))"
      );
    });
  });

  describe("auth.ts — updateRun should forward x-user-id", () => {
    const src = readSrc("src/middleware/auth.ts");

    it("should pass headers with x-user-id to updateRun", () => {
      // The finish handler should build headers with userId and pass to updateRun
      expect(src).toContain('headers["x-user-id"] = req.userId');
      expect(src).toMatch(/updateRun\(run\.id,\s*status,\s*req\.orgId,\s*headers\)/);
    });
  });

  describe("auth.ts — workflow tracking headers extraction", () => {
    const src = readSrc("src/middleware/auth.ts");

    it("should extract x-campaign-id from incoming request", () => {
      expect(src).toContain('req.headers["x-campaign-id"]');
    });

    it("should extract x-brand-id from incoming request (supports CSV multi-brand)", () => {
      expect(src).toContain('req.headers["x-brand-id"]');
    });

    it("should extract x-workflow-slug from incoming request", () => {
      expect(src).toContain('req.headers["x-workflow-slug"]');
    });

    it("should extract x-feature-slug from incoming request", () => {
      expect(src).toContain('req.headers["x-feature-slug"]');
    });
  });

  describe("internal-headers.ts — workflow tracking headers forwarding", () => {
    const src = readSrc("src/lib/internal-headers.ts");

    for (const header of ["x-campaign-id", "x-brand-id", "x-workflow-slug", "x-feature-slug"]) {
      it(`should forward ${header} to downstream services`, () => {
        expect(src).toContain(`headers["${header}"]`);
      });
    }
  });

  describe("runs-client — public functions accept optional headers", () => {
    const src = readSrc("shared/runs-client/src/index.ts");

    for (const fn of ["createRun", "updateRun", "addCosts", "getRun", "getRunsBatch", "listRuns", "getRunSummary"]) {
      it(`${fn} should accept an optional headers parameter`, () => {
        // Each public function should have headers?: Record<string, string> in its signature
        const fnPattern = new RegExp(
          `export async function ${fn}\\([\\s\\S]*?headers\\?:\\s*Record<string,\\s*string>`
        );
        expect(src).toMatch(fnPattern);
      });
    }

    it("should merge caller headers after identity headers", () => {
      // The pattern { ...identityHeaders(...), ...headers } should appear for merging
      const mergeCount = (src.match(/\.\.\.identityHeaders\([\s\S]*?\),\s*\.\.\.headers/g) || []).length;
      expect(mergeCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe("all route files use buildInternalHeaders for callExternalService", () => {
    const routeFiles = [
      "src/routes/campaigns.ts",
      "src/routes/brand.ts",
      "src/routes/workflows.ts",
      "src/routes/leads.ts",
      "src/routes/chat.ts",
      "src/routes/keys.ts",
      "src/routes/qualify.ts",
      "src/routes/billing.ts",
      "src/routes/stripe.ts",
      "src/routes/emails.ts",
      "src/routes/activity.ts",
      "src/routes/users.ts",
    ];

    for (const file of routeFiles) {
      it(`${file} should import buildInternalHeaders`, () => {
        const src = readSrc(file);
        expect(src).toContain("buildInternalHeaders");
      });
    }
  });
});
