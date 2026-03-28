import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * GET /v1/runs/stats/costs
 * Get cost stats from runs-service.
 *
 * Query params:
 * - groupBy (required): "brandId" | "costName" | "campaignId" | "serviceName"
 * - brandId: filter by brand
 * - campaignId: filter by campaign
 * - taskName: filter by task name (e.g. "lead-serve")
 */
router.get("/runs/stats/costs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.orgId!;
    const groupBy = req.query.groupBy as string;

    if (!groupBy) {
      return res.status(400).json({ error: "groupBy query param is required" });
    }

    const params = new URLSearchParams({
      orgId,
      groupBy,
    });
    for (const key of ["brandId", "campaignId", "taskName", "workflowSlug", "featureSlug", "workflowDynastySlug", "featureDynastySlug"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }

    const data = await callExternalService<{
      groups: Array<Record<string, unknown>>;
    }>(
      externalServices.runs,
      `/v1/stats/costs?${params}`,
      { headers: buildInternalHeaders(req) },
    );

    res.json(data);
  } catch (error: any) {
    console.error("Get runs stats costs error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get runs stats" });
  }
});

export default router;
