import { describe, it, expect } from "vitest";

/**
 * Regression: POST /v1/workflows/create and POST /v1/workflows/upgrade called
 * callExternalService without buildInternalHeaders(req), so x-org-id and
 * x-user-id were never sent to workflow-service. Downstream services that call
 * key-service need these headers to resolve keys.
 *
 * POST /v1/brand/icp-suggestion was covered here too until it was removed: it
 * forwarded to brand-service /orgs/icp-suggestion, a path that service never
 * served, so every call 404'd.
 */

import * as fs from "fs";
import * as path from "path";

describe("internal headers on downstream calls", () => {
  it("workflows/create route should include buildInternalHeaders", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/routes/workflows.ts"),
      "utf-8"
    );

    const createIdx = src.indexOf('router.post("/workflows/create"');
    expect(createIdx).toBeGreaterThan(-1);

    const afterCreate = src.slice(createIdx);
    const callIdx = afterCreate.indexOf("callExternalService");
    const callBlock = afterCreate.slice(callIdx, callIdx + 300);

    expect(callBlock).toContain("headers: buildInternalHeaders(req)");
  });

  it("workflows/upgrade route should include buildInternalHeaders", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../src/routes/workflows.ts"),
      "utf-8"
    );

    const upgradeIdx = src.indexOf('router.post("/workflows/upgrade"');
    expect(upgradeIdx).toBeGreaterThan(-1);

    const afterUpgrade = src.slice(upgradeIdx);
    const callIdx = afterUpgrade.indexOf("callExternalService");
    const callBlock = afterUpgrade.slice(callIdx, callIdx + 300);

    expect(callBlock).toContain("headers: buildInternalHeaders(req)");
  });
});
