import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Transactional email service rename (lifecycle → transactionalEmail)", () => {
  const serviceClientPath = path.join(__dirname, "../../src/lib/service-client.ts");
  const serviceClientContent = fs.readFileSync(serviceClientPath, "utf-8");

  it("should use TRANSACTIONAL_EMAIL_SERVICE_URL env var", () => {
    expect(serviceClientContent).toContain("TRANSACTIONAL_EMAIL_SERVICE_URL");
    expect(serviceClientContent).not.toContain("LIFECYCLE_EMAILS_SERVICE_URL");
  });

  it("should use TRANSACTIONAL_EMAIL_SERVICE_API_KEY env var", () => {
    expect(serviceClientContent).toContain("TRANSACTIONAL_EMAIL_SERVICE_API_KEY");
    expect(serviceClientContent).not.toContain("LIFECYCLE_EMAILS_SERVICE_API_KEY");
  });

  it("should export service as transactionalEmail, not lifecycle", () => {
    expect(serviceClientContent).toContain("transactionalEmail:");
    expect(serviceClientContent).not.toContain("lifecycle:");
  });

  it("should reference externalServices.transactionalEmail in activity route", () => {
    const activityContent = fs.readFileSync(
      path.join(__dirname, "../../src/routes/activity.ts"),
      "utf-8",
    );
    expect(activityContent).toContain("externalServices.transactionalEmail");
    expect(activityContent).not.toContain("externalServices.lifecycle");
  });

  it("should reference externalServices.transactionalEmail in campaigns route", () => {
    const campaignsContent = fs.readFileSync(
      path.join(__dirname, "../../src/routes/campaigns.ts"),
      "utf-8",
    );
    expect(campaignsContent).toContain("externalServices.transactionalEmail");
    expect(campaignsContent).not.toContain("externalServices.lifecycle");
  });

  it("should use .env.example with TRANSACTIONAL_EMAIL_SERVICE vars", () => {
    const envContent = fs.readFileSync(
      path.join(__dirname, "../../.env.example"),
      "utf-8",
    );
    expect(envContent).toContain("TRANSACTIONAL_EMAIL_SERVICE_URL");
    expect(envContent).not.toContain("LIFECYCLE_EMAILS_SERVICE_URL");
  });
});
