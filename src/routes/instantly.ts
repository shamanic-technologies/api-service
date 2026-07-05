import { Router } from "express";
import {
  authenticatePlatform,
  requireStaff,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";

const router = Router();

// ---------------------------------------------------------------------------
// Staff-only proxies to instantly-service platform/audit endpoints.
//
// These surface FLEET-WIDE ops data (cross-org sending infrastructure), NOT
// customer data — they power the staff "Audit → Instantly" ops page in
// admin.distribute.you. Gated by authenticatePlatform + requireStaff (same tier
// as GET /v1/billing/credits/grants/all): the caller must come in via the
// platform API key (authType "admin") AND carry an x-email in the STAFF_EMAILS
// allowlist. No org context (cross-org read). A customer (Bearer user key) or a
// missing/non-allowlisted email gets 403.
//
// Transparent proxy (CLAUDE.md): no body/response transform (rules #4/#8),
// upstream errors propagated verbatim (rule #7). The X-API-Key for instantly-service
// is injected by callExternalService; x-email is forwarded for staff attribution.
// ---------------------------------------------------------------------------

// Forward the verified staff email downstream for actor attribution.
function staffHeaders(req: AuthenticatedRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  if (req.staffEmail) headers["x-email"] = req.staffEmail;
  return headers;
}

// GET /v1/instantly/audit/sending-forecast — platform sending-forecast audit (staff only).
// Transparent proxy to instantly-service GET /internal/audit/sending-forecast; no org
// context, response owned by the downstream service.
router.get(
  "/instantly/audit/sending-forecast",
  authenticatePlatform,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.instantly,
        "/internal/audit/sending-forecast",
        { headers: staffHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || "Failed to get instantly sending forecast" });
    }
  },
);

// GET /v1/instantly/audit/account-health — platform per-account deliverability health audit (staff only).
// Transparent proxy to instantly-service GET /internal/audit/account-health; no org
// context, response owned by the downstream service.
router.get(
  "/instantly/audit/account-health",
  authenticatePlatform,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.instantly,
        "/internal/audit/account-health",
        { headers: staffHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || "Failed to get instantly account-health audit" });
    }
  },
);

// GET /v1/instantly/audit/capacity-history — platform sending-capacity-over-time audit (staff only).
// Transparent proxy to instantly-service GET /internal/audit/capacity-history; no org
// context, response owned by the downstream service. Optional `days` query param forwarded through.
router.get(
  "/instantly/audit/capacity-history",
  authenticatePlatform,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const params = new URLSearchParams();
      if (req.query.days) params.set("days", req.query.days as string);
      const queryString = params.toString() ? `?${params.toString()}` : "";
      const result = await callExternalService(
        externalServices.instantly,
        `/internal/audit/capacity-history${queryString}`,
        { headers: staffHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || "Failed to get instantly capacity-history audit" });
    }
  },
);

// GET /v1/instantly/audit/reconcile — platform local-vs-Instantly reconciliation audit (staff only).
// Transparent proxy to instantly-service GET /internal/audit/reconcile; no org
// context, response owned by the downstream service.
router.get(
  "/instantly/audit/reconcile",
  authenticatePlatform,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.instantly,
        "/internal/audit/reconcile",
        { headers: staffHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || "Failed to get instantly reconcile audit" });
    }
  },
);

export default router;
