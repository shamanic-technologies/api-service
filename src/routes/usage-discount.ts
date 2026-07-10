import { Router } from "express";
import {
  authenticate,
  requireOrg,
  requireStaff,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// ---------------------------------------------------------------------------
// Per-org platform-usage discount proxies to billing-service (STAFF-ONLY).
//
// Staff set / read / remove a given org's usage-discount percentage. Same auth
// tier as the credit-grant mutation (POST /billing/credits/grant): the caller
// comes in via the platform API key (authType "admin") AND carries an `x-email`
// in the STAFF_EMAILS allowlist. The platform key alone is shared with the
// customer dashboard's server-side proxy, so it does NOT distinguish staff from
// customer — x-email is the staff signal. A customer can never reach these
// routes, so cannot self-discount nor read/alter another org's discount.
//
// The target org is the one in context (x-org-id, forwarded by
// buildInternalHeaders); billing-service keys ONE discount value per org and
// records the staff x-email as `setBy` on a set.
//
// Transparent proxy (CLAUDE.md): body forwarded as-is (rule #4), responses
// passthrough (rule #8), upstream errors propagated verbatim (rule #7).
// ---------------------------------------------------------------------------

// Forward the verified staff email downstream for `setBy` attribution.
function staffHeaders(
  req: AuthenticatedRequest,
  base: Record<string, string>,
): Record<string, string> {
  const headers = { ...base };
  if (req.staffEmail) headers["x-email"] = req.staffEmail;
  return headers;
}

// GET /v1/billing/usage-discount — read the org-in-context's usage discount (staff only).
// Proxies billing-service GET /v1/usage-discount. Response { orgId, discountPct, setBy, setAt }
// (discountPct null when unset) owned by the downstream service.
router.get(
  "/billing/usage-discount",
  authenticate,
  requireOrg,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.billing,
        "/v1/usage-discount",
        { headers: staffHeaders(req, buildInternalHeaders(req)) },
      );
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to get usage discount" });
    }
  },
);

// PUT /v1/billing/usage-discount — set / replace the org-in-context's usage discount (staff only).
// Body { discountPct } forwarded as-is to billing-service PUT /v1/usage-discount (which owns
// value validation: integer 0–100, fail-loud 400, no clamp). setBy = the staff x-email.
router.put(
  "/billing/usage-discount",
  authenticate,
  requireOrg,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.billing,
        "/v1/usage-discount",
        {
          method: "PUT",
          body: req.body,
          headers: staffHeaders(req, buildInternalHeaders(req)),
        },
      );
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to set usage discount" });
    }
  },
);

// DELETE /v1/billing/usage-discount — remove the org-in-context's usage discount (staff only).
// Proxies billing-service DELETE /v1/usage-discount (idempotent → discountPct null).
router.delete(
  "/billing/usage-discount",
  authenticate,
  requireOrg,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.billing,
        "/v1/usage-discount",
        { method: "DELETE", headers: staffHeaders(req, buildInternalHeaders(req)) },
      );
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to remove usage discount" });
    }
  },
);

export default router;
