import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Regression: campaign email triggers (campaign_created, campaign_stopped)
 * were moved to the dashboard. The api-service must NOT send emails inline
 * from campaign routes — the dashboard calls POST /v1/emails/send instead.
 */
describe("campaigns.ts must not trigger emails directly", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../../src/routes/campaigns.ts"),
    "utf-8"
  );

  it("should not contain sendTransactionalEmail", () => {
    expect(src).not.toContain("sendTransactionalEmail");
  });

  it("should not reference externalServices.transactionalEmail", () => {
    expect(src).not.toContain("externalServices.transactionalEmail");
  });
});
