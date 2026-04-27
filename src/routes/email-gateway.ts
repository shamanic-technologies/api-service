import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { fetchDeliveryStats, EMPTY_DELIVERY_STATS } from "../lib/delivery-stats.js";

const router = Router();

/**
 * GET /v1/email-gateway/stats
 * Get delivery stats from email-gateway (broadcast only).
 * Supports filtering by brandId and/or campaignId.
 */
router.get("/email-gateway/stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const filters: Record<string, string | undefined> = {};
    for (const key of ["brandId", "campaignId", "workflowSlugs", "featureSlugs", "workflowDynastySlug", "featureDynastySlug"]) {
      if (req.query[key]) filters[key] = req.query[key] as string;
    }

    const delivery = await fetchDeliveryStats(filters, req);

    res.json(delivery ?? EMPTY_DELIVERY_STATS);
  } catch (error: any) {
    console.error("Get email-gateway stats error:", error);
    res.status(500).json({ error: error.message || "Failed to get email-gateway stats" });
  }
});

export default router;
