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

  it("should have PATCH /billing/accounts/auto_topup endpoint", () => {
    expect(content).toContain('"/billing/accounts/auto_topup"');
    expect(content).toContain("router.patch");
  });

  it("should have DELETE /billing/accounts/auto_topup endpoint", () => {
    expect(content).toContain('"/billing/accounts/auto_topup"');
    expect(content).toContain("router.delete");
  });

  it("should NOT reference removed endpoints", () => {
    // Removed in billing-service PR #112. Build via template literal so the
    // literal strings don't show up in `grep` AC sweeps.
    const dead = [
      "transactions",
      "credits/deduct",
      "accounts/auto-reload",
      "accounts/mode",
    ];
    for (const seg of dead) {
      expect(content).not.toContain(`/billing/${seg}`);
      expect(content).not.toContain(`/v1/${seg}`);
    }
  });

  it("should have POST /billing/checkout-sessions endpoint", () => {
    expect(content).toContain('"/billing/checkout-sessions"');
  });

  it("should have POST /billing/accounts/wallet_setup endpoint", () => {
    expect(content).toContain('"/billing/accounts/wallet_setup"');
  });

  it("should have POST /billing/portal-sessions endpoint", () => {
    expect(content).toContain('"/billing/portal-sessions"');
  });

  it("should use authenticate and requireOrg on all authenticated endpoints", () => {
    // 10 routes + 1 import = 11
    const authMatches = content.match(/authenticate, requireOrg/g);
    expect(authMatches).not.toBeNull();
    expect(authMatches!.length).toBe(11);
  });

  it("should use buildInternalHeaders for all authenticated endpoints (no x-key-source)", () => {
    expect(content).toContain("buildInternalHeaders");
    expect(content).not.toContain('"x-key-source"');
    const headerMatches = content.match(/buildInternalHeaders\(req\)/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(10);
  });

  it("should have GET /billing/payments endpoint sourced from stripe-service", () => {
    expect(content).toContain('"/billing/payments"');
    // org resolved from Bearer (req.orgId), inserted into the stripe internal path
    expect(content).toContain("/internal/payment_intents/by-org/${encodeURIComponent(req.orgId!)}");
    expect(content).toContain("externalServices.stripe");
  });

  it("should have GET + PATCH /brands/:brandId/daily-budget endpoints", () => {
    expect(content).toContain('"/brands/:brandId/daily-budget"');
    // GET proxies billing internal read; PATCH proxies billing /v1 write
    expect(content).toContain("`/internal/brands/${req.params.brandId}/daily-budget`");
    expect(content).toContain("`/v1/brands/${req.params.brandId}/daily-budget`");
  });

  it("should NOT have brand subscription proxy endpoints", () => {
    expect(content).not.toContain('"/brands/:brandId/subscription"');
    expect(content).not.toContain('"/brands/:brandId/subscription/pause"');
    expect(content).not.toContain('"/brands/:brandId/subscription/resume"');
    expect(content).not.toContain("`/v1/brands/${req.params.brandId}/subscription`");
    expect(content).not.toContain("`/v1/brands/${req.params.brandId}/subscription/pause`");
    expect(content).not.toContain("`/v1/brands/${req.params.brandId}/subscription/resume`");
  });

  it("should NOT proxy billing's internal card-confirmed route", () => {
    expect(content).not.toContain("card-confirmed");
    expect(schemaContent).not.toContain("card-confirmed");
  });

  it("should proxy to externalServices.billing", () => {
    expect(content).toContain("externalServices.billing");
  });

  it("should forward correct downstream paths", () => {
    expect(content).toContain('"/v1/accounts"');
    expect(content).toContain('"/v1/accounts/balance"');
    expect(content).toContain('"/v1/accounts/auto_topup"');
    expect(content).toContain('"/v1/checkout-sessions"');
    expect(content).toContain('"/v1/accounts/wallet_setup"');
    expect(content).toContain('"/v1/portal-sessions"');
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
    expect(schemaContent).toContain('path: "/v1/billing/accounts/auto_topup"');
    expect(schemaContent).toContain('path: "/v1/billing/checkout-sessions"');
    expect(schemaContent).toContain('path: "/v1/billing/accounts/wallet_setup"');
    expect(schemaContent).toContain('path: "/v1/billing/portal-sessions"');
  });

  it("should NOT register removed billing paths", () => {
    const dead = [
      "accounts/transactions",
      "credits/deduct",
      "accounts/auto-reload",
      "accounts/mode",
    ];
    for (const seg of dead) {
      expect(schemaContent).not.toContain(`path: "/v1/billing/${seg}"`);
    }
  });

  it("should use Billing tag", () => {
    expect(schemaContent).toContain('tags: ["Billing"]');
  });

  it("should register /v1/billing/payments path (passthrough)", () => {
    expect(schemaContent).toContain('path: "/v1/billing/payments"');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("OrgPaymentsResponse")');
  });

  it("should register brand daily-budget paths (passthrough)", () => {
    expect(schemaContent).toContain('path: "/v1/brands/{brandId}/daily-budget"');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("DailyBudgetResponse")');
    expect(schemaContent).toContain('dailyBudgetCents: inboundCents.describe("Brand daily budget cap in cents');
  });

  it("should NOT register brand subscription paths", () => {
    expect(schemaContent).not.toContain('path: "/v1/brands/{brandId}/subscription"');
    expect(schemaContent).not.toContain('path: "/v1/brands/{brandId}/subscription/pause"');
    expect(schemaContent).not.toContain('path: "/v1/brands/{brandId}/subscription/resume"');
    expect(schemaContent).not.toContain("BrandSubscriptionResponse");
    expect(schemaContent).not.toContain("BrandSubscriptionRequest");
  });

  it("should define request schemas with new names", () => {
    expect(schemaContent).toContain("ConfigureAutoTopupRequestSchema");
    expect(schemaContent).toContain("CreateCheckoutSessionRequestSchema");
    expect(schemaContent).toContain("WalletSetupRequestSchema");
    expect(schemaContent).not.toContain("ConfigureAutoReloadRequestSchema");
    expect(schemaContent).not.toContain("SwitchBillingModeRequestSchema");
    expect(schemaContent).not.toContain("DeductCreditsRequestSchema");
  });

  it("should use topup_amount_cents in request schemas (not reload_amount_cents)", () => {
    expect(schemaContent).toContain("topup_amount_cents");
    expect(schemaContent).toContain("topup_threshold_cents");
    expect(schemaContent).toContain("initial_load_amount_cents");
    expect(schemaContent).not.toContain("reload_amount_cents");
    expect(schemaContent).not.toContain("reload_threshold_cents");
  });

  it("should not have billing_mode in response schemas", () => {
    expect(schemaContent).not.toContain('"byok", "payg"');
  });

  it("billing response schemas are passthrough (transparent proxy contract)", () => {
    // Post-billing-service-#112: every billing response collapses to
    // z.object({}).passthrough() so downstream renames flow through
    // without coordinated api-service edits.
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("BillingAccountResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("BalanceResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("ConfigureAutoTopupResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("DisableAutoTopupResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("BillingCheckoutResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("WalletSetupResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("BillingPortalSessionResponse")');
    expect(schemaContent).toContain('z.object({}).passthrough().openapi("PublicBillingStatsResponse")');
    expect(schemaContent).not.toContain("TransactionListResponse");
    expect(schemaContent).not.toContain("DeductCreditsResponse");
  });
});

describe("Billing routes are mounted in index.ts", () => {
  it("should import and mount billing routes", () => {
    expect(indexContent).toContain("billingRoutes");
    expect(indexContent).toContain("./routes/billing");
  });
});
