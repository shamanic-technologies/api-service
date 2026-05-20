import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { fetchDeliveryStats, EMPTY_DELIVERY_STATS } from "../lib/delivery-stats.js";
import { getRunsBatch, type RunWithCosts } from "@distribute/runs-client";
import {
  CreateCampaignRequestSchema,
  deriveCampaignType,
} from "../schemas.js";

const router = Router();

/**
 * Resolve brandIds → brandUrls via brand-service.
 * Calls GET /internal/brands/:id for each brand in parallel and extracts the URL.
 */
async function resolveBrandUrls(
  brandIds: string[],
  headers: Record<string, string>,
): Promise<string[]> {
  if (brandIds.length === 0) return [];
  const results = await Promise.all(
    brandIds.map((id) =>
      callExternalService<{ brand: { url: string | null } }>(
        externalServices.brand,
        `/internal/brands/${encodeURIComponent(id)}`,
        { headers },
      ),
    ),
  );
  return results.map((r) => r.brand.url).filter((url): url is string => url != null);
}

/**
 * Enrich a campaign object by resolving brandUrls from brandIds.
 */
async function enrichCampaignBrandUrls(
  campaign: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const brandIds = campaign.brandIds as string[] | undefined;
  if (!brandIds || brandIds.length === 0) return { ...campaign, brandUrls: [] };
  const brandUrls = await resolveBrandUrls(brandIds, headers);
  return { ...campaign, brandUrls };
}

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

    const internalHeaders = buildInternalHeaders(req);
    const result = await callExternalService<{ campaigns: Record<string, unknown>[] }>(
      externalServices.campaign,
      `/campaigns${queryString}`,
      { headers: internalHeaders },
    );

    const enriched = await Promise.all(
      result.campaigns.map((c) => enrichCampaignBrandUrls(c, internalHeaders)),
    );
    res.json({ ...result, campaigns: enriched });
  } catch (error: any) {
    console.error("[api-service] List campaigns error:", error);
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
          "/orgs/brands",
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
      callExternalService<{ groups: Array<{ key: string; broadcast: {
        recipientStats: {
          contacted: number; sent: number; delivered: number; opened: number;
          bounced: number; clicked: number; unsubscribed: number;
          repliesPositive: number; repliesNegative: number; repliesNeutral: number; repliesAutoReply: number;
          repliesDetail: Record<string, number>;
        };
        emailStats: {
          sent: number; delivered: number; opened: number; clicked: number;
          bounced: number; unsubscribed: number; stepStats: unknown[];
        };
      } | null; transactional: unknown | null }> }>(
        externalServices.emailGateway,
        `/orgs/stats?${deliveryParams}`,
        { headers: internalHeaders },
      ).catch((err) => {
        console.error("[campaigns/stats] email-gateway groupBy failed:", (err as Error).message);
        return null;
      }),
      callExternalService<{ groups: Array<{ key: string; totalLeads: number; byOutreachStatus?: { contacted?: number }; buffered: number; skipped: number }> }>(
        externalServices.lead,
        `/orgs/stats?${leadParams}`,
        { headers: internalHeaders },
      ).catch((err) => {
        console.error("[campaigns/stats] lead-service groupBy failed:", (err as Error).message);
        return null;
      }),
      callExternalService<{ groups: Array<{ key: string; stats: { emailsGenerated: number } }> }>(
        externalServices.emailgen,
        `/stats?${emailgenParams}`,
        { headers: internalHeaders },
      ).catch((err) => {
        console.error("[campaigns/stats] content-generation groupBy failed:", (err as Error).message);
        return null;
      }),
      callExternalService<{ groups: Array<{ dimensions: Record<string, string | null>; totalCostInUsdCents: string; runCount: number }> }>(
        externalServices.runs,
        `/v1/stats/costs?${runsParams}`,
        { headers: internalHeaders },
      ).catch((err) => {
        console.error("[campaigns/stats] runs-service groupBy failed:", (err as Error).message);
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
      if (!g.key) continue;
      const s = ensure(g.key);
      const b = g.broadcast;
      s.recipientStats = b?.recipientStats ?? EMPTY_DELIVERY_STATS.recipientStats;
      s.emailStats = b?.emailStats ?? EMPTY_DELIVERY_STATS.emailStats;
    }

    // Lead stats (new shape: totalLeads, byOutreachStatus.contacted, buffered, skipped)
    for (const g of leadGroups?.groups ?? []) {
      if (!g.key) continue;
      const s = ensure(g.key);
      s.leadsServed = g.totalLeads;
      s.leadsContacted = g.byOutreachStatus?.contacted ?? 0;
      s.leadsBuffered = g.buffered;
      s.leadsSkipped = g.skipped;
    }

    // Emailgen stats
    for (const g of emailgenGroups?.groups ?? []) {
      if (!g.key) continue;
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
      recipientStats: EMPTY_DELIVERY_STATS.recipientStats,
      emailStats: EMPTY_DELIVERY_STATS.emailStats,
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
    const internalHeaders = buildInternalHeaders(req);

    console.log("[api-service] GET /campaigns/:id — calling campaign-service", { campaignId: id, orgId: req.orgId });
    const result = await callExternalService<{ campaign: Record<string, unknown> }>(
      externalServices.campaign,
      `/campaigns/${id}`,
      { headers: internalHeaders },
    );

    const enriched = await enrichCampaignBrandUrls(result.campaign, internalHeaders);
    res.json({ ...result, campaign: enriched });
  } catch (error: any) {
    console.error("[api-service] Get campaign error:", error, { campaignId: req.params.id, orgId: req.orgId });
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
        `/orgs/stats?campaignId=${id}`,
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

    // Lead stats from lead-service (new shape): { totalLeads, byOutreachStatus, buffered, skipped, claimed }
    if (leadStats) {
      const ls = leadStats as { totalLeads: number; byOutreachStatus?: { contacted?: number }; buffered: number; skipped: number };
      stats.leadsServed = ls.totalLeads;
      stats.leadsContacted = ls.byOutreachStatus?.contacted ?? 0;
      stats.leadsBuffered = ls.buffered;
      stats.leadsSkipped = ls.skipped;
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
      stats.recipientStats = delivery.recipientStats;
      stats.emailStats = delivery.emailStats;
    } else {
      stats.recipientStats = EMPTY_DELIVERY_STATS.recipientStats;
      stats.emailStats = EMPTY_DELIVERY_STATS.emailStats;
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
        ).catch((err) => { console.error("[campaigns/sse] Failed to fetch campaign-service status:", (err as Error).message); return null; }),
        callExternalService<{ totalLeads: number; buffered: number; skipped: number }>(
          externalServices.lead,
          `/orgs/stats?campaignId=${id}`,
          { headers: internalHeaders }
        ).catch((err) => { console.error("[campaigns/sse] Failed to fetch lead-service stats:", (err as Error).message); return null; }),
        callExternalService<{ stats?: { emailsGenerated?: number } }>(
          externalServices.emailgen,
          `/stats?campaignId=${encodeURIComponent(id)}`,
          { headers: internalHeaders }
        ).catch((err) => { console.error("[campaigns/sse] Failed to fetch emailgen-service stats:", (err as Error).message); return null; }),
        fetchDeliveryStats({ campaignId: id }, req),
      ]);

      if (closed) return;

      const currentStatus = campaign?.campaign?.status ?? "";
      const currentLeads = leadStats?.totalLeads ?? 0;
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
          recipientStats: delivery?.recipientStats ?? EMPTY_DELIVERY_STATS.recipientStats,
          emailStats: delivery?.emailStats ?? EMPTY_DELIVERY_STATS.emailStats,
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
    const baseHeaders = buildInternalHeaders(req);

    // Fetch campaign to enrich headers with campaign metadata for downstream calls
    console.log("[api-service] GET /campaigns/:id/outlets — calling campaign-service", { campaignId: id, orgId: req.orgId, authType: req.authType });
    const campaignResult = await callExternalService<{
      campaign: { brandIds?: string[]; featureSlug?: string; workflowSlug?: string };
    }>(externalServices.campaign, `/campaigns/${encodeURIComponent(id)}`, { headers: baseHeaders });

    const campaign = campaignResult.campaign;

    const headers: Record<string, string> = {
      ...baseHeaders,
      "x-campaign-id": id,
    };
    if (campaign.brandIds?.length) headers["x-brand-id"] = campaign.brandIds.join(",");
    if (campaign.featureSlug) headers["x-feature-slug"] = campaign.featureSlug;
    if (campaign.workflowSlug) headers["x-workflow-slug"] = campaign.workflowSlug;

    const result = await callExternalService(
      externalServices.outlet,
      `/orgs/outlets?campaignId=${encodeURIComponent(id)}`,
      { headers }
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get campaign outlets error:", error, { campaignId: req.params.id, orgId: req.orgId, authType: req.authType });
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
    console.log("[api-service] GET /campaigns/:id/journalists — calling campaign-service", { campaignId: id, orgId: req.orgId, authType: req.authType });
    const campaignResult = await callExternalService<{
      campaign: { brandIds?: string[]; featureSlug?: string; workflowSlug?: string };
    }>(externalServices.campaign, `/campaigns/${encodeURIComponent(id)}`, { headers: baseHeaders });

    const campaign = campaignResult.campaign;

    // First get the campaign's outlets, then resolve journalists for each
    const outletsResult = await callExternalService<{ outlets: Array<{ id: string; outletName?: string; outletDomain?: string | null }> }>(
      externalServices.outlet,
      `/internal/outlets?campaignId=${encodeURIComponent(id)}`,
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
      `/orgs/campaign-outlet-journalists?campaign_id=${encodeURIComponent(id)}`,
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
