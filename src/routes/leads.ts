import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { LeadSearchRequestSchema } from "../schemas.js";

const router = Router();

/**
 * GET /v1/leads — pass-through to lead-service GET /orgs/leads.
 * No body transform, no aggregation. Response shape is whatever lead-service returns.
 */
router.get("/leads", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { brandId, campaignId, limit, offset, view } = req.query as {
      brandId?: string;
      campaignId?: string;
      limit?: string;
      offset?: string;
      view?: string;
    };
    if (!brandId && !campaignId) {
      return res.status(400).json({ error: "Missing required query parameter: brandId or campaignId" });
    }

    const params = new URLSearchParams();
    if (brandId) params.set("brandId", brandId);
    if (campaignId) params.set("campaignId", campaignId);
    if (limit) params.set("limit", limit);
    if (offset) params.set("offset", offset);
    if (view) params.set("view", view);

    const result = await callExternalService(
      externalServices.lead,
      `/orgs/leads?${params}`,
      { headers: buildInternalHeaders(req) }
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get brand leads error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get leads" });
  }
});

/**
 * POST /v1/leads/search
 * Search for leads via lead-service
 */
router.post("/leads/search", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = LeadSearchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const {
      person_titles,
      organization_locations,
      organization_industries,
      organization_num_employees_ranges,
      per_page,
    } = parsed.data;

    const result = await callExternalService(
      externalServices.lead,
      "/search",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: {
          personTitles: person_titles,
          organizationLocations: organization_locations,
          qOrganizationIndustryTagIds: organization_industries,
          organizationNumEmployeesRanges: organization_num_employees_ranges,
          perPage: Math.min(per_page, 100),
          orgId: req.orgId,
          userId: req.userId,
        },
      }
    );

    res.json(result);
  } catch (error: any) {
    console.error("Lead search error:", error);
    res.status(500).json({ error: error.message || "Failed to search leads" });
  }
});

// POST /v1/leads/enrich removed - no consumers

export default router;
