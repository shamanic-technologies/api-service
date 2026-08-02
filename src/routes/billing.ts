import { Router } from "express";
import { authenticate, requireOrg, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function missingBodyFields(body: unknown, fields: string[]): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fields;
  const record = body as Record<string, unknown>;
  return fields.filter((field) => record[field] === undefined || record[field] === null);
}

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function requireBodyFields(res: any, body: unknown, fields: string[]): boolean {
  const missing = missingBodyFields(body, fields);
  if (missing.length > 0) {
    res.status(400).json({
      error: `Missing required fields: ${missing.join(", ")}`,
      missingFields: missing,
    });
    return false;
  }
  return true;
}

// GET /v1/billing/accounts — get or create billing account
router.get("/billing/accounts", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/v1/accounts",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get billing account" });
  }
});

// GET /v1/billing/accounts/balance — quick balance check
// Ensures account exists (upsert) before querying balance
router.get("/billing/accounts/balance", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const headers = buildInternalHeaders(req);
    // Ensure billing account exists (auto-creates if missing)
    await callExternalService(externalServices.billing, "/v1/accounts", { headers });
    const result = await callExternalService(
      externalServices.billing,
      "/v1/accounts/balance",
      { headers }
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get balance" });
  }
});

// PATCH /v1/billing/accounts/auto_topup — configure auto-topup
router.patch("/billing/accounts/auto_topup", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireBodyFields(res, req.body, ["topup_amount_cents", "topup_threshold_cents"])) return;
    const result = await callExternalService(
      externalServices.billing,
      "/v1/accounts/auto_topup",
      { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || "Failed to configure auto-topup" });
  }
});

// DELETE /v1/billing/accounts/auto_topup — disable auto-topup
router.delete("/billing/accounts/auto_topup", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/v1/accounts/auto_topup",
      { method: "DELETE", headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to disable auto-topup" });
  }
});

// POST /v1/billing/checkout-sessions — create Stripe checkout session
router.post("/billing/checkout-sessions", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    // Embedded checkout returns an inline client_secret (no redirect), so
    // success_url/cancel_url do not apply — it only needs an amount. Mirror
    // billing-service's CreateCheckoutRequestSchema semantics:
    //   embedded     → topup_amount_cents (payment-only, no urls)
    //   mode:setup   → success_url + cancel_url
    //   hosted topup → success_url + cancel_url + topup_amount_cents
    const isEmbedded = req.body?.ui_mode === "embedded";
    const requiredFields = isEmbedded
      ? ["topup_amount_cents"]
      : req.body?.mode === "setup"
        ? ["success_url", "cancel_url"]
        : ["success_url", "cancel_url", "topup_amount_cents"];
    if (!requireBodyFields(res, req.body, requiredFields)) return;
    const result = await callExternalService(
      externalServices.billing,
      "/v1/checkout-sessions",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to create checkout session" });
  }
});

// POST /v1/billing/portal-sessions — create Stripe billing portal session
router.post("/billing/portal-sessions", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/v1/portal-sessions",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || "Failed to create portal session" });
  }
});

// GET /v1/billing/payments — list the calling org's payment history
// (its Stripe PaymentIntents / top-ups).
//
// Org is resolved from the Bearer key (req.orgId) — the client sends no orgId.
// Sourced directly from stripe-service GET /internal/payment_intents/by-org/:orgId,
// a user-less DB-mirror read (x-api-key injected by callExternalService; orgId in
// the path, org<->customer is 1:1). Returns the full Stripe list (no pagination —
// a customer has a handful of top-ups); each PaymentIntent carries id, amount
// (cents), currency, status, created. Response shape is owned by stripe-service —
// passthrough only, no body transform (CLAUDE.md #4/#8).
router.get("/billing/payments", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.stripe,
      `/internal/payment_intents/by-org/${encodeURIComponent(req.orgId!)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get payments" });
  }
});

/**
 * GET /v1/brands/:brandId/daily-budget
 * Proxy to billing-service GET /internal/brands/:brandId/daily-budget.
 * Reads a brand's current daily budget (per-day spend ceiling), keyed by brandId.
 * Downstream is a user-less internal read (x-api-key only, injected by
 * callExternalService); the gateway route stays user-facing. An unset brand
 * returns { dailyBudgetCents: null }. Response shape is owned by the downstream
 * service — passthrough only.
 */
router.get("/brands/:brandId/daily-budget", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    if (!isUuid(req.params.brandId)) {
      return res.status(400).json({ error: "Invalid brand ID — expected a UUID" });
    }
    const result = await callExternalService(
      externalServices.billing,
      `/internal/brands/${req.params.brandId}/daily-budget`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Failed to get daily budget");
  }
});

/**
 * PATCH /v1/brands/:brandId/daily-budget
 * Proxy to billing-service PATCH /v1/brands/:brandId/daily-budget.
 * Sets a brand's daily budget. Body { dailyBudgetCents } (number or decimal
 * string, >= 0; 0 = pause) and response shape are owned by the downstream
 * service; identity headers (x-org-id, x-user-id, x-run-id) are forwarded via
 * buildInternalHeaders. Downstream 4xx errors propagate verbatim — passthrough only.
 *
 * In particular billing answers 409 here when the brand is already funded PER FUNNEL
 * (see the funnel-budgets routes below): once per-funnel ceilings exist the brand-level
 * value is their SUM and this write is refused. That status AND its body must reach the
 * caller field-for-field — a consumer branches on it — hence respondUpstreamError rather
 * than a rebuilt { error: err.message } envelope, which would stringify billing's whole
 * JSON body into the `error` string and destroy every machine-readable field (CLAUDE.md #7).
 */
router.patch("/brands/:brandId/daily-budget", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    if (!isUuid(req.params.brandId)) {
      return res.status(400).json({ error: "Invalid brand ID — expected a UUID" });
    }
    if (!requireBodyFields(res, req.body, ["dailyBudgetCents"])) return;
    const result = await callExternalService(
      externalServices.billing,
      `/v1/brands/${req.params.brandId}/daily-budget`,
      { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Failed to set daily budget");
  }
});

/**
 * GET /v1/brands/:brandId/funnel-budgets
 * Proxy to billing-service GET /v1/brands/:brandId/funnel-budgets.
 * Reads the calling org's per-funnel daily ceilings for a brand — brand Settings
 * shows them back. A brand with no per-funnel ceilings returns funnels: [] plus its
 * brand-level value. Response shape is owned by billing — passthrough only (CLAUDE.md #8).
 */
router.get("/brands/:brandId/funnel-budgets", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    if (!isUuid(req.params.brandId)) {
      return res.status(400).json({ error: "Invalid brand ID — expected a UUID" });
    }
    const result = await callExternalService(
      externalServices.billing,
      `/v1/brands/${req.params.brandId}/funnel-budgets`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Failed to get funnel budgets");
  }
});

/**
 * PUT /v1/brands/:brandId/funnel-budgets
 * Proxy to billing-service PUT /v1/brands/:brandId/funnel-budgets.
 * Writes the WHOLE per-funnel ceiling set atomically — signup checkout uses this.
 * Body { funnels: [{ funnelKey, dailyBudgetCents }, ...] }; billing owns the funnel-key
 * vocabulary, the per-funnel product minimums and the all-or-nothing semantics. The
 * gateway declares none of it and adds no cap, default or validation of its own
 * (CLAUDE.md #4/#8) — billing's 4xx propagates verbatim.
 */
router.put("/brands/:brandId/funnel-budgets", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    if (!isUuid(req.params.brandId)) {
      return res.status(400).json({ error: "Invalid brand ID — expected a UUID" });
    }
    const result = await callExternalService(
      externalServices.billing,
      `/v1/brands/${req.params.brandId}/funnel-budgets`,
      { method: "PUT", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Failed to set funnel budgets");
  }
});

/**
 * PATCH /v1/brands/:brandId/funnel-budgets/:funnelKey
 * Proxy to billing-service PATCH /v1/brands/:brandId/funnel-budgets/:funnelKey.
 * Sets ONE funnel's daily ceiling — brand Settings changes them one at a time;
 * untouched funnels keep theirs. Body { dailyBudgetCents }. The funnel key is
 * forwarded as given: billing owns the enum, so an unknown key must come back as
 * billing's 400, not a gateway-invented one (CLAUDE.md #8).
 */
router.patch(
  "/brands/:brandId/funnel-budgets/:funnelKey",
  authenticate,
  requireOrg,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!isUuid(req.params.brandId)) {
        return res.status(400).json({ error: "Invalid brand ID — expected a UUID" });
      }
      const result = await callExternalService(
        externalServices.billing,
        `/v1/brands/${req.params.brandId}/funnel-budgets/${encodeURIComponent(req.params.funnelKey)}`,
        { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
      );
      res.json(result);
    } catch (error: any) {
      respondUpstreamError(res, error, "Failed to set funnel budget");
    }
  }
);

export default router;
