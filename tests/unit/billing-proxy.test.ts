import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const billingRoutePath = path.join(__dirname, "../../src/routes/billing.ts");
const content = fs.readFileSync(billingRoutePath, "utf-8");

const schemaPath = path.join(__dirname, "../../src/schemas.ts");
const schemaContent = fs.readFileSync(schemaPath, "utf-8");

const indexPath = path.join(__dirname, "../../src/index.ts");
const indexContent = fs.readFileSync(indexPath, "utf-8");

describe("Billing proxy routes", () => {
  it("should have GET /billing/accounts endpoint", () => {
    expect(content).toContain('"/billing/accounts"');
    expect(content).toContain("router.get");
  });

  it("should have GET /billing/accounts/balance endpoint", () => {
    expect(content).toContain('"/billing/accounts/balance"');
  });

  it("should have GET /billing/accounts/transactions endpoint", () => {
    expect(content).toContain('"/billing/accounts/transactions"');
  });

  it("should have PATCH /billing/accounts/auto-reload endpoint", () => {
    expect(content).toContain('"/billing/accounts/auto-reload"');
    expect(content).toContain("router.patch");
  });

  it("should have DELETE /billing/accounts/auto-reload endpoint", () => {
    expect(content).toContain('"/billing/accounts/auto-reload"');
    expect(content).toContain("router.delete");
  });

  it("should NOT have PATCH /billing/accounts/mode endpoint", () => {
    expect(content).not.toContain('"/billing/accounts/mode"');
    expect(content).not.toContain('"/v1/accounts/mode"');
  });

  it("should have POST /billing/credits/deduct endpoint", () => {
    expect(content).toContain('"/billing/credits/deduct"');
    expect(content).toContain("router.post");
  });

  it("should have POST /billing/checkout-sessions endpoint", () => {
    expect(content).toContain('"/billing/checkout-sessions"');
  });

  it("should use authenticate and requireOrg on all authenticated endpoints", () => {
    // 9 routes + 1 import = 10
    const authMatches = content.match(/authenticate, requireOrg/g);
    expect(authMatches).not.toBeNull();
    expect(authMatches!.length).toBe(9); // 8 routes + 1 import
  });

  it("should use buildInternalHeaders for all authenticated endpoints (no x-key-source)", () => {
    expect(content).toContain("buildInternalHeaders");
    expect(content).not.toContain('"x-key-source"');
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(8);
  });

  it("should proxy to externalServices.billing", () => {
    expect(content).toContain("externalServices.billing");
  });

  it("should forward correct downstream paths", () => {
    expect(content).toContain('"/v1/accounts"');
    expect(content).toContain('"/v1/accounts/balance"');
    expect(content).toContain('"/v1/accounts/transactions"');
    expect(content).toContain('"/v1/accounts/auto-reload"');
    expect(content).toContain('"/v1/credits/deduct"');
    expect(content).toContain('"/v1/checkout-sessions"');
  });
});

describe("Stripe webhook proxy removed", () => {
  it("should NOT export stripeWebhookHandler", () => {
    expect(content).not.toContain("export async function stripeWebhookHandler");
  });

  it("should NOT reference stripe webhook in index.ts", () => {
    expect(indexContent).not.toContain("stripeWebhookHandler");
    expect(indexContent).not.toContain("express.raw");
  });

  it("should NOT have stripe webhook path in schemas", () => {
    expect(schemaContent).not.toContain('path: "/v1/billing/webhooks/stripe"');
  });
});

describe("Billing OpenAPI schemas", () => {
  it("should register all billing paths", () => {
    expect(schemaContent).toContain('path: "/v1/billing/accounts"');
    expect(schemaContent).toContain('path: "/v1/billing/accounts/balance"');
    expect(schemaContent).toContain('path: "/v1/billing/accounts/transactions"');
    expect(schemaContent).toContain('path: "/v1/billing/accounts/auto-reload"');
    expect(schemaContent).toContain('path: "/v1/billing/credits/deduct"');
    expect(schemaContent).toContain('path: "/v1/billing/checkout-sessions"');
  });

  it("should NOT have accounts/mode path", () => {
    expect(schemaContent).not.toContain('path: "/v1/billing/accounts/mode"');
  });

  it("should use Billing tag", () => {
    expect(schemaContent).toContain('tags: ["Billing"]');
  });

  it("should define request schemas", () => {
    expect(schemaContent).toContain("ConfigureAutoReloadRequestSchema");
    expect(schemaContent).not.toContain("SwitchBillingModeRequestSchema");
    expect(schemaContent).toContain("DeductCreditsRequestSchema");
    expect(schemaContent).toContain("CreateCheckoutSessionRequestSchema");
  });

  it("should not have billing_mode in response schemas", () => {
    // billing_mode / mode enum should not appear in billing response schemas
    expect(schemaContent).not.toContain('"byok", "payg"');
  });

  it("should have hasAutoReload in BillingAccountResponse", () => {
    expect(schemaContent).toContain("hasAutoReload");
  });
});

describe("Billing routes are mounted in index.ts", () => {
  it("should import and mount billing routes", () => {
    expect(indexContent).toContain("billingRoutes");
    expect(indexContent).toContain("./routes/billing");
  });
});
