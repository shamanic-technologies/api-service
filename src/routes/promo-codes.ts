import { Router } from "express";
import { authenticatePlatform, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// Promo-code grant amounts (e.g. the new-signup "welcome" credit gift) are
// staff-managed config. Both routes are gated with authenticatePlatform — the
// repo's only privileged-caller mechanism (X-API-Key === ADMIN_DISTRIBUTE_API_KEY,
// same gate as every /admin/* route). A normal user key (Bearer) is rejected 401,
// so the grant amount can never be self-set by a customer.

// GET /v1/promo-codes/:code — read a promo code's grant amount (staff only).
// Transparent proxy to billing-service GET /internal/promo-codes/:code.
router.get("/promo-codes/:code", authenticatePlatform, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      `/internal/promo-codes/${encodeURIComponent(req.params.code)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || "Failed to get promo code" });
  }
});

// PATCH /v1/promo-codes/:code — re-price a promo code's grant amount (staff only).
// Body { amountCents } forwarded as-is; value validation (non-negative integer) is
// owned by billing-service. Transparent proxy to billing PATCH /internal/promo-codes/:code.
router.patch("/promo-codes/:code", authenticatePlatform, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      `/internal/promo-codes/${encodeURIComponent(req.params.code)}`,
      { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || "Failed to update promo code" });
  }
});

export default router;
