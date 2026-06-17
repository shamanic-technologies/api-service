import { Router } from "express";
import { authenticate, requireOrg, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, callExternalServiceWithStatus, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

function sendBillingProxyError(res: any, error: any, fallbackMessage: string) {
  const status = error.statusCode || 500;
  const message = error.message || fallbackMessage;

  try {
    res.status(status).json(JSON.parse(message));
  } catch {
    res.status(status).send(message);
  }
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
    const result = await callExternalService(
      externalServices.billing,
      `/internal/brands/${req.params.brandId}/daily-budget`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get daily budget" });
  }
});

/**
 * PATCH /v1/brands/:brandId/daily-budget
 * Proxy to billing-service PATCH /v1/brands/:brandId/daily-budget.
 * Sets a brand's daily budget. Body { dailyBudgetCents } (number or decimal
 * string, >= 0; 0 = pause) and response shape are owned by the downstream
 * service; identity headers (x-org-id, x-user-id, x-run-id) are forwarded via
 * buildInternalHeaders. Downstream 4xx errors propagate verbatim — passthrough only.
 */
router.patch("/brands/:brandId/daily-budget", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      `/v1/brands/${req.params.brandId}/daily-budget`,
      { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to set daily budget" });
  }
});

/**
 * POST /v1/brands/:brandId/subscription
 * Proxy to billing-service POST /v1/brands/:brandId/subscription.
 * Onboards a brand subscription at the requested amount. Body + response shapes
 * are owned by billing-service; api-service forwards identity headers and
 * mirrors upstream status/body.
 */
router.post("/brands/:brandId/subscription", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.billing,
      `/v1/brands/${req.params.brandId}/subscription`,
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.status(status).json(data);
  } catch (error: any) {
    sendBillingProxyError(res, error, "Failed to create brand subscription");
  }
});

/**
 * PATCH /v1/brands/:brandId/subscription
 * Proxy to billing-service PATCH /v1/brands/:brandId/subscription.
 * Changes a brand subscription amount. Passthrough only.
 */
router.patch("/brands/:brandId/subscription", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.billing,
      `/v1/brands/${req.params.brandId}/subscription`,
      { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.status(status).json(data);
  } catch (error: any) {
    sendBillingProxyError(res, error, "Failed to update brand subscription");
  }
});

/**
 * POST /v1/brands/:brandId/subscription/pause
 * Proxy to billing-service POST /v1/brands/:brandId/subscription/pause.
 * Pauses a brand subscription. Passthrough only.
 */
router.post("/brands/:brandId/subscription/pause", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.billing,
      `/v1/brands/${req.params.brandId}/subscription/pause`,
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.status(status).json(data);
  } catch (error: any) {
    sendBillingProxyError(res, error, "Failed to pause brand subscription");
  }
});

/**
 * POST /v1/brands/:brandId/subscription/resume
 * Proxy to billing-service POST /v1/brands/:brandId/subscription/resume.
 * Resumes a brand subscription. Passthrough only.
 */
router.post("/brands/:brandId/subscription/resume", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.billing,
      `/v1/brands/${req.params.brandId}/subscription/resume`,
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.status(status).json(data);
  } catch (error: any) {
    sendBillingProxyError(res, error, "Failed to resume brand subscription");
  }
});

export default router;
