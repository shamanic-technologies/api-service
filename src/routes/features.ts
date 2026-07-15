import { Router, Request, Response } from "express";
import { authenticate, authenticatePlatform, requireOrg, requireUser, requireStaff, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildParams(query: Record<string, unknown>, keys: string[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) {
    if (query[key]) params.set(key, query[key] as string);
  }
  return params;
}

const PUBLIC_RANKED_PARAMS = ["featureSlug", "objective", "groupBy", "limit"];
const PUBLIC_BEST_PARAMS = ["featureSlug", "groupBy"];
const PUBLIC_REVENUE_PARAMS = ["featureSlug", "groupBy"];
const PUBLIC_WORKFLOW_ENGAGEMENT_LATENCY_PARAMS = ["featureSlug", "groupBy"];
const PUBLIC_COST_PROJECTION_PARAMS = ["featureSlug"];
const PUBLIC_COST_PER_OUTCOME_TREND_PARAMS = ["featureSlug", "objective", "days", "windowOutcomes"];
const PUBLIC_WORKFLOW_COST_PER_OUTCOME_PARAMS = ["featureSlug", "objective"];
const PUBLIC_COST_PER_OUTCOME_LIFETIME_PARAMS = ["featureSlug"];
const PUBLIC_COST_PER_OUTCOME_DISTRIBUTION_PARAMS = ["featureSlug", "objective", "buckets"];
const AUDIT_SEND_FORECAST_PARAMS = ["days"];
const AUDIT_ACTIVE_USERS_PARAMS = ["days", "weeks", "months"];

// Forward the verified staff email downstream for actor attribution (no org context).
function staffHeaders(req: AuthenticatedRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  if (req.staffEmail) headers["x-email"] = req.staffEmail;
  return headers;
}

// ── Public routes (no auth) ─────────────────────────────────────────────────

/**
 * GET /v1/public/features/ranked
 * Public ranked workflows by performance. Proxied to features-service GET /public/stats/ranked.
 */
router.get("/public/features/ranked", async (req: Request, res: Response) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, PUBLIC_RANKED_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/public/stats/ranked?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public ranked features error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public ranked features" });
  }
});

/**
 * GET /v1/public/features/best
 * Public hero records — best cost-per-outcome. Proxied to features-service GET /public/stats/best.
 */
router.get("/public/features/best", async (req: Request, res: Response) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, PUBLIC_BEST_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/public/stats/best?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public best features error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public best features" });
  }
});

/**
 * GET /v1/public/features/revenue
 * Public expected-pipeline revenue and ROI grouped by brand or workflow.
 * Proxied to features-service GET /public/stats/revenue.
 */
router.get("/public/features/revenue", async (req: Request, res: Response) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, PUBLIC_REVENUE_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/public/stats/revenue?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public feature revenue error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public feature revenue" });
  }
});

/**
 * GET /v1/public/features/workflow-engagement-latency
 * Public average/median engagement latency grouped by workflow.
 * Proxied to features-service GET /public/stats/workflow-engagement-latency.
 */
router.get("/public/features/workflow-engagement-latency", async (req: Request, res: Response) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, PUBLIC_WORKFLOW_ENGAGEMENT_LATENCY_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/public/stats/workflow-engagement-latency?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public workflow engagement latency error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public workflow engagement latency" });
  }
});

/**
 * GET /v1/public/features/cost-projection
 * Public feature-wide expected cost per meeting-booked and per purchase.
 * Proxied to features-service GET /public/stats/cost-projection.
 */
router.get("/public/features/cost-projection", async (req: Request, res: Response) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, PUBLIC_COST_PROJECTION_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/public/stats/cost-projection?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public feature cost projection error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public feature cost projection" });
  }
});

/**
 * GET /v1/public/features/cost-per-outcome-trend
 * Public dated moving-average cost-per-outcome series for one objective.
 * Proxied to features-service GET /public/stats/cost-per-outcome-trend.
 */
router.get("/public/features/cost-per-outcome-trend", async (req: Request, res: Response) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, PUBLIC_COST_PER_OUTCOME_TREND_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/public/stats/cost-per-outcome-trend?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public cost-per-outcome trend error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public cost-per-outcome trend" });
  }
});

/**
 * GET /v1/public/features/workflow-cost-per-outcome
 * Public per-workflow cross-org cost-per-outcome ratio for one objective.
 * Proxied to features-service GET /public/stats/workflow-cost-per-outcome.
 */
router.get("/public/features/workflow-cost-per-outcome", async (req: Request, res: Response) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, PUBLIC_WORKFLOW_COST_PER_OUTCOME_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/public/stats/workflow-cost-per-outcome?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public workflow cost-per-outcome error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public workflow cost-per-outcome" });
  }
});

/**
 * GET /v1/public/features/cost-per-outcome-lifetime
 * Public lifetime (all-history) cross-org average cost-per-outcome across all objectives for a feature.
 * Proxied to features-service GET /public/stats/cost-per-outcome-lifetime.
 */
router.get("/public/features/cost-per-outcome-lifetime", async (req: Request, res: Response) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, PUBLIC_COST_PER_OUTCOME_LIFETIME_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/public/stats/cost-per-outcome-lifetime?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public cost-per-outcome lifetime error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public cost-per-outcome lifetime" });
  }
});

/**
 * GET /v1/public/features/cost-per-outcome-distribution
 * Public cross-org distribution (histogram + spread) of cost-per-outcome across brands for one objective.
 * Proxied to features-service GET /public/stats/cost-per-outcome-distribution.
 */
router.get("/public/features/cost-per-outcome-distribution", async (req: Request, res: Response) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, PUBLIC_COST_PER_OUTCOME_DISTRIBUTION_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/public/stats/cost-per-outcome-distribution?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public cost-per-outcome distribution error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public cost-per-outcome distribution" });
  }
});

/**
 * GET /public/features
 * List active features with display-safe fields (public, no auth).
 * Designed for landing pages and public-facing UIs.
 */
router.get("/public/features", async (req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      "/public/features",
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public features list error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list public features" });
  }
});

// ── Authenticated routes (mounted at /v1) ────────────────────────────────────

/**
 * GET /v1/features
 * List features with optional filters
 */
router.get("/features", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["status"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/features${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("List features error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list features" });
  }
});

/**
 * GET /v1/features/entities/registry
 * Entity type registry — label, icon, pathSuffix, description per type.
 */
router.get("/features/entities/registry", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      "/entities/registry",
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Entities registry error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get entities registry" });
  }
});

/**
 * GET /v1/features/stats/registry
 * Public dictionary of stats keys (label + type per key)
 */
router.get("/features/stats/registry", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      "/stats/registry",
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Stats registry error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get stats registry" });
  }
});

/**
 * GET /v1/features/stats
 * Global stats cross-features, groupable by featureSlug/workflowSlug/brandId/campaignId
 */
router.get("/features/stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["groupBy", "brandId", "campaignId", "featureSlug", "workflowSlug", "featureDynastySlug", "workflowDynastySlug"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/stats${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Global stats error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get global stats" });
  }
});

/**
 * POST /v1/features/:slug/prefill
 * Prefill feature form using brand data. Called by dashboard for "New Campaign".
 */
router.post("/features/:slug/prefill", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { brandIds, ...restBody } = req.body as { brandIds?: string[]; [k: string]: unknown };
    if (!brandIds || !Array.isArray(brandIds) || brandIds.length === 0) {
      return res.status(400).json({ error: "brandIds (non-empty string array) is required in the request body" });
    }

    const format = req.query.format;
    const qs = format ? `?format=${encodeURIComponent(format as string)}` : "";
    const headers: Record<string, string> = {
      ...buildInternalHeaders(req),
      "x-brand-id": brandIds.join(","),
    };
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}/prefill${qs}`,
      {
        method: "POST",
        headers,
        body: restBody,
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Prefill feature error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to prefill feature" });
  }
});

/**
 * GET /v1/features/audit/send-forecast
 * STAFF-ONLY fleet-wide, cross-org projection of outreach emails SENT per calendar day over a
 * past+future window, plus a fleet budget summary (total daily budget across all brands, remaining
 * budget today, active brand count). The summary carries cross-org fleet financials, so this is
 * gated by authenticatePlatform + requireStaff (same tier as GET /v1/instantly/audit/*): the caller
 * must come in via the platform API key (authType "admin") AND carry an x-email in the STAFF_EMAILS
 * allowlist. No org context (cross-org read). Forwards optional `days` (1..90). Transparent proxy to
 * features-service GET /internal/stats/send-forecast; response owned by the downstream service.
 */
router.get("/features/audit/send-forecast", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, AUDIT_SEND_FORECAST_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/internal/stats/send-forecast?${params}`,
      { headers: staffHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Staff send forecast error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get send forecast" });
  }
});

/**
 * GET /v1/features/audit/accounts
 * STAFF-ONLY cross-org listing of customer accounts plus fleet financial stats (total daily budget,
 * MRR, ARR). Cross-org fleet financials, so gated by authenticatePlatform + requireStaff (same tier
 * as GET /v1/features/audit/send-forecast): the caller must come in via the platform API key
 * (authType "admin") AND carry an x-email in the STAFF_EMAILS allowlist. No org context (cross-org
 * read), no query params. Transparent proxy to features-service GET /internal/stats/accounts;
 * response (rows + stats + asOf) owned by the downstream service.
 */
router.get("/features/audit/accounts", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      `/internal/stats/accounts`,
      { headers: staffHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Staff accounts audit error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get accounts" });
  }
});

/**
 * GET /v1/features/audit/active-users
 * STAFF-ONLY cross-org, fleet-wide HISTORY of active users (distinct orgs with an active, funded,
 * non-paused cold-email brand) bucketed monthly/weekly/daily with period-over-period growth, plus the
 * current live total. Aggregate cross-org fleet data, so gated by authenticatePlatform + requireStaff
 * (same tier as GET /v1/features/audit/send-forecast and /v1/features/audit/accounts): the caller must
 * come in via the platform API key (authType "admin") AND carry an x-email in the STAFF_EMAILS
 * allowlist. No org context (cross-org read). Forwards optional window params `days`/`weeks`/`months`.
 * Transparent proxy to features-service GET /internal/stats/active-users; response
 * (currentTotal + monthly/weekly/daily + asOf) owned by the downstream service.
 */
router.get("/features/audit/active-users", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, AUDIT_ACTIVE_USERS_PARAMS);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/internal/stats/active-users${qs}`,
      { headers: staffHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Staff active-users audit error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get active users" });
  }
});

/**
 * GET /v1/features/audit/active-users-by-user
 * STAFF-ONLY cross-org, fleet-wide PER-USER active history: for each user (a distinct org with an
 * active, funded, non-paused cold-email brand), that user's active months/weeks/days, first/last
 * active month+week, retention window in weeks, and current-week/current-month active flags. This is
 * the per-user companion to GET /v1/features/audit/active-users (the aggregate history). Cross-org
 * fleet data (per-org rows), so gated by authenticatePlatform + requireStaff (same tier as
 * GET /v1/features/audit/accounts): the caller must come in via the platform API key (authType
 * "admin") AND carry an x-email in the STAFF_EMAILS allowlist. No org context (cross-org read), no
 * query params. Transparent proxy to features-service GET /internal/stats/active-users-by-user;
 * response owned by the downstream service.
 */
router.get("/features/audit/active-users-by-user", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      `/internal/stats/active-users-by-user`,
      { headers: staffHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Staff active-users-by-user audit error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get active users by user" });
  }
});

/**
 * GET /v1/features/audit/revenue
 * STAFF-ONLY cross-org, fleet-wide HISTORY of realized revenue (summed actualized cold-email spend
 * across all orgs) bucketed monthly/weekly/daily with period-over-period growth, plus the total since
 * inception, a per-day-since-inception MRR-over-time line, and the current live MRR. The realized-revenue
 * companion to GET /v1/features/audit/active-users (same universe, same "active = real billed cold-email
 * spend" signal). Aggregate cross-org fleet financials, so gated by authenticatePlatform + requireStaff
 * (same tier as GET /v1/features/audit/active-users): the caller must come in via the platform API key
 * (authType "admin") AND carry an x-email in the STAFF_EMAILS allowlist. No org context (cross-org read).
 * Forwards optional window params `days`/`weeks`/`months`. Transparent proxy to features-service
 * GET /internal/stats/revenue; response owned by the downstream service.
 */
router.get("/features/audit/revenue", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, AUDIT_ACTIVE_USERS_PARAMS);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/internal/stats/revenue${qs}`,
      { headers: staffHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Staff revenue audit error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get revenue" });
  }
});

/**
 * GET /v1/features/:slug/pipeline-activity
 * 7-day pipeline activity for a brand. Proxied to features-service GET /features/:slug/pipeline-activity.
 */
router.get("/features/:slug/pipeline-activity", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["brandId", "days", "timezone"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}/pipeline-activity${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Feature pipeline-activity error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get feature pipeline activity" });
  }
});

/**
 * GET /v1/features/:slug
 * Get a single feature by slug
 */
router.get("/features/:slug", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get feature error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get feature" });
  }
});

/**
 * GET /v1/features/:slug/stats
 * Stats for a specific feature, groupable by workflowSlug/brandId/campaignId
 */
router.get("/features/:slug/stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["groupBy", "brandId", "campaignId", "workflowSlug", "workflowDynastySlug"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}/stats${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Feature stats error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get feature stats" });
  }
});

/**
 * GET /v1/features/:slug/revenue
 * Expected-pipeline-revenue overview for a specific feature, scoped by brandId (+ optional campaignId).
 */
router.get("/features/:slug/revenue", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["brandId", "campaignId", "workflowSlug", "groupBy", "lens", "pricing"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}/revenue${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Feature revenue error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get feature revenue" });
  }
});

/**
 * GET /v1/features/:slug/audience-stats
 * Audience-level cost and outcome evidence for a feature, scoped by brandId and goal.
 */
router.get("/features/:slug/audience-stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["brandId", "goal", "brandProfileId", "limit", "statuses", "pricing"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}/audience-stats${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Feature audience-stats error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get feature audience stats" });
  }
});

/**
 * GET /v1/features/:slug/workflow-projection
 * Serves a 3-grain (crossOrg → brand → audience) cost-per-outcome projection ladder + a
 * resolved pick, keyed per (audienceId?, workflowDynasty). Scoped by brandId; goal/objective
 * select the outcome metric; audienceId/budgetUsd are optional context. Forwards ALL query
 * params (brandId, goal, objective, audienceId, budgetUsd, …) transparently to features-service
 * GET /features/:slug/workflow-projection — passthrough response.
 */
router.get("/features/:slug/workflow-projection", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") params.set(key, value);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}/workflow-projection${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Feature workflow-projection error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get feature workflow projection" });
  }
});

export default router;
