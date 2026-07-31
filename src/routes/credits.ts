import { Router } from "express";
import {
  authenticate,
  authenticatePlatform,
  requireOrg,
  requireStaff,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

// ---------------------------------------------------------------------------
// Credit-grant + grants-ledger proxies to billing-service.
//
// Two auth tiers:
//   - STAFF-ONLY (requireStaff): mutating grant (POST /billing/credits/grant) and the
//     cross-org platform ledger (GET /billing/credits/grants/all). The caller must come in
//     via the platform API key (authType "admin") AND carry an `x-email` in the STAFF_EMAILS
//     allowlist. The platform key alone is shared with the customer dashboard's server-side
//     proxy, so it does NOT distinguish staff from customer — x-email (forwarded from the
//     verified dashboard/admin session) is the staff signal. A customer can never reach these
//     routes, so cannot self-credit and cannot read other orgs' grants.
//   - ORG-SCOPED (authenticate + requireOrg): the per-org grants ledger
//     (GET /billing/credits/grants). Any authenticated org reads its OWN grants — the customer
//     dashboard "Gifts received" section. billing-service scopes the response to the caller's
//     x-org-id, so there is ZERO cross-org exposure (same trust model as GET /billing/accounts).
//
// Transparent proxy (CLAUDE.md): body forwarded as-is (rule #4), responses passthrough
// (rule #8), upstream errors propagated verbatim (rule #7).
// ---------------------------------------------------------------------------

// Forward the verified staff email downstream for grant-ledger actor attribution.
function staffHeaders(
  req: AuthenticatedRequest,
  base: Record<string, string>,
): Record<string, string> {
  const headers = { ...base };
  if (req.staffEmail) headers["x-email"] = req.staffEmail;
  return headers;
}

// POST /v1/billing/credits/grant — grant free credit to the org in context (staff only).
// Body { amountCents, note?, idempotencyKey } forwarded as-is to billing-service
// POST /v1/credits/grant (which owns value validation).
router.post(
  "/billing/credits/grant",
  authenticate,
  requireOrg,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.billing,
        "/v1/credits/grant",
        {
          method: "POST",
          body: req.body,
          headers: staffHeaders(req, buildInternalHeaders(req)),
        },
      );
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to grant credit" });
    }
  },
);

// GET /v1/billing/credits/grants — the org's OWN grants ledger (normal org auth).
// Powers the customer dashboard "Gifts received" section. billing-service scopes the
// response to the caller's x-org-id, so an org reads only its own grants (no cross-org
// exposure). Same auth tier as GET /v1/billing/accounts.
router.get(
  "/billing/credits/grants",
  authenticate,
  requireOrg,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.billing,
        "/v1/credits/grants",
        { headers: buildInternalHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to get grants ledger" });
    }
  },
);

// GET /v1/billing/free-credit-promises — the free credits this org is still waiting on.
//
// The customer's own view of every outstanding promise: the welcome remainder and,
// since the referral launched, a $500 promise for each converting referral. Each one
// carries what it is worth, the cumulative-payments bar that unlocks it, and how far
// along the org is.
//
// Same auth tier as the org's own grants ledger above: billing-service scopes the
// response to the caller's x-org-id, so an org reads only its own promises and the
// client never names an org.
//
// Transparent passthrough. The response is billing's, including `referred_org_id`
// (the org whose conversion opened the promise), which the dashboard resolves to a
// brand through brand-service. The gateway does not reshape or compute anything.
router.get(
  "/billing/free-credit-promises",
  authenticate,
  requireOrg,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.billing,
        "/v1/free-credit-promises",
        { headers: buildInternalHeaders(req) },
      );
      res.json(result);
    } catch (error: unknown) {
      respondUpstreamError(res, error, "Failed to get free-credit promises");
    }
  },
);

// GET /v1/billing/credits/grants/all — platform-wide cross-org grants ledger (staff only).
// NO org context (cross-org read); gated by authenticatePlatform + requireStaff.
router.get(
  "/billing/credits/grants/all",
  authenticatePlatform,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.billing,
        "/internal/credits/grants",
        { headers: staffHeaders(req, {}) },
      );
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to get platform grants ledger" });
    }
  },
);

export default router;
