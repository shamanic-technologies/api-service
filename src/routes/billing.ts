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
    respondUpstreamError(res, error, "Failed to get billing account");
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
    respondUpstreamError(res, error, "Failed to get balance");
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
    respondUpstreamError(res, error, "Failed to configure auto-topup");
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
    respondUpstreamError(res, error, "Failed to disable auto-topup");
  }
});

/**
 * POST /v1/billing/accounts/card_setup
 * Proxy to billing-service POST /v1/accounts/card_setup.
 *
 * Answers what the BROWSER needs to render this org's card form on whichever
 * acquirer holds its cards: `mode: "hosted_redirect"` (send the customer to
 * `url`) or `mode: "embedded_widget"` (load `script_url`, initialise with the
 * per-order PUBLIC `token`, mount the acquirer's own field). billing-service and
 * stripe-service have both already stripped every credential from that
 * descriptor, so the gateway adds nothing and removes nothing — re-declaring the
 * body here would strip fields they deliberately put in it (CLAUDE.md #8).
 *
 * The request body is forwarded verbatim too: billing owns `return_url` /
 * `currency` and whatever it accepts next, and a whitelist here would drop a
 * field the caller sent (CLAUDE.md #8 corollary). A missing/invalid `return_url`
 * is billing's 400 to raise, and rule #7 forwards it field-for-field.
 */
router.post("/billing/accounts/card_setup", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/v1/accounts/card_setup",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Failed to start card setup");
  }
});

/**
 * GET /v1/billing/accounts/saved_payment_method
 * Proxy to billing-service GET /v1/accounts/saved_payment_method.
 *
 * THREE answers stay apart all the way to the caller, which is the entire point
 * of the route:
 *   200 {saved:true, method}  — a chargeable card is on file;
 *   200 {saved:false, reason} — the acquirer answered and there is none;
 *   502                       — we could not ask at all.
 *
 * Collapsing the last two either tells a customer to re-enter a card we already
 * hold, or arms a recurring charge off a timeout. So the gateway does NOT map a
 * downstream failure onto its own generic error: `respondUpstreamError` re-emits
 * billing's status and its body field-for-field (CLAUDE.md #7), and the response
 * schema is passthrough (#8).
 */
router.get("/billing/accounts/saved_payment_method", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/v1/accounts/saved_payment_method",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Could not confirm whether a card is saved");
  }
});

/**
 * DELETE /v1/billing/accounts/saved_payment_method
 * Proxy to billing-service DELETE /v1/accounts/saved_payment_method.
 *
 * A customer stops us holding their card, from their own billing page. The
 * dashboard is the only caller and it only ever talks to this gateway, so this
 * hop is the whole feature's reachability.
 *
 * The ORDER is billing-service's and it is already correct there: what is owed
 * is collected first, on the card that is about to go, then the card goes
 * whatever that collection did. The gateway adds no orchestration, no
 * pre-check and no retry (CLAUDE.md #2).
 *
 * REFUSED FOR NOBODY here. Whether removal is allowed is billing's decision and
 * it allows everybody at any balance — a gate of our own would trap the one
 * customer it exists to protect us from. The org whose card goes is the
 * AUTHENTICATED one: it travels in `x-org-id` from `buildInternalHeaders`, so a
 * caller cannot name someone else's.
 *
 * Body and status pass through field-for-field via `respondUpstreamError`
 * (CLAUDE.md #7/#8) — billing's counters (`removed`, `already_removed`,
 * `auto_topup_disarmed`, `settled_cents`, `settle_skip_reason`) are what the
 * page renders, and a field billing adds later reaches the dashboard with no
 * edit here. A 502 means we could not tell whether the card is gone and must
 * never read as a silent success.
 */
router.delete("/billing/accounts/saved_payment_method", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/v1/accounts/saved_payment_method",
      { method: "DELETE", headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Failed to remove the saved card");
  }
});

/**
 * POST /v1/billing/accounts/charge
 * Proxy to billing-service POST /internal/accounts/by-org/:orgId/charge.
 *
 * Charges a STATED amount against the card the org already saved, off-session —
 * no redirect, no hosted page. Sell-first onboarding uses it for funnels 2..N:
 * funnel 1 goes through hosted Checkout (which saves the card), every later
 * funnel settles inline on a CTA press.
 *
 * The org charged is the AUTHENTICATED one (`req.orgId`, resolved from the
 * Bearer key by `authenticate` + `requireOrg`) and is put in the downstream path
 * here — a caller cannot name whose card to charge. Same shape as
 * GET /v1/billing/payments above.
 *
 * Downstream is `/internal/*` (service-auth, x-api-key injected by
 * callExternalService), so the browser could never reach it directly — which is
 * exactly why this route exists (CLAUDE.md #3: internal routes are called
 * server-side, never mounted for clients).
 *
 * Every refusal billing-service raises is machine-readable and the dashboard
 * branches on it, so the status AND the body must survive field-for-field
 * (CLAUDE.md #7, PR #933):
 *   402 charge_declined                  — card declined, no money taken
 *   409 no_chargeable_payment_method     — nothing saved to charge
 *   409 card_not_chargeable_off_session  — issuing country blocks off-session
 *   429 charge_backoff                   — recent failure, retry later
 *   502 upstream_error                   — stripe-service unreachable
 * A 402/409 sends the consumer back to hosted checkout; a 502 means "try again"
 * and must never read as a decline. Rebuilding `{ error: message }` would
 * destroy `code` and make both branches impossible, and the gateway adds NO
 * retry/backoff of its own — `charge_backoff` is billing's answer and the caller
 * decides.
 *
 * The body is forwarded verbatim: billing owns `amountCents` / `idempotencyKey`
 * and whatever it accepts next, and a whitelist here would drop a field the
 * caller sent (CLAUDE.md #8 corollary). The minimum charge amount is Stripe's
 * and billing 400s below it — not a ceiling or floor this gateway re-states.
 */
router.post("/billing/accounts/charge", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    if (!requireBodyFields(res, req.body, ["amountCents", "idempotencyKey"])) return;
    const result = await callExternalService(
      externalServices.billing,
      `/internal/accounts/by-org/${encodeURIComponent(req.orgId!)}/charge`,
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Failed to charge the saved payment method");
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
    respondUpstreamError(res, error, "Failed to create checkout session");
  }
});

/**
 * POST /v1/billing/portal-sessions
 * Proxy to billing-service POST /v1/portal-sessions — the Stripe billing portal
 * session a customer uses to manage its payment methods.
 *
 * billing-service refuses with 402 when the org's balance is negative and the
 * settle charge fails: a customer may not swap the card out from under an unpaid
 * balance. That refusal is machine-readable — a stable `code`
 * ("outstanding_balance_unsettled") plus `owed_cents`, `balance_cents`, `reason` —
 * and the dashboard branches on `code` and renders `owed_cents`. So this catch
 * MUST NOT rebuild an envelope out of `error.message` (which IS the whole upstream
 * body as a string): `respondUpstreamError` re-emits the upstream JSON object
 * field-for-field under the upstream status. CLAUDE.md #7 / #8 — the gateway does
 * not own downstream shapes, and forwarding the status while flattening the body is
 * not passthrough.
 */
router.post("/billing/portal-sessions", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/v1/portal-sessions",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Failed to create portal session");
  }
});

// GET /v1/billing/payments — list the calling org's payment history.
//
// Org is resolved from the Bearer key (req.orgId) — the client sends no orgId.
// Sourced from stripe-service GET /internal/payments/by-org/:orgId, a user-less
// DB-mirror read that spans EVERY acquirer that has taken money for the org.
// The Stripe-shaped sibling (/internal/payment_intents/by-org) shows only one
// vendor's payments, which made this history contradict the balance for an org
// paying through another acquirer — credit with no traceable payment.
//
// Items carry id, amount (minor units), currency, canonical status, created
// (unix seconds), description and amount_returned. Response shape is owned by
// stripe-service — passthrough only, no body transform (CLAUDE.md #4/#8).
router.get("/billing/payments", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.stripe,
      `/internal/payments/by-org/${encodeURIComponent(req.orgId!)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Failed to get payments");
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
