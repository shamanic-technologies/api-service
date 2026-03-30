/**
 * Regression test: ensures dashboard endpoints are properly
 * documented in the OpenAPI schema (schemas.ts).
 *
 * 1. GET /v1/email-gateway/stats — must be registered
 * 2. GET /v1/runs/stats/costs — must be registered
 * 3. GET /v1/campaigns/{id}/stats/replies — removed (no longer registered)
 * 4. GET /v1/campaigns status query param — must be documented
 * 5. GET /v1/campaigns/stats — grouped stats aggregator, must be registered
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const schemasPath = path.join(__dirname, "../../src/schemas.ts");
const content = fs.readFileSync(schemasPath, "utf-8");

describe("Dashboard endpoints OpenAPI documentation", () => {
  it("should register GET /v1/email-gateway/stats", () => {
    expect(content).toContain('path: "/v1/email-gateway/stats"');
  });

  it("should register GET /v1/runs/stats/costs", () => {
    expect(content).toContain('path: "/v1/runs/stats/costs"');
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

  it("should register GET /v1/campaigns/stats (grouped aggregator)", () => {
    expect(content).toContain('path: "/v1/campaigns/stats"');
  });

  it("should document status query param on GET /v1/campaigns", () => {
    // Find the registerPath block for GET /v1/campaigns and verify status is in the query schema
    const listStart = content.indexOf('path: "/v1/campaigns"');
    expect(listStart).toBeGreaterThan(-1);
    // Look at a reasonable window after the path declaration for the status param
    const block = content.slice(listStart, listStart + 800);
    expect(block).toContain("status:");
    expect(block).toContain("Filter by status");
  });
});
