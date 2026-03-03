import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression: sendTransactionalEmail in campaigns.ts called
 * callExternalService without buildInternalHeaders(req), so x-org-id,
 * x-user-id, and x-run-id were never sent to transactional-email-service.
 * After inter-service headers became required, campaign emails
 * (campaign_created, campaign_stopped) silently failed with 400.
 */
describe("campaigns sendTransactionalEmail headers", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../src/routes/campaigns.ts"),
    "utf-8"
  );

  it("should pass buildInternalHeaders(req) when calling transactional-email-service", () => {
    // Extract the sendTransactionalEmail function body
    const fnMatch = src.match(
      /function sendTransactionalEmail\([\s\S]*?\.catch\([\s\S]*?\);?\s*\}/
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    expect(fnBody).toContain("headers: buildInternalHeaders(req)");
  });
});
