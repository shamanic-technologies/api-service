import { Router } from "express";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";
import { getWorkflowCategory, getWorkflowDisplayName, getSectionKey, getSignatureName, SECTION_LABELS, type WorkflowCategory } from "@distribute/content";

const router = Router();

interface DeliveryStats {
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  emailsReplied: number;
  emailsBounced: number;
  repliesInterested: number;
}

const EMPTY_STATS: DeliveryStats = {
  emailsSent: 0,
  emailsOpened: 0,
  emailsClicked: 0,
  emailsReplied: 0,
  emailsBounced: 0,
  repliesInterested: 0,
};

interface BrandEntry {
  brandId: string | null;
  brandUrl: string | null;
  brandDomain: string | null;
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  emailsReplied: number;
  totalCostUsdCents: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  costPerOpenCents: number | null;
  costPerClickCents: number | null;
  costPerReplyCents: number | null;
}

interface WorkflowEntry {
  workflowName: string;
  displayName: string;
  signatureName: string | null;
  category: WorkflowCategory | null;
  sectionKey: string | null;
  runCount: number;
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  emailsReplied: number;
  repliesInterested: number;
  recipients: number;
  totalCostUsdCents: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  interestedRate: number;
  costPerOpenCents: number | null;
  costPerClickCents: number | null;
  costPerReplyCents: number | null;
}

interface CategorySectionStats {
  emailsSent: number;
  emailsOpened: number;
  emailsReplied: number;
  repliesInterested: number;
  recipients: number;
  totalCostUsdCents: number;
  openRate: number;
  replyRate: number;
  interestedRate: number;
  costPerOpenCents: number | null;
  costPerReplyCents: number | null;
}

interface CategorySection {
  category: WorkflowCategory;
  sectionKey: string;
  label: string;
  stats: CategorySectionStats;
  workflows: WorkflowEntry[];
  brands: BrandEntry[];
}

interface LeaderboardData {
  brands: BrandEntry[];
  workflows: WorkflowEntry[];
  hero: unknown;
  updatedAt: string;
  availableCategories: WorkflowCategory[];
  categorySections: CategorySection[];
}

interface BroadcastStatsResponse {
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  emailsReplied: number;
  emailsBounced: number;
  repliesWillingToMeet: number;
  repliesInterested: number;
  repliesNotInterested: number;
  repliesOutOfOffice: number;
  repliesUnsubscribe: number;
}

function toBroadcastDeliveryStats(b: BroadcastStatsResponse | undefined | null): DeliveryStats {
  if (!b) return EMPTY_STATS;
  return {
    emailsSent: b.emailsSent || 0,
    emailsOpened: b.emailsOpened || 0,
    emailsClicked: b.emailsClicked || 0,
    emailsReplied: b.emailsReplied || 0,
    emailsBounced: b.emailsBounced || 0,
    repliesInterested: (b.repliesWillingToMeet || 0) + (b.repliesInterested || 0),
  };
}

/** Fetch broadcast delivery stats from email-gateway.
 *  Only uses broadcast stats (outreach emails).
 *  Transactional stats are transactional/test emails — not relevant. */
async function fetchBroadcastDeliveryStats(filters: Record<string, string>): Promise<DeliveryStats> {
  try {
    const result = await callExternalService<{
      transactional: BroadcastStatsResponse;
      broadcast: BroadcastStatsResponse;
    }>(
      externalServices.emailGateway,
      "/stats",
      { method: "POST", body: filters }
    );

    return toBroadcastDeliveryStats(result.broadcast);
  } catch {
    return EMPTY_STATS;
  }
}

/** Fetch broadcast delivery stats grouped by workflow name. Returns a map of workflowName → stats. */
async function fetchWorkflowDeliveryStats(appId?: string): Promise<Map<string, DeliveryStats>> {
  try {
    const result = await callExternalService<{
      groups: Array<{ key: string; broadcast: BroadcastStatsResponse }>;
    }>(
      externalServices.emailGateway,
      "/stats",
      { method: "POST", body: { ...(appId && { appId }), type: "broadcast", groupBy: "workflowName" } }
    );

    const map = new Map<string, DeliveryStats>();
    for (const group of result.groups || []) {
      if (group.key) {
        map.set(group.key, toBroadcastDeliveryStats(group.broadcast));
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Stats shape returned by instantly-service POST /stats/grouped. */
interface InstantlyGroupStats {
  emailsSent: number;
  emailsDelivered: number;
  emailsOpened: number;
  emailsClicked: number;
  emailsReplied: number;
  emailsBounced: number;
  repliesAutoReply: number;
  repliesNotInterested: number;
  repliesOutOfOffice: number;
  repliesUnsubscribe: number;
}

/** Fetch run IDs grouped by workflow name across all orgs from runs-service. */
async function fetchRunIdsByWorkflow(orgIds: string[], appId?: string): Promise<Record<string, string[]>> {
  if (!appId || orgIds.length === 0) return {};

  const merged: Record<string, string[]> = {};

  await Promise.all(
    orgIds.map(async (orgId) => {
      try {
        const result = await callExternalService<{ groups: Record<string, string[]> }>(
          externalServices.runs,
          `/v1/stats/run-ids-by-workflow?orgId=${encodeURIComponent(orgId)}&appId=${encodeURIComponent(appId)}`
        );
        for (const [workflowName, runIds] of Object.entries(result.groups || {})) {
          if (!merged[workflowName]) merged[workflowName] = [];
          merged[workflowName].push(...runIds);
        }
      } catch {
        // Ignore per-org failures
      }
    })
  );

  return merged;
}

/** Fetch grouped stats from instantly-service via POST /stats/grouped. */
async function fetchInstantlyGroupedStats(
  runIdsByWorkflow: Record<string, string[]>
): Promise<Map<string, { stats: DeliveryStats; recipients: number }>> {
  const groups: Record<string, { runIds: string[] }> = {};
  for (const [workflowName, runIds] of Object.entries(runIdsByWorkflow)) {
    if (runIds.length > 0) {
      groups[workflowName] = { runIds };
    }
  }

  if (Object.keys(groups).length === 0) return new Map();

  try {
    const result = await callExternalService<{
      groups: Array<{
        key: string;
        stats: InstantlyGroupStats;
        recipients: number;
      }>;
    }>(
      externalServices.instantly,
      "/stats/grouped",
      { method: "POST", body: { groups } }
    );

    const map = new Map<string, { stats: DeliveryStats; recipients: number }>();
    for (const group of result.groups || []) {
      if (group.key) {
        map.set(group.key, {
          stats: {
            emailsSent: group.stats.emailsSent || 0,
            emailsOpened: group.stats.emailsOpened || 0,
            emailsClicked: group.stats.emailsClicked || 0,
            emailsReplied: group.stats.emailsReplied || 0,
            emailsBounced: group.stats.emailsBounced || 0,
            repliesInterested: group.stats.emailsReplied || 0, // emailsReplied IS positive replies
          },
          recipients: group.recipients || 0,
        });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function applyStatsToBrand(brand: BrandEntry, stats: DeliveryStats) {
  brand.emailsSent = stats.emailsSent;
  brand.emailsOpened = stats.emailsOpened;
  brand.emailsClicked = stats.emailsClicked;
  brand.emailsReplied = stats.emailsReplied;

  const sent = stats.emailsSent;
  brand.openRate = sent > 0 ? Math.round((stats.emailsOpened / sent) * 10000) / 10000 : 0;
  brand.clickRate = sent > 0 ? Math.round((stats.emailsClicked / sent) * 10000) / 10000 : 0;
  brand.replyRate = sent > 0 ? Math.round((stats.emailsReplied / sent) * 10000) / 10000 : 0;

  const cost = brand.totalCostUsdCents;
  brand.costPerOpenCents = stats.emailsOpened > 0 ? Math.round(cost / stats.emailsOpened) : null;
  brand.costPerClickCents = stats.emailsClicked > 0 ? Math.round(cost / stats.emailsClicked) : null;
  brand.costPerReplyCents = stats.emailsReplied > 0 ? Math.round(cost / stats.emailsReplied) : null;
}

function applyStatsToWorkflow(wf: WorkflowEntry, stats: DeliveryStats) {
  wf.emailsSent = stats.emailsSent;
  wf.emailsOpened = stats.emailsOpened;
  wf.emailsClicked = stats.emailsClicked;
  wf.emailsReplied = stats.emailsReplied;
  wf.repliesInterested = stats.repliesInterested;

  const sent = stats.emailsSent;
  wf.openRate = sent > 0 ? Math.round((stats.emailsOpened / sent) * 10000) / 10000 : 0;
  wf.clickRate = sent > 0 ? Math.round((stats.emailsClicked / sent) * 10000) / 10000 : 0;
  wf.replyRate = sent > 0 ? Math.round((stats.emailsReplied / sent) * 10000) / 10000 : 0;
  wf.interestedRate = sent > 0 ? Math.round((stats.repliesInterested / sent) * 10000) / 10000 : 0;

  const cost = wf.totalCostUsdCents;
  wf.costPerOpenCents = stats.emailsOpened > 0 ? Math.round(cost / stats.emailsOpened) : null;
  wf.costPerClickCents = stats.emailsClicked > 0 ? Math.round(cost / stats.emailsClicked) : null;
  wf.costPerReplyCents = stats.emailsReplied > 0 ? Math.round(cost / stats.emailsReplied) : null;
}

/**
 * Enrich leaderboard with delivery stats.
 * Brands: email-gateway (broadcast stats by brandId).
 * Workflows: instantly-service via run-ids-by-workflow → POST /stats/grouped,
 *   with email-gateway groupBy as fallback, then proportional distribution.
 */
async function enrichWithDeliveryStats(data: LeaderboardData, orgIds: string[], appId?: string): Promise<void> {
  // Fetch per-brand stats (email-gateway) + workflow stats (instantly-service) in parallel
  const [, instantlyResults] = await Promise.all([
    // Per-brand stats (email-gateway, unchanged)
    Promise.all(
      data.brands.map(async (brand) => {
        if (!brand.brandId) return;
        const stats = await fetchBroadcastDeliveryStats({ brandId: brand.brandId, ...(appId && { appId }) });
        if (stats.emailsSent === 0) return;
        applyStatsToBrand(brand, stats);
      })
    ),
    // Workflow stats via instantly-service (run-ids-by-workflow → POST /stats/grouped)
    (async () => {
      const runIdsByWorkflow = await fetchRunIdsByWorkflow(orgIds, appId);
      return fetchInstantlyGroupedStats(runIdsByWorkflow);
    })(),
  ]);

  // Apply instantly-service stats to workflows
  let anyWorkflowEnriched = false;
  for (const wf of data.workflows) {
    const result = instantlyResults.get(wf.workflowName);
    if (result && result.stats.emailsSent > 0) {
      applyStatsToWorkflow(wf, result.stats);
      wf.recipients = result.recipients;
      anyWorkflowEnriched = true;
    }
  }

  // Fallback 1: email-gateway groupBy (for workflows not covered by instantly)
  if (!anyWorkflowEnriched && data.workflows.length > 0) {
    const workflowStatsMap = await fetchWorkflowDeliveryStats(appId);
    for (const wf of data.workflows) {
      const stats = workflowStatsMap.get(wf.workflowName);
      if (stats && stats.emailsSent > 0) {
        applyStatsToWorkflow(wf, stats);
        anyWorkflowEnriched = true;
      }
    }
  }

  // Fallback 2: proportional distribution from aggregate email-gateway stats
  if (!anyWorkflowEnriched && data.workflows.length > 0) {
    const aggregateStats = await fetchBroadcastDeliveryStats(appId ? { appId } : {});
    if (aggregateStats.emailsSent > 0) {
      const totalCost = data.workflows.reduce((s, w) => s + w.totalCostUsdCents, 0);
      if (totalCost > 0) {
        for (const wf of data.workflows) {
          const share = wf.totalCostUsdCents / totalCost;
          const distributed: DeliveryStats = {
            emailsSent: Math.round(aggregateStats.emailsSent * share),
            emailsOpened: Math.round(aggregateStats.emailsOpened * share),
            emailsClicked: Math.round(aggregateStats.emailsClicked * share),
            emailsReplied: Math.round(aggregateStats.emailsReplied * share),
            emailsBounced: Math.round(aggregateStats.emailsBounced * share),
            repliesInterested: Math.round(aggregateStats.repliesInterested * share),
          };
          if (distributed.emailsSent > 0) {
            applyStatsToWorkflow(wf, distributed);
          }
        }
      }
    }
  }


  // Recompute hero stats: best $/open and $/reply across brands
  const brandsWithCostPerOpen = data.brands.filter((b) => b.costPerOpenCents !== null && b.costPerOpenCents > 0);
  const brandsWithCostPerReply = data.brands.filter((b) => b.costPerReplyCents !== null && b.costPerReplyCents > 0);

  if (brandsWithCostPerOpen.length > 0 || brandsWithCostPerReply.length > 0) {
    const bestOpen = brandsWithCostPerOpen.length > 0
      ? brandsWithCostPerOpen.reduce((a, b) => (a.costPerOpenCents! < b.costPerOpenCents! ? a : b))
      : null;
    const bestReply = brandsWithCostPerReply.length > 0
      ? brandsWithCostPerReply.reduce((a, b) => (a.costPerReplyCents! < b.costPerReplyCents! ? a : b))
      : null;

    data.hero = {
      bestCostPerOpen: bestOpen ? { brandDomain: bestOpen.brandDomain, costPerOpenCents: bestOpen.costPerOpenCents! } : null,
      bestCostPerReply: bestReply ? { brandDomain: bestReply.brandDomain, costPerReplyCents: bestReply.costPerReplyCents! } : null,
    };
  }
}

/** Get all brands across all orgs from brand-service.
 *  This is more reliable than /campaigns/list which only returns ongoing campaigns. */
async function fetchAllBrands(): Promise<{
  brands: Array<{ id: string; domain: string | null; name: string | null; brandUrl: string | null }>;
  orgIds: string[];
}> {
  // Get all org IDs from brand-service
  const resp = await callExternalService<{ organization_ids: string[] }>(
    externalServices.brand, "/org-ids"
  );
  const orgIds = resp.organization_ids || [];

  if (orgIds.length === 0) return { brands: [], orgIds: [] };

  // Fetch brands for each org in parallel
  const brandArrays = await Promise.all(
    orgIds.map(async (orgId) => {
      try {
        const { brands } = await callExternalService<{
          brands: Array<{ id: string; domain: string | null; name: string | null; brandUrl: string | null }>;
        }>(externalServices.brand, `/brands?orgId=${encodeURIComponent(orgId)}`);
        return brands || [];
      } catch {
        return [];
      }
    })
  );

  // Deduplicate by brand ID
  const seen = new Set<string>();
  const allBrands: Array<{ id: string; domain: string | null; name: string | null; brandUrl: string | null }> = [];
  for (const arr of brandArrays) {
    for (const b of arr) {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        allBrands.push(b);
      }
    }
  }
  return { brands: allBrands, orgIds };
}

/** Response shape from runs-service /v1/stats/public/leaderboard (costs are strings). */
interface RunsStatsGroup {
  dimensions: Record<string, string>;
  totalCostInUsdCents: string;
  actualCostInUsdCents: string;
  provisionedCostInUsdCents: string;
  cancelledCostInUsdCents: string;
  runCount: number;
}

/** Build leaderboard data from brand-service + runs-service public endpoint.
 *  Uses brand-service for brands, runs-service for costs + workflows. */
async function buildLeaderboardData(appId?: string): Promise<{ data: LeaderboardData; orgIds: string[] }> {
  const appParam = appId ? `appId=${encodeURIComponent(appId)}&` : "";
  // 1. Get brands + workflow stats + brand costs in parallel
  const [{ brands: allBrands, orgIds }, workflowStatsResult, brandCosts] = await Promise.all([
    fetchAllBrands(),
    // Workflow stats from runs-service public endpoint
    callExternalService<{ groups: RunsStatsGroup[] }>(
      externalServices.runs,
      `/v1/stats/public/leaderboard?${appParam}groupBy=workflowName`
    ).catch((err) => {
      console.warn("Failed to fetch workflow stats:", err);
      return { groups: [] as RunsStatsGroup[] };
    }),
    // Brand costs from runs-service public endpoint
    callExternalService<{ groups: RunsStatsGroup[] }>(
      externalServices.runs,
      `/v1/stats/public/leaderboard?${appParam}groupBy=brandId`
    ).then((result) => {
      const costMap = new Map<string, number>();
      for (const g of result.groups || []) {
        if (g.dimensions.brandId) {
          costMap.set(g.dimensions.brandId, Math.round(parseFloat(g.actualCostInUsdCents) || 0));
        }
      }
      return costMap;
    }).catch((err) => {
      console.warn("Failed to fetch costs from runs-service:", err);
      return new Map<string, number>();
    }),
  ]);

  // 2. Build brand entries from brand-service data
  const brands: BrandEntry[] = allBrands.map((b) => ({
    brandId: b.id,
    brandUrl: b.brandUrl,
    brandDomain: b.domain,
    totalCostUsdCents: brandCosts.get(b.id) || 0,
    emailsSent: 0, emailsOpened: 0, emailsClicked: 0, emailsReplied: 0,
    openRate: 0, clickRate: 0, replyRate: 0,
    costPerOpenCents: null, costPerClickCents: null, costPerReplyCents: null,
  }));

  // 3. Build workflow entries directly from runs-service data (no proportional distribution)
  const workflows: WorkflowEntry[] = (workflowStatsResult.groups || []).map((g) => {
      const name = g.dimensions.workflowName || "unknown";
      return {
        workflowName: name,
        displayName: getWorkflowDisplayName(name),
        signatureName: getSignatureName(name),
        category: getWorkflowCategory(name),
        sectionKey: getSectionKey(name),
        runCount: g.runCount || 0,
        totalCostUsdCents: Math.round(parseFloat(g.actualCostInUsdCents) || 0),
        emailsSent: 0, emailsOpened: 0, emailsClicked: 0, emailsReplied: 0, repliesInterested: 0, recipients: 0,
        openRate: 0, clickRate: 0, replyRate: 0, interestedRate: 0,
        costPerOpenCents: null, costPerClickCents: null, costPerReplyCents: null,
      };
    });

  const availableCategories = [...new Set(
    workflows.map((w) => w.category).filter((c): c is WorkflowCategory => c !== null)
  )];

  return {
    data: { brands, workflows, hero: null, updatedAt: new Date().toISOString(), availableCategories, categorySections: [] },
    orgIds,
  };
}

/** Build per-section groups with aggregated stats from their workflows.
 *  Groups by sectionKey ({category}-{channel}-{audienceType}) instead of just category. */
function buildCategorySections(data: LeaderboardData): CategorySection[] {
  const sectionMap = new Map<string, WorkflowEntry[]>();

  for (const wf of data.workflows) {
    const key = wf.sectionKey;
    if (!key) continue;
    const list = sectionMap.get(key) || [];
    list.push(wf);
    sectionMap.set(key, list);
  }

  return [...sectionMap.entries()].map(([sectionKey, workflows]) => {
    const emailsSent = workflows.reduce((s, w) => s + w.emailsSent, 0);
    const emailsOpened = workflows.reduce((s, w) => s + w.emailsOpened, 0);
    const emailsReplied = workflows.reduce((s, w) => s + w.emailsReplied, 0);
    const repliesInterested = workflows.reduce((s, w) => s + w.repliesInterested, 0);
    const recipients = workflows.reduce((s, w) => s + w.recipients, 0);
    const totalCostUsdCents = workflows.reduce((s, w) => s + w.totalCostUsdCents, 0);
    // Derive category from the first workflow (all workflows in same section share the same category)
    const category = workflows[0].category!;
    const label = SECTION_LABELS[sectionKey] || sectionKey.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    return {
      category,
      sectionKey,
      label,
      stats: {
        emailsSent,
        emailsOpened,
        emailsReplied,
        repliesInterested,
        recipients,
        totalCostUsdCents,
        openRate: emailsSent > 0 ? Math.round((emailsOpened / emailsSent) * 10000) / 10000 : 0,
        replyRate: emailsSent > 0 ? Math.round((emailsReplied / emailsSent) * 10000) / 10000 : 0,
        interestedRate: emailsSent > 0 ? Math.round((repliesInterested / emailsSent) * 10000) / 10000 : 0,
        costPerOpenCents: emailsOpened > 0 ? Math.round(totalCostUsdCents / emailsOpened) : null,
        costPerReplyCents: emailsReplied > 0 ? Math.round(totalCostUsdCents / emailsReplied) : null,
      },
      workflows,
      brands: data.brands, // All brands for now — no per-section brand filtering yet
    };
  });
}

// Authenticated route — appId is an optional filter
router.get("/performance/leaderboard", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const appId = req.query.appId as string | undefined;

    const { data, orgIds } = await buildLeaderboardData(appId);

    // Enrich with delivery stats (instantly-service for workflows, email-gateway for brands)
    try {
      await enrichWithDeliveryStats(data, orgIds, appId);
    } catch (err) {
      console.warn("Failed to enrich leaderboard with delivery stats:", err);
    }

    // Filter out brands with no activity (no cost and no emails sent)
    data.brands = data.brands.filter(
      (b) => b.totalCostUsdCents > 0 || b.emailsSent > 0
    );

    // Build per-category sections after enrichment so email stats are included
    data.categorySections = buildCategorySections(data);

    res.json(data);
  } catch (error) {
    console.error("Performance leaderboard build error:", error);
    res.status(502).json({ error: "Failed to build leaderboard data" });
  }
});

export default router;
