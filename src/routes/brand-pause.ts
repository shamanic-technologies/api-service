import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * Brand-level pause state.
 *
 * NOTE: although the client-facing path lives under /v1/brands/*, the pause
 * flag is owned by CAMPAIGN-SERVICE (it owns the scheduler that gates sending),
 * NOT brand-service. These routes forward to campaign-service /brands/:brandId/pause.
 *
 * This router MUST be mounted BEFORE brandRoutes in src/index.ts so the specific
 * /brands/:brandId/pause routes win over any future brand-service brand proxy.
 */

/**
 * GET /v1/brands/:brandId/pause
 * Read a brand's pause state from campaign-service.
 */
router.get(
  "/brands/:brandId/pause",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { brandId } = req.params;
      const result = await callExternalService(
        externalServices.campaign,
        `/brands/${brandId}/pause`,
        { headers: buildInternalHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      console.error("[api-service] Get brand pause error:", error, { brandId: req.params.brandId, orgId: req.orgId });
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to get brand pause state" });
    }
  },
);

/**
 * PATCH /v1/brands/:brandId/pause
 * Update a brand's pause state in campaign-service. Body: { paused: boolean }.
 */
router.patch(
  "/brands/:brandId/pause",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { brandId } = req.params;
      const result = await callExternalService(
        externalServices.campaign,
        `/brands/${brandId}/pause`,
        {
          method: "PATCH",
          headers: buildInternalHeaders(req),
          body: req.body,
        },
      );
      res.json(result);
    } catch (error: any) {
      console.error("[api-service] Update brand pause error:", error, { brandId: req.params.brandId, orgId: req.orgId });
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to update brand pause state" });
    }
  },
);

export default router;
