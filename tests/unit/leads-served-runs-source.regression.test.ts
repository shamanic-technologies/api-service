/**
 * Regression test: leadsServed must come from lead-service's served_leads
 * table, NOT from runs-service run counts. Runs-service counts all lead-serve
 * runs including ones where no lead was found (e.g. empty buffer), which
 * inflates the stat.
 *
 * Fix: campaigns.ts no longer fetches lead-serve run counts from runs-service
 * and no longer overrides lead-service stats. Lead-service served_leads is
 * the single source of truth for leadsServed.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("leadsServed uses lead-service as source of truth (not runs-service)", () => {
  const routePath = path.join(__dirname, "../../src/routes/campaigns.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should NOT override leadsServed from runs-service run counts", () => {
    // The old bug: leadsFromRuns.groups[0].runCount was used to override leadsServed
    // This must no longer be present
    expect(content).not.toContain("leadsFromRuns");
    expect(content).not.toMatch(/stats\.leadsServed\s*=\s*.*runCount/);
  });

  it("should NOT fetch lead-serve run counts from runs-service for stats override", () => {
    // We should not be making a separate runs-service call just for lead-serve counts
    expect(content).not.toContain("taskName=lead-serve");
  });

  it("should use lead-service served count as leadsServed", () => {
    // The single-campaign stats endpoint should set leadsServed from lead-service
    const statsStart = content.indexOf("GET /v1/campaigns/:id/stats");
    expect(statsStart).toBeGreaterThan(-1);
    const statsSection = content.slice(statsStart, statsStart + 5000);
    expect(statsSection).toContain("stats.leadsServed = ls.served");
  });

  it("batch-stats endpoint should no longer exist", () => {
    expect(content).not.toContain("POST /v1/campaigns/batch-stats");
    expect(content).not.toContain("campaigns/stats/batch");
  });
});
