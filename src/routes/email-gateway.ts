import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { fetchDeliveryStats } from "../lib/delivery-stats.js";

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

    res.json(delivery ?? {
      emailsContacted: 0,
      emailsSent: 0,
      emailsDelivered: 0,
      emailsOpened: 0,
      emailsClicked: 0,
      emailsBounced: 0,
      repliesPositive: 0,
      repliesNegative: 0,
      repliesNeutral: 0,
      repliesAutoReply: 0,
      repliesDetail: {
        interested: 0, meetingBooked: 0, closed: 0,
        notInterested: 0, wrongPerson: 0, unsubscribe: 0,
        neutral: 0, autoReply: 0, outOfOffice: 0,
      },
    });
  } catch (error: any) {
    console.error("Get email-gateway stats error:", error);
    res.status(500).json({ error: error.message || "Failed to get email-gateway stats" });
  }
});

export default router;
