import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { fetchDeliveryStats } from "../lib/delivery-stats.js";
import { getRunsBatch, type RunWithCosts } from "@distribute/runs-client";
import {
  CreateCampaignRequestSchema,
  deriveCampaignType,
} from "../schemas.js";

const router = Router();

/**
 * GET /v1/campaigns
 * List campaigns for the organization
 * Query params:
 * - brandId: optional, filter by brand ID from brand-service
 */
router.get("/campaigns", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["brandId", "status", "workflowSlug", "workflowDynastySlug", "featureSlug", "featureDynastySlug"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const queryString = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.campaign,
      `/campaigns${queryString}`,
      {
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("List campaigns error:", error);
    res.status(500).json({ error: error.message || "Failed to list campaigns" });
  }
});

/**
 * POST /v1/campaigns
 * Create a new campaign
 *
 * If clientUrl is provided, scrapes the company info first and stores in company-service
 */
router.post("/campaigns", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    console.log("[api-service] POST /v1/campaigns — incoming request", {
      orgId: req.orgId,
      userId: req.userId,
      featureSlug: req.body.featureSlug,
      featureDynastySlug: req.body.featureDynastySlug,
      workflowDynastySlug: req.body.workflowDynastySlug,
    });

    // 1. Validate structure (featureInputs is opaque — we only check it's present)
    const parsed = CreateCampaignRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const missingFields = Object.keys(flat.fieldErrors);
      console.warn("[api-service] POST /v1/campaigns — validation failed", flat);
      return res.status(400).json({
        error: `Missing or invalid required fields: ${missingFields.join(", ")}.`,
        missingFields,
        hint: "Campaign creation requires: name, brandUrls, featureInputs, and at least one of workflowSlug/workflowDynastySlug plus one of featureSlug/featureDynastySlug.",
      });
    }

    const { featureSlug, featureDynastySlug, featureInputs, brandUrls } = parsed.data;
    // Prefer dynasty slug for features-service lookups (accepts both)
    const featureLookupSlug = featureDynastySlug ?? featureSlug!;

    // 2. Validate feature inputs against features-service (key-presence only)
    console.log("[api-service] POST /v1/campaigns — validating featureInputs against features-service", { featureLookupSlug });
    const featureDefinition = await callExternalService<{ inputs: Array<{ key: string; required?: boolean }> }>(
      externalServices.features,
      `/features/${encodeURIComponent(featureLookupSlug)}/inputs`,
      { headers: buildInternalHeaders(req) },
    );
    const requiredKeys = (featureDefinition.inputs ?? [])
      .filter((i) => i.required)
      .map((i) => i.key);
    const missingKeys = requiredKeys.filter((k) => !(k in featureInputs));
    if (missingKeys.length > 0) {
      console.warn("[api-service] POST /v1/campaigns — missing feature inputs", { featureLookupSlug, missingKeys });
      return res.status(400).json({
        error: `Missing required feature inputs for "${featureLookupSlug}": ${missingKeys.join(", ")}.`,
        missingKeys,
        hint: "Check the feature definition for required inputs via GET /v1/features/:slug/inputs.",
      });
    }
    console.log("[api-service] POST /v1/campaigns — featureInputs validated OK", {
      featureLookupSlug,
      inputCount: Object.keys(featureInputs).length,
    });

    // 3. Upsert brands to get brandIds (resolve all URLs in parallel)
    console.log("[api-service] POST /v1/campaigns — upserting brands", { brandUrls, orgId: req.orgId });
    const brandResults = await Promise.all(
      brandUrls.map((url) =>
        callExternalService<{ brandId: string }>(
          externalServices.brand,
          "/brands",
          {
            method: "POST",
            headers: buildInternalHeaders(req),
            body: {
              orgId: req.orgId,
              url,
              userId: req.userId,
            },
          }
        )
      )
    );
    const brandIds = brandResults.map((r) => r.brandId);
    console.log("[api-service] POST /v1/campaigns — brands upserted", { brandIds });

    // 4. Forward to campaign-service (featureInputs forwarded as-is, never inspected)
    const { workflowSlug, workflowDynastySlug, brandUrls: _brandUrls, ...restData } = parsed.data;
    // Use dynasty slug or exact slug for campaign type derivation
    const workflowSlugForType = workflowDynastySlug ?? workflowSlug!;
    const campaignType = deriveCampaignType(workflowSlugForType);
    const body: Record<string, unknown> = {
      ...restData,
      type: campaignType,
      orgId: req.orgId,
      brandIds,
    };
    // Forward whichever slug fields were provided — campaign-service accepts both
    if (workflowSlug) body.workflowSlug = workflowSlug;
    if (workflowDynastySlug) body.workflowDynastySlug = workflowDynastySlug;

    // Convert budget numbers to strings (campaign-service expects string type)
    for (const key of ["maxBudgetDailyUsd", "maxBudgetWeeklyUsd", "maxBudgetMonthlyUsd", "maxBudgetTotalUsd"]) {
      if (body[key] != null) body[key] = String(body[key]);
    }

    console.log("[api-service] POST /v1/campaigns — forwarding to campaign-service", {
      brandIds: body.brandIds,
      workflowSlug: body.workflowSlug,
      workflowDynastySlug: body.workflowDynastySlug,
      type: body.type,
      featureSlug: body.featureSlug,
      featureDynastySlug: body.featureDynastySlug,
    });
    // Enrich headers with IDs resolved during this request — the dashboard
    // sends brandUrls/workflowSlug/featureSlug in the body, not as headers,
    // so buildInternalHeaders(req) alone won't include them.
    const campaignHeaders: Record<string, string> = {
      ...buildInternalHeaders(req),
      "x-brand-id": brandIds.join(","),
      "x-feature-slug": featureLookupSlug,
      "x-workflow-slug": workflowSlugForType,
    };
    const result = await callExternalService(
      externalServices.campaign,
      "/campaigns",
      {
        method: "POST",
        headers: campaignHeaders,
        body,
      }
    );
    console.log("[api-service] POST /v1/campaigns — campaign created", {
      campaignId: (result as any).campaign?.id,
      status: (result as any).campaign?.status,
    });

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] POST /v1/campaigns — FAILED:", error.message, error.stack);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create campaign" });
  }
});

/**
 * GET /v1/campaigns/stats
 * Get aggregated stats for all campaigns, grouped by campaignId.
 * Calls 4 services in parallel with groupBy=campaignId:
 *   email-gateway, lead-service, content-generation, runs-service.
 *
 * Query params:
 * - brandId: optional, scope to a brand
 */
router.get("/campaigns/stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.orgId!;
    const brandId = req.query.brandId as string | undefined;
    const internalHeaders = buildInternalHeaders(req);

    // Dynasty / slug filters forwarded to all downstream stats calls
    const slugFilters: Record<string, string> = {};
    for (const key of ["workflowSlug", "featureSlug", "workflowDynastySlug", "featureDynastySlug"]) {
      if (req.query[key]) slugFilters[key] = req.query[key] as string;
    }

    // Build shared query params
    const baseParams = new URLSearchParams({ orgId });
    if (brandId) baseParams.set("brandId", brandId);
    for (const [k, v] of Object.entries(slugFilters)) baseParams.set(k, v);

    const deliveryParams = new URLSearchParams(baseParams);
    deliveryParams.set("groupBy", "campaignId");

    const leadParams = new URLSearchParams({ orgId });
    if (brandId) leadParams.set("brandId", brandId);
    for (const [k, v] of Object.entries(slugFilters)) leadParams.set(k, v);
    leadParams.set("groupBy", "campaignId");

    const emailgenParams = new URLSearchParams({ orgId });
    if (brandId) emailgenParams.set("brandId", brandId);
    for (const [k, v] of Object.entries(slugFilters)) emailgenParams.set(k, v);
    emailgenParams.set("groupBy", "campaignId");

    const runsParams = new URLSearchParams({ orgId, groupBy: "campaignId" });
    if (brandId) runsParams.set("brandId", brandId);
    for (const [k, v] of Object.entries(slugFilters)) runsParams.set(k, v);

    // 4 parallel calls
    const [deliveryGroups, leadGroups, emailgenGroups, costGroups] = await Promise.all([
      callExternalService<{ groups: Array<{ key: string; broadcast: Record<string, number> | null; transactional: Record<string, number> | null }> }>(
        externalServices.emailGateway,
        `/stats?${deliveryParams}`,
        { headers: internalHeaders },
      ).catch((err) => {
        console.warn("[campaigns/stats] email-gateway groupBy failed:", (err as Error).message);
        return null;
      }),
      callExternalService<{ groups: Array<{ key: string; served: number; contacted?: number; buffered: number; skipped: number }> }>(
        externalServices.lead,
        `/stats?${leadParams}`,
        { headers: internalHeaders },
      ).catch((err) => {
        console.warn("[campaigns/stats] lead-service groupBy failed:", (err as Error).message);
        return null;
      }),
      callExternalService<{ groups: Array<{ key: string; stats: { emailsGenerated: number } }> }>(
        externalServices.emailgen,
        `/stats?${emailgenParams}`,
        { headers: internalHeaders },
      ).catch((err) => {
        console.warn("[campaigns/stats] content-generation groupBy failed:", (err as Error).message);
        return null;
      }),
      callExternalService<{ groups: Array<{ dimensions: Record<string, string | null>; totalCostInUsdCents: string; runCount: number }> }>(
        externalServices.runs,
        `/v1/stats/costs?${runsParams}`,
        { headers: internalHeaders },
      ).catch((err) => {
        console.warn("[campaigns/stats] runs-service groupBy failed:", (err as Error).message);
        return null;
      }),
    ]);

    // Merge all groups by campaignId
    const merged = new Map<string, Record<string, unknown>>();
    const ensure = (id: string) => {
      if (!merged.has(id)) merged.set(id, { campaignId: id });
      return merged.get(id)!;
    };

    // Delivery stats (broadcast only)
    for (const g of deliveryGroups?.groups ?? []) {
      const s = ensure(g.key);
      const b = g.broadcast;
      s.emailsContacted = b?.emailsContacted ?? 0;
      s.emailsSent = b?.emailsSent ?? 0;
      s.emailsDelivered = b?.emailsDelivered ?? 0;
      s.emailsOpened = b?.emailsOpened ?? 0;
      s.emailsClicked = b?.emailsClicked ?? 0;
      s.emailsReplied = b?.emailsReplied ?? 0;
      s.emailsBounced = b?.emailsBounced ?? 0;
      s.repliesWillingToMeet = b?.repliesWillingToMeet ?? 0;
      s.repliesInterested = b?.repliesInterested ?? 0;
      s.repliesNotInterested = b?.repliesNotInterested ?? 0;
      s.repliesOutOfOffice = b?.repliesOutOfOffice ?? 0;
      s.repliesUnsubscribe = b?.repliesUnsubscribe ?? 0;
    }

    // Lead stats
    for (const g of leadGroups?.groups ?? []) {
      const s = ensure(g.key);
      s.leadsServed = g.served;
      s.leadsContacted = g.contacted ?? 0;
      s.leadsBuffered = g.buffered;
      s.leadsSkipped = g.skipped;
    }

    // Emailgen stats
    for (const g of emailgenGroups?.groups ?? []) {
      const s = ensure(g.key);
      s.emailsGenerated = g.stats.emailsGenerated;
    }

    // Cost stats from runs-service
    for (const g of costGroups?.groups ?? []) {
      const campaignId = g.dimensions.campaignId;
      if (!campaignId) continue;
      const s = ensure(campaignId);
      s.totalCostInUsdCents = g.totalCostInUsdCents;
      s.runCount = g.runCount;
    }

    // Fill defaults for any missing fields
    const defaults = {
      leadsServed: 0, leadsContacted: 0, leadsBuffered: 0, leadsSkipped: 0,
      emailsGenerated: 0,
      emailsContacted: 0, emailsSent: 0, emailsDelivered: 0, emailsOpened: 0, emailsClicked: 0,
      emailsReplied: 0, emailsBounced: 0,
      repliesWillingToMeet: 0, repliesInterested: 0, repliesNotInterested: 0,
      repliesOutOfOffice: 0, repliesUnsubscribe: 0,
      totalCostInUsdCents: null, runCount: 0,
    };
    for (const stats of merged.values()) {
      for (const [k, v] of Object.entries(defaults)) {
        if (stats[k] === undefined) stats[k] = v;
      }
    }

    res.json({ campaigns: Array.from(merged.values()) });
  } catch (error: any) {
    console.error("Get campaigns stats error:", error);
    res.status(500).json({ error: error.message || "Failed to get campaigns stats" });
  }
});

/**
 * GET /v1/campaigns/:id
 * Get a specific campaign
 */
router.get("/campaigns/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const result = await callExternalService(
      externalServices.campaign,
      `/campaigns/${id}`,
      {
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get campaign error:", error);
    res.status(500).json({ error: error.message || "Failed to get campaign" });
  }
});

/**
 * PATCH /v1/campaigns/:id
 * Update a campaign
 */
router.patch("/campaigns/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const result = await callExternalService(
      externalServices.campaign,
      `/campaigns/${id}`,
      {
        method: "PATCH",
        headers: buildInternalHeaders(req),
        body: req.body,
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Update campaign error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to update campaign" });
  }
});

/**
 * POST /v1/campaigns/:id/stop
 * Stop a running campaign
 */
router.post("/campaigns/:id/stop", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const result = await callExternalService(
      externalServices.campaign,
      `/campaigns/${id}`,
      {
        method: "PATCH",
        headers: buildInternalHeaders(req),
        body: { status: "stop" },
      }
    );

    res.json(result);
  } catch (error: any) {
    console.error("Stop campaign error:", error);
    res.status(500).json({ error: error.message || "Failed to stop campaign" });
  }
});

/**
 * GET /v1/campaigns/:id/runs
 * Get campaign runs/history
 */
router.get("/campaigns/:id/runs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const result = await callExternalService(
      externalServices.campaign,
      `/campaigns/${id}/runs`,
      {
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get campaign runs error:", error);
    res.status(500).json({ error: error.message || "Failed to get campaign runs" });
  }
});

/**
 * GET /v1/campaigns/:id/stats
 * Get campaign statistics
 */
router.get("/campaigns/:id/stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;
    const internalHeaders = buildInternalHeaders(req);

    // Fetch stats from all services in parallel using campaignId filter
    const [leadStats, emailgenStats, delivery, budgetUsage, costBreakdown] = await Promise.all([
      callExternalService(
        externalServices.lead,
        `/stats?campaignId=${id}`,
        { headers: internalHeaders }
      ).catch((err) => {
        console.warn("[campaigns] Lead-service stats failed:", (err as Error).message);
        return null;
      }),
      callExternalService(
        externalServices.emailgen,
        `/stats?campaignId=${encodeURIComponent(id)}`,
        { headers: internalHeaders }
      ).catch((err) => {
        console.warn("[campaigns] Emailgen stats failed:", (err as Error).message);
        return null;
      }),
      fetchDeliveryStats({ campaignId: id }, req),
      callExternalService<{ results: Record<string, { totalCostInUsdCents: string | null }> }>(
        externalServices.campaign,
        "/stats/batch-budget",
        { method: "POST", body: { campaignIds: [id] }, headers: internalHeaders }
      ).catch((err) => {
        console.warn("[campaigns] Budget usage failed:", (err as Error).message);
        return null;
      }),
      // Full cost breakdown by cost name from runs-service (single source of truth)
      callExternalService<{ groups: Array<{ dimensions: Record<string, string | null>; totalCostInUsdCents: string; actualCostInUsdCents: string; provisionedCostInUsdCents: string; totalQuantity: string }> }>(
        externalServices.runs,
        `/v1/stats/costs?orgId=${encodeURIComponent(orgId)}&campaignId=${encodeURIComponent(id)}&groupBy=costName`,
        { headers: internalHeaders }
      ).catch((err) => {
        console.warn("[campaigns] Cost breakdown failed:", (err as Error).message);
        return null;
      }),
    ]);

    const stats: Record<string, any> = { campaignId: id };

    // Lead stats from lead-service: { served, contacted, buffered, skipped, apollo }
    if (leadStats) {
      const ls = leadStats as { served: number; contacted: number; buffered: number; skipped: number; apollo?: { enrichedLeadsCount: number; searchCount: number; fetchedPeopleCount: number; totalMatchingPeople: number } };
      stats.leadsServed = ls.served;
      stats.leadsContacted = ls.contacted ?? 0;
      stats.leadsBuffered = ls.buffered;
      stats.leadsSkipped = ls.skipped;
      if (ls.apollo) stats.apollo = ls.apollo;
    } else {
      stats.leadsServed = 0;
      stats.leadsContacted = 0;
      stats.leadsBuffered = 0;
      stats.leadsSkipped = 0;
    }

    // Lead-service served_leads table is the source of truth for leadsServed.
    // Do NOT override with runs-service runCount — that counts all lead-serve
    // runs including ones where no lead was found (e.g. empty buffer).

    // Emailgen stats
    if (emailgenStats) {
      const eg = (emailgenStats as any).stats || emailgenStats;
      stats.emailsGenerated = eg.emailsGenerated || 0;
      if (eg.totalCostUsd) stats.totalCostUsd = eg.totalCostUsd;
    } else {
      stats.emailsGenerated = 0;
    }

    // Delivery stats from email-gateway
    if (delivery) {
      Object.assign(stats, delivery);
    } else {
      stats.emailsContacted = 0;
      stats.emailsSent = 0;
      stats.emailsOpened = 0;
      stats.emailsClicked = 0;
      stats.emailsReplied = 0;
      stats.emailsBounced = 0;
    }

    // Budget usage from campaign-service
    if (budgetUsage?.results?.[id]) {
      stats.totalCostInUsdCents = budgetUsage.results[id].totalCostInUsdCents;
    }

    // Cost breakdown by cost name from runs-service
    if (costBreakdown?.groups) {
      stats.costBreakdown = costBreakdown.groups
        .filter((g) => g.dimensions.costName != null)
        .map((g) => ({
          costName: g.dimensions.costName!,
          totalCostInUsdCents: g.totalCostInUsdCents,
          actualCostInUsdCents: g.actualCostInUsdCents,
          provisionedCostInUsdCents: g.provisionedCostInUsdCents,
          totalQuantity: g.totalQuantity,
        }));
    }

    res.json(stats);
  } catch (error: any) {
    console.error("Get campaign stats error:", error);
    res.status(500).json({ error: error.message || "Failed to get campaign stats" });
  }
});

/**
 * GET /v1/campaigns/:id/leads
 * Get all leads for a campaign
 */
router.get("/campaigns/:id/leads", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const headers = buildInternalHeaders(req);

    // Fetch leads and their delivery statuses in parallel
    const [leadsResult, statusResult] = await Promise.all([
      callExternalService(
        externalServices.lead,
        `/leads?campaignId=${id}`,
        { headers }
      ) as Promise<{ leads: Array<Record<string, unknown>> }>,
      callExternalService<{ statuses: Array<{ leadId: string; email: string; contacted: boolean; delivered: boolean; bounced: boolean; replied: boolean; lastDeliveredAt: string | null }> }>(
        externalServices.lead,
        `/leads/status?campaignId=${id}`,
        { headers }
      ),
    ]);

    const rawLeads = leadsResult.leads || [];

    // Build a lookup of email → delivery status from lead-service
    const statusByEmail = new Map<string, { contacted: boolean; delivered: boolean; bounced: boolean; replied: boolean }>();
    for (const s of statusResult.statuses || []) {
      statusByEmail.set(s.email, { contacted: s.contacted, delivered: s.delivered, bounced: s.bounced, replied: s.replied });
    }

    // Flatten enrichment data into each lead to match dashboard expectations.
    // Lead-service returns: { id, email, servedAt, runId, enrichment: { firstName, lastName, ... } }
    // Dashboard expects: { id, email, createdAt, firstName, lastName, title, status, ... }
    const leads = rawLeads.map((raw) => {
      const enrichment = (raw.enrichment as Record<string, unknown>) || {};
      const email = raw.email as string;
      const delivery = statusByEmail.get(email);
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
        status: delivery?.contacted ? "contacted" : "served",
        contacted: delivery?.contacted ?? false,
        delivered: delivery?.delivered ?? false,
        bounced: delivery?.bounced ?? false,
        replied: delivery?.replied ?? false,
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
        console.warn("Failed to fetch lead enrichment run costs:", err);
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
    console.error("Get campaign leads error:", error);
    res.status(500).json({ error: error.message || "Failed to get campaign leads" });
  }
});

/**
 * GET /v1/campaigns/:id/leads/status
 * Get per-lead delivery status for a campaign
 */
router.get("/campaigns/:id/leads/status", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const brandId = req.query.brandId as string | undefined;

    const params = new URLSearchParams({ campaignId: id });
    if (brandId) params.set("brandId", brandId);

    const result = await callExternalService(
      externalServices.lead,
      `/leads/status?${params}`,
      { headers: buildInternalHeaders(req) },
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get campaign leads status error:", error);
    res.status(500).json({ error: error.message || "Failed to get campaign leads status" });
  }
});

/**
 * GET /v1/campaigns/:id/emails
 * Get all generated emails for a campaign (across all runs)
 */
router.get("/campaigns/:id/emails", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    // 1. Fetch all generations for this campaign in one call
    const emailsResult = await callExternalService(
      externalServices.emailgen,
      `/generations?campaignId=${id}`,
      {
        headers: buildInternalHeaders(req),
      }
    ) as { generations: Array<Record<string, unknown>> };

    const allEmails = emailsResult.generations || [];

    if (allEmails.length === 0) {
      return res.json({ emails: [] });
    }

    // 2. Batch-fetch generation run costs from runs-service
    const generationRunIds = allEmails
      .map((e) => e.generationRunId as string | undefined)
      .filter((id): id is string => !!id);

    let runMap = new Map<string, RunWithCosts>();
    if (generationRunIds.length > 0) {
      try {
        runMap = await getRunsBatch(generationRunIds, req.orgId, buildInternalHeaders(req));
      } catch (err) {
        console.warn("Failed to fetch run costs:", err);
      }
    }

    // 4. Attach run data to each email
    const emailsWithRuns = allEmails.map((email) => {
      const run = email.generationRunId ? runMap.get(email.generationRunId as string) : undefined;
      return {
        ...email,
        generationRun: run
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

    res.json({ emails: emailsWithRuns });
  } catch (error: any) {
    console.error("Get campaign emails error:", error);
    res.status(500).json({ error: error.message || "Failed to get campaign emails" });
  }
});

/**
 * GET /v1/campaigns/:id/stream
 * SSE endpoint — pushes campaign updates (leads, emails, stats) in real-time.
 * Falls back to server-side polling every 5s against downstream services.
 */
router.get("/campaigns/:id/stream", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const internalHeaders = buildInternalHeaders(req);

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable nginx buffering
  });
  res.flushHeaders();

  // Send a comment to keep the connection alive immediately
  res.write(": connected\n\n");

  let lastLeadCount = -1;
  let lastEmailCount = -1;
  let lastStatus = "";
  let closed = false;

  const POLL_INTERVAL_MS = 5_000;

  const poll = async () => {
    if (closed) return;

    try {
      const [campaign, leadStats, emailgenStats, delivery] = await Promise.all([
        callExternalService<{ campaign: { status: string } }>(
          externalServices.campaign,
          `/campaigns/${id}`,
          { headers: internalHeaders }
        ).catch(() => null),
        callExternalService<{ served: number; buffered: number; skipped: number }>(
          externalServices.lead,
          `/stats?campaignId=${id}`,
          { headers: internalHeaders }
        ).catch(() => null),
        callExternalService<{ stats?: { emailsGenerated?: number } }>(
          externalServices.emailgen,
          `/stats?campaignId=${encodeURIComponent(id)}`,
          { headers: internalHeaders }
        ).catch(() => null),
        fetchDeliveryStats({ campaignId: id }, req),
      ]);

      if (closed) return;

      const currentStatus = campaign?.campaign?.status ?? "";
      const currentLeads = leadStats?.served ?? 0;
      const eg = (emailgenStats as any)?.stats || emailgenStats;
      const currentEmails = eg?.emailsGenerated ?? 0;

      // Emit only when something changed
      const changed =
        currentStatus !== lastStatus ||
        currentLeads !== lastLeadCount ||
        currentEmails !== lastEmailCount;

      if (changed) {
        const payload = {
          campaignId: id,
          status: currentStatus,
          leadsServed: currentLeads,
          leadsBuffered: leadStats?.buffered ?? 0,
          leadsSkipped: leadStats?.skipped ?? 0,
          emailsGenerated: currentEmails,
          emailsSent: (delivery as any)?.emailsSent ?? 0,
          emailsOpened: (delivery as any)?.emailsOpened ?? 0,
          emailsReplied: (delivery as any)?.emailsReplied ?? 0,
        };

        res.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);

        lastStatus = currentStatus;
        lastLeadCount = currentLeads;
        lastEmailCount = currentEmails;
      }

      // Stop streaming once campaign is in a terminal state
      if (currentStatus === "completed" || currentStatus === "failed" || currentStatus === "stopped") {
        res.write(`event: done\ndata: ${JSON.stringify({ reason: currentStatus })}\n\n`);
        res.end();
        closed = true;
        return;
      }
    } catch (err) {
      if (!closed) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: "poll failed" })}\n\n`);
      }
    }

    if (!closed) {
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  let timer: ReturnType<typeof setTimeout> = setTimeout(poll, 0);

  req.on("close", () => {
    closed = true;
    clearTimeout(timer);
  });
});

/**
 * GET /v1/campaigns/:id/outlets
 * Get discovered outlets for a campaign (proxy to outlet-service)
 */
router.get("/campaigns/:id/outlets", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const result = await callExternalService(
      externalServices.outlet,
      `/outlets?campaignId=${encodeURIComponent(id)}`,
      {
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get campaign outlets error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get campaign outlets" });
  }
});

/**
 * GET /v1/campaigns/:id/journalists
 * Get discovered journalists for a campaign (proxy to journalist-service)
 * Uses POST /journalists/resolve with the campaign's outlet data.
 */
router.get("/campaigns/:id/journalists", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const baseHeaders = buildInternalHeaders(req);

    // Fetch campaign to get brandIds/featureSlug/workflowSlug for downstream headers
    const campaignResult = await callExternalService<{
      campaign: { brandIds?: string[]; featureSlug?: string; workflowSlug?: string };
    }>(externalServices.campaign, `/campaigns/${encodeURIComponent(id)}`, { headers: baseHeaders });

    const campaign = campaignResult.campaign;

    // First get the campaign's outlets, then resolve journalists for each
    const outletsResult = await callExternalService<{ outlets: Array<{ id: string; outletName?: string; outletDomain?: string | null }> }>(
      externalServices.outlet,
      `/internal/outlets/by-campaign/${encodeURIComponent(id)}`,
      { headers: baseHeaders }
    );

    const outlets = outletsResult.outlets || [];
    if (outlets.length === 0) {
      return res.json({ journalists: [] });
    }

    // Enrich headers with campaign metadata so journalist-service gets x-brand-id
    const headers: Record<string, string> = {
      ...baseHeaders,
      "x-campaign-id": id,
    };
    if (campaign.brandIds?.length) headers["x-brand-id"] = campaign.brandIds.join(",");
    if (campaign.featureSlug) headers["x-feature-slug"] = campaign.featureSlug;
    if (campaign.workflowSlug) headers["x-workflow-slug"] = campaign.workflowSlug;

    // Fetch all journalists for this campaign in one call
    const journalistsResult = await callExternalService<{
      campaignJournalists: Array<Record<string, unknown>>;
    }>(
      externalServices.journalist,
      `/campaign-outlet-journalists?campaign_id=${encodeURIComponent(id)}`,
      { headers }
    );

    // Build outlet lookup map for enriching journalists with outlet name/domain
    const outletMap = new Map<string, { outletName: string; outletDomain: string | null }>();
    for (const o of outlets) {
      if (o.id && o.outletName) {
        outletMap.set(o.id, { outletName: o.outletName, outletDomain: o.outletDomain ?? null });
      }
    }

    const allJournalists = (journalistsResult.campaignJournalists || []).map((j) => {
      const outletId = j.outletId as string | undefined;
      const outlet = outletId ? outletMap.get(outletId) : undefined;
      return {
        ...j,
        outletName: outlet?.outletName ?? (j.outletName as string | undefined) ?? "",
        outletDomain: outlet?.outletDomain ?? (j.outletDomain as string | null | undefined) ?? null,
      };
    });

    res.json({ journalists: allJournalists });
  } catch (error: any) {
    console.error("Get campaign journalists error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get campaign journalists" });
  }
});

export default router;
