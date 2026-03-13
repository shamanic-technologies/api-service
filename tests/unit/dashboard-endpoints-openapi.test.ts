/**
 * Regression test: ensures dashboard endpoints are properly
 * documented in the OpenAPI schema (schemas.ts).
 *
 * 1. GET /v1/brands/{id}/stats — must be registered
 * 2. GET /v1/campaigns/{id}/stats/replies — removed (no longer registered)
 * 3. GET /v1/campaigns status query param — must be documented
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const schemasPath = path.join(__dirname, "../../src/schemas.ts");
const content = fs.readFileSync(schemasPath, "utf-8");

describe("Dashboard endpoints OpenAPI documentation", () => {
  it("should register GET /v1/brands/{id}/stats", () => {
    expect(content).toContain('path: "/v1/brands/{id}/stats"');
  });

  it("should NOT register campaigns replies endpoint (removed)", () => {
    expect(content).not.toContain('path: "/v1/campaigns/{id}/stats/replies"');
    expect(content).not.toContain('path: "/v1/campaigns/{id}/replies"');
    expect(content).not.toContain("CampaignRepliesResponse");
  });

  it("should NOT register campaigns batch-stats endpoint (removed)", () => {
    expect(content).not.toContain('path: "/v1/campaigns/stats/batch"');
    expect(content).not.toContain("BatchStatsRequest");
  });

  it("should document status query param on GET /v1/campaigns", () => {
    // Find the registerPath block for GET /v1/campaigns and verify status is in the query
    const listCampaignsMatch = content.match(
      /registerPath\(\{[^}]*method:\s*"get"[^}]*path:\s*"\/v1\/campaigns"[^]*?query:\s*z\.object\(\{([^}]+)\}/
    );
    expect(listCampaignsMatch).not.toBeNull();
    expect(listCampaignsMatch![1]).toContain("status");
  });
});
