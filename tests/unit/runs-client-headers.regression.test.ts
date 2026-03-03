import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression: runs-client did not send x-org-id / x-user-id headers when
 * calling runs-service.  After PR #59 made x-org-id a required inter-service
 * header, createRun returned 400 — which cascaded: no req.runId was set, so
 * buildInternalHeaders omitted x-run-id, and every downstream service
 * (client-service, transactional-email-service) rejected with "Missing
 * required headers".
 *
 * Fix: runsRequest now accepts extra headers, and every public function
 * forwards x-org-id / x-user-id / x-run-id from its params.
 */

describe("runs-client inter-service headers (source inspection)", () => {
  const srcPath = path.join(__dirname, "../../shared/runs-client/src/index.ts");
  const src = fs.readFileSync(srcPath, "utf-8");

  it("createRun forwards x-org-id via identityHeaders", () => {
    // createRun must call identityHeaders with orgId from params
    expect(src).toContain("identityHeaders({ orgId: params.orgId");
  });

  it("createRun forwards x-user-id via identityHeaders", () => {
    expect(src).toContain("userId: params.userId");
  });

  it("updateRun accepts optional orgId and forwards it", () => {
    // Signature must include orgId parameter
    expect(src).toMatch(/updateRun\(\s*\n?\s*runId.*\n?\s*status.*\n?\s*orgId\?/);
    expect(src).toContain("identityHeaders({ orgId, runId })");
  });

  it("addCosts accepts optional orgId and forwards it", () => {
    expect(src).toMatch(/addCosts\(\s*\n?\s*runId.*\n?\s*items.*\n?\s*orgId\?/);
  });

  it("runsRequest spreads extra headers into fetch call", () => {
    // The helper must accept headers and spread them
    expect(src).toContain("...extraHeaders");
  });

  it("listRuns forwards x-org-id via identityHeaders", () => {
    expect(src).toContain("identityHeaders({ orgId: params.orgId, userId: params.userId })");
  });
});

describe("runs-client runtime headers", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "run-123",
          organizationId: "org-uuid",
          userId: null,
          brandId: null,
          campaignId: null,
          serviceName: "test",
          taskName: "test",
          status: "running",
          parentRunId: null,
          startedAt: new Date().toISOString(),
          completedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
    });
    global.fetch = fetchSpy;
  });

  it("createRun sends x-org-id and x-user-id headers to runs-service", async () => {
    // Import the real source (not the mock alias — we use a direct path)
    const mod = await import("../../shared/runs-client/src/index.js");

    await mod.createRun({
      orgId: "org-uuid-abc",
      userId: "user-uuid-def",
      serviceName: "api-service",
      taskName: "POST /v1/test",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers["x-org-id"]).toBe("org-uuid-abc");
    expect(options.headers["x-user-id"]).toBe("user-uuid-def");
  });
});
