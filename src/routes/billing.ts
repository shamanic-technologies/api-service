import { Router } from "express";
import { authenticate, requireOrg, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

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

// GET /v1/billing/accounts/transactions — transaction history
router.get("/billing/accounts/transactions", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/v1/accounts/transactions",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get transactions" });
  }
});

// PATCH /v1/billing/accounts/mode — switch billing mode
router.patch("/billing/accounts/mode", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/v1/accounts/mode",
      { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to switch billing mode" });
  }
});

// POST /v1/billing/credits/deduct — deduct credits
router.post("/billing/credits/deduct", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/v1/credits/deduct",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to deduct credits" });
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

export default router;
