import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * What a brand may actually spend today.
 *
 * Owned by CAMPAIGN-SERVICE, not brand-service: the answer is the join of the
 * campaign STATUS (campaign-service) with the per-funnel CEILING (billing-service),
 * and campaign-service is the only place that holds the first half. The client-facing
 * path stays under /v1/brands/* because that is the downstream path (rule #1, no path
 * renaming) — so this router MUST be mounted BEFORE brandRoutes in src/index.ts, like
 * brand-pause, or a future brand-service /brands/:brandId proxy would shadow it.
 *
 * Both figures come back on one response (configured vs running) along with the
 * per-offer / per-campaign / per-ceiling decompositions, so no caller has to sum
 * anything. Every field is campaign-service's; nothing is reshaped here.
 */

/**
 * GET /v1/brands/:brandId/spendable-budget
 * Read a brand's configured and actually-running daily budget from campaign-service.
 */
router.get(
  "/brands/:brandId/spendable-budget",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { brandId } = req.params;
      const result = await callExternalService(
        externalServices.campaign,
        `/brands/${brandId}/spendable-budget`,
        { headers: buildInternalHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      console.error("[api-service] Get brand spendable budget error:", error, {
        brandId: req.params.brandId,
        orgId: req.orgId,
      });
      respondUpstreamError(res, error, "Failed to get brand spendable budget");
    }
  },
);

export default router;
