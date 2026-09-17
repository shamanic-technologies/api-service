import { Router } from "express";
import {
  authenticate,
  requireOrg,
  requireUser,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

/**
 * A brand's reward tasks, owned by CLIENT-SERVICE.
 *
 * client-service holds the reward-task ledger (what a sales funnel owes, since when,
 * and what it has already paid) and serves it per brand on a service-auth internal
 * route the browser cannot reach. This is the only thing missing for the dashboard
 * band, so this route is that door and nothing else: one call, no aggregation, no
 * recomputation, no reward vocabulary of the gateway's own.
 *
 * The ORG is the authenticated one from `buildInternalHeaders` — never a value the
 * caller named — so a caller cannot ask for a brand another org owns; client-service
 * scopes the ledger on that org and answers for it. The response is forwarded
 * byte-for-byte (rule #8), so fields client-service adds later arrive with no gateway
 * change, and an upstream failure keeps its own status and body (rule #7) rather than
 * being softened into a defaulted "nothing is due".
 *
 * Mounted BEFORE brandRoutes in src/index.ts alongside the other /brands/:brandId/*
 * proxies that point at a service other than brand-service.
 */

/**
 * GET /v1/brands/:brandId/reward-tasks
 * → client-service GET /internal/brands/{brandId}/reward-tasks
 */
router.get(
  "/brands/:brandId/reward-tasks",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { brandId } = req.params;
      const result = await callExternalService(
        externalServices.client,
        `/internal/brands/${encodeURIComponent(brandId)}/reward-tasks`,
        { headers: buildInternalHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      console.error("[api-service] Get brand reward tasks error:", error, {
        brandId: req.params.brandId,
        orgId: req.orgId,
      });
      respondUpstreamError(res, error, "Failed to get brand reward tasks");
    }
  },
);

export default router;
