import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { LeadSearchRequestSchema } from "../schemas.js";
import { getRunsBatch, type RunWithCosts } from "@distribute/runs-client";

const router = Router();

/**
 * GET /v1/leads — list leads with filters (brand-level)
 * Proxies to lead-service GET /orgs/leads with brandId query param.
 * Returns the same enriched shape as GET /campaigns/:id/leads.
 */
router.get("/leads", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { brandId, campaignId, limit, offset } = req.query as {
      brandId?: string;
      campaignId?: string;
      limit?: string;
      offset?: string;
    };
    if (!brandId) {
      return res.status(400).json({ error: "Missing required query parameter: brandId" });
    }

    const headers = buildInternalHeaders(req);

    const params = new URLSearchParams();
    params.set("brandId", brandId);
    if (campaignId) params.set("campaignId", campaignId);
    if (limit) params.set("limit", limit);
    if (offset) params.set("offset", offset);

    // Single call to lead-service — delivery status fields are included directly on each lead (PR #171)
    const leadsResult = await callExternalService(
      externalServices.lead,
      `/orgs/leads?${params}`,
      { headers }
    ) as { leads: Array<Record<string, unknown>> };

    const rawLeads = leadsResult.leads || [];

    // Flatten enrichment data into each lead to match dashboard expectations.
    const leads = rawLeads.map((raw) => {
      const enrichment = (raw.enrichment as Record<string, unknown>) || {};
      const email = raw.email as string;
      return {
        id: raw.id,
        leadId: raw.leadId ?? null,
        email,
        namespace: raw.namespace ?? null,
        apolloPersonId: raw.apolloPersonId ?? null,
        journalistId: raw.journalistId ?? null,
        outletId: raw.outletId ?? null,
        firstName: enrichment.firstName ?? null,
        lastName: enrichment.lastName ?? null,
        emailStatus: enrichment.emailStatus ?? null,
        title: enrichment.title ?? null,
        organizationName: enrichment.organizationName ?? null,
        organizationDomain: enrichment.organizationDomain ?? null,
        organizationLogoUrl: enrichment.organizationLogoUrl ?? null,
        organizationIndustry: enrichment.organizationIndustry ?? null,
        organizationSize: enrichment.organizationSize ?? null,
        linkedinUrl: enrichment.linkedinUrl ?? null,
        status: raw.contacted ? "contacted" : "served",
        contacted: raw.contacted as boolean,
        delivered: raw.delivered as boolean,
        bounced: raw.bounced as boolean,
        replied: raw.replied as boolean,
        replyClassification: (raw.replyClassification as string) ?? null,
        createdAt: raw.servedAt ?? null,
        enrichmentRunId: raw.runId ?? null,
      };
    });

    // Batch-fetch enrichment run costs from runs-service
    const enrichmentRunIds = leads
      .map((l) => l.enrichmentRunId as string | undefined)
      .filter((id): id is string => !!id);

    let runMap = new Map<string, RunWithCosts>();
    if (enrichmentRunIds.length > 0) {
      try {
        runMap = await getRunsBatch(enrichmentRunIds, req.orgId, buildInternalHeaders(req));
      } catch (err) {
        console.warn("[api-service] Failed to fetch lead enrichment run costs:", err);
      }
    }

    // Attach run data to each lead
    const leadsWithRuns = leads.map((lead) => {
      const run = lead.enrichmentRunId ? runMap.get(lead.enrichmentRunId as string) : undefined;
      return {
        ...lead,
        enrichmentRun: run
          ? {
              status: run.status,
              startedAt: run.startedAt,
              completedAt: run.completedAt,
              totalCostInUsdCents: run.totalCostInUsdCents,
              costs: run.costs,
              serviceName: run.serviceName,
              taskName: run.taskName,
              descendantRuns: run.descendantRuns ?? [],
            }
          : null,
      };
    });

    res.json({ leads: leadsWithRuns });
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
