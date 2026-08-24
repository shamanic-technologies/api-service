import { Router, Request, Response } from "express";
import { authenticate, authenticatePlatform, requireOrg, requireUser, requireStaff, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

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
const PUBLIC_BEST_MODEL_COST_PER_OUTCOME_TREND_PARAMS = ["featureSlug", "objective", "days", "windowOutcomes"];
const PUBLIC_WORKFLOW_COST_PER_OUTCOME_PARAMS = ["featureSlug", "objective"];
const PUBLIC_COST_PER_OUTCOME_LIFETIME_PARAMS = ["featureSlug"];
const PUBLIC_COST_PER_OUTCOME_DISTRIBUTION_PARAMS = ["featureSlug", "objective", "buckets"];
const AUDIT_SEND_FORECAST_PARAMS = ["days"];
const AUDIT_ACTIVE_USERS_PARAMS = ["days", "weeks", "months"];
const AUDIT_REVENUE_PARAMS = ["days", "weeks", "months"];

// The caller's query string, byte-identical. Read off req.originalUrl rather than
// re-serialized from req.query so repeated keys, ordering and the caller's own
// percent-encoding survive, and a parameter features-service ships next needs no
// edit here (CLAUDE.md #11).
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

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
 * GET /v1/public/features/best-model-cost-per-outcome-trend
 * Public dated cost-per-outcome trend of the single BEST cross-org workflow model for one objective.
 * Proxied to features-service GET /public/stats/best-model-cost-per-outcome-trend.
 */
router.get("/public/features/best-model-cost-per-outcome-trend", async (req: Request, res: Response) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, PUBLIC_BEST_MODEL_COST_PER_OUTCOME_TREND_PARAMS);
    const result = await callExternalService(
      externalServices.features,
      `/public/stats/best-model-cost-per-outcome-trend?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public best-model cost-per-outcome trend error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public best-model cost-per-outcome trend" });
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
 * GET /v1/public/channels
 * The acquisition-channel catalogue: every channel a customer can book, its
 * commercial terms, the kinds of step it can produce and the sales funnels that
 * follow. Proxied to features-service GET /public/channels.
 *
 * No identity of any kind: the marketing site is generated from this read and
 * its visitor is anonymous. The caller's query string is forwarded verbatim.
 */
router.get("/public/channels", async (req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      `/public/channels${rawQueryString(req.originalUrl)}`,
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public channel catalogue error:", error.message);
    respondUpstreamError(res, error, "Failed to get the public channel catalogue");
  }
});

/**
 * GET /v1/public/channel-funnel-economics
 * Measured economics per (sales funnel, acquisition channel) pair, or the
 * explicit not-enough-data answer naming the missing ingredient.
 * Proxied to features-service GET /public/channel-funnel-economics.
 *
 * Public by design at the producer, so no identity here either. The query is
 * forwarded verbatim — the site's pages are parameterised by channel, and a
 * stripped channelSlug would render the whole catalogue with no error anywhere.
 */
router.get("/public/channel-funnel-economics", async (req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      `/public/channel-funnel-economics${rawQueryString(req.originalUrl)}`,
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public channel-funnel economics error:", error.message);
    respondUpstreamError(res, error, "Failed to get the public channel-funnel economics");
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
 * STAFF-ONLY cross-org, fleet-wide HISTORY of REALIZED REVENUE (the sum of actualized cold-email spend
 * per day — the money twin of active-users): total revenue since inception, plus monthly/weekly/daily
 * revenue buckets each with period-over-period growth, and current MRR. Aggregate cross-org fleet
 * financials, so gated by authenticatePlatform + requireStaff (same tier as GET /v1/features/audit/
 * active-users): the caller must come in via the platform API key (authType "admin") AND carry an
 * x-email in the STAFF_EMAILS allowlist. No org context (cross-org read). Forwards optional window
 * params `days`/`weeks`/`months`. Transparent proxy to features-service GET /internal/stats/revenue;
 * response owned by the downstream service.
 */
router.get("/features/audit/revenue", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    const params = buildParams(req.query as Record<string, unknown>, AUDIT_REVENUE_PARAMS);
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
 * GET /v1/features/audit/customer-success
 * STAFF-ONLY cross-org, fleet-wide CUSTOMER-SUCCESS health board: one composed row per ever-active
 * customer (name, CAC, grain, and the rest of the health signals the downstream computes). Cross-org
 * fleet data (per-customer rows), so gated by authenticatePlatform + requireStaff (same tier as
 * GET /v1/features/audit/active-users-by-user): the caller must come in via the platform API key
 * (authType "admin") AND carry an x-email in the STAFF_EMAILS allowlist. No org context (cross-org
 * read), no query params. Transparent proxy to features-service GET /internal/stats/customer-health;
 * response owned by the downstream service.
 */
router.get("/features/audit/customer-success", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      `/internal/stats/customer-health`,
      { headers: staffHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Staff customer-success audit error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get customer success" });
  }
});

/**
 * GET /v1/features/:slug/pipeline-activity
 * 7-day pipeline activity for a brand. Forwards ALL query params (brandId, days, timezone,
 * pricing, …) transparently to features-service GET /features/:slug/pipeline-activity —
 * no whitelist, so a new downstream param needs no api-service edit.
 */
router.get("/features/:slug/pipeline-activity", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") params.set(key, value);
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
 * Stats for a specific feature, groupable by workflowSlug/brandId/campaignId. Forwards ALL
 * query params (groupBy, brandId, campaignId, workflowSlug, workflowDynastySlug, pricing, …)
 * transparently to features-service GET /features/:slug/stats — no whitelist, so a new
 * downstream param needs no api-service edit.
 */
router.get("/features/:slug/stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") params.set(key, value);
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
 * Expected-pipeline-revenue overview for a specific feature, scoped by brandId
 * (+ optional campaignId / offerId), grouped by campaign, workflow or offer.
 *
 * Forwards ALL query params transparently to features-service
 * GET /features/:slug/revenue — no whitelist, so a new downstream param needs no
 * api-service edit and can never be silently dropped.
 *
 * This USED to re-declare a closed list, which is the gateway-strips-a-field bug
 * (CLAUDE.md #8: the gateway does not own downstream shapes). It cost real
 * coverage rather than being hypothetical: `funnel` had already shipped
 * downstream and never reached it, and `offerId` would have been the second.
 * Widening the list by one name each time reproduces the bug with extra steps —
 * the fix is to stop declaring one.
 */
router.get("/features/:slug/revenue", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") params.set(key, value);
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
 * Audience-level cost and outcome evidence for a feature, scoped by brandId and
 * goal (+ optional campaignId / offerId).
 *
 * Forwards ALL query params transparently, for the same reason as the revenue
 * route above: a closed list here silently dropped `funnel` and would have
 * dropped `offerId`, and the gateway does not own downstream shapes.
 */
router.get("/features/:slug/audience-stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") params.set(key, value);
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

/**
 * GET /v1/features/:slug/goal-arbitration
 * The goal features-service elects for a brand out of the sales funnels that brand
 * declared — the same arbitration campaign-service reads service-to-service, so the
 * dashboard can show the goal that actually runs instead of the brand's stored
 * optimizationGoal. Scoped by brandId; `pricing` selects the gross/net basis.
 *
 * Forwards ALL query params transparently to features-service
 * GET /features/:slug/goal-arbitration — no whitelist, so a new downstream param
 * needs no api-service edit, and `pricing` can never be silently dropped.
 *
 * Errors go through respondUpstreamError so the upstream STATUS and BODY both
 * survive the hop (CLAUDE.md #7): the consumer branches on the difference between a
 * 502 reason='authorized_goals_unavailable' (this brand never stated a funnel set)
 * and a 200 arbitration.reason='no_authorized_goals' (it stated it sells through
 * none) to decide whether to fall back to the stored brand goal. Flattening either
 * one would erase that distinction.
 */
router.get("/features/:slug/goal-arbitration", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") params.set(key, value);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}/goal-arbitration${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Feature goal-arbitration error:", error.message);
    respondUpstreamError(res, error, "Failed to get feature goal arbitration");
  }
});

// ── Offer grain ──────────────────────────────────────────────────────────────

/**
 * GET /v1/offers/:offerId/{revenue,audience-stats,pipeline-activity}
 *
 * The three sibling reads above, one grain up. A brand sells ONE offer through
 * SEVERAL acquisition channels at once, and each of the per-feature reads answers
 * for exactly one of them — so an offer screen built on them describes whichever
 * channel it happened to ask, and understates the offer by whatever the others
 * did. features-service now answers at the offer grain directly, with the
 * per-channel breakdown on the same body, and these are the way in.
 *
 * Proxied verbatim to features-service GET /offers/{offerId}/<suffix>, same
 * identity and same org scoping as the per-feature reads beside them: an offer is
 * the customer's own, on the customer's own brand.
 *
 * Nothing is combined here. Most figures at this grain do NOT add — a lead worked
 * through two channels is one lead, and a ratio of sums is not a sum of ratios —
 * which is exactly why the grain exists downstream (CLAUDE.md #2).
 *
 * The WHOLE query is forwarded off req.originalUrl (CLAUDE.md #11): brandId,
 * funnel, goal, statuses, limit, days, timezone, pricing and whatever
 * features-service ships next all reach it, and a value it rejects comes back as
 * its own 400 rather than a gateway-invented one. A re-declared subset here is
 * the bug this file was cleaned of in #845 — `funnel` had already shipped
 * downstream and never arrived.
 */
const OFFER_ROUTES = [
  { suffix: "revenue", what: "offer revenue" },
  { suffix: "audience-stats", what: "offer audience stats" },
  { suffix: "pipeline-activity", what: "offer pipeline activity" },
] as const;

// ── Brand grain ──────────────────────────────────────────────────────────────

/**
 * GET /v1/brands/:brandId/{revenue,audience-stats,pipeline-activity}
 *
 * The offer grain above, one level further up. A brand holds several offers and
 * each of those runs several channels, so a brand screen built on a per-feature
 * read describes whichever channel it happened to ask. It shows up as a fraction
 * with two grains in it — one channel's spend over billing's brand-wide ceiling,
 * which read `$40 / 50` for a brand whose two channels had spent $40.07 and
 * $10.32 against their own $40 and $10. Both halves real, about different things.
 *
 * A brand's answer is NOT the sum of its offers' and NOT the sum of its channels'.
 * features-service owns how those parts combine — money adds because a run belongs
 * to one channel; people do not, because a lead worked through two channels is one
 * lead; no ratio does, because a ratio of sums is neither the sum nor the average
 * of ratios. So nothing is combined here, exactly as nothing is at the offer grain.
 *
 * NOTE ON ORDER: these mount with the rest of this router at `/v1`, AFTER
 * `brandRoutes`. No brand-service proxy claims these three suffixes, so nothing is
 * shadowed — but a future `/brands/:id/<one of these>` added to brand.ts would win,
 * so add there with that in mind.
 *
 * The WHOLE query is forwarded off req.originalUrl (CLAUDE.md #11), same as the
 * offer routes: a value features-service rejects comes back as its own 400 rather
 * than a gateway-invented one, and a field it ships next arrives without a change
 * here. A re-declared subset is the bug this file was cleaned of in #845.
 */
const GRAIN_SUFFIXES = [
  { suffix: "revenue", what: "revenue" },
  { suffix: "audience-stats", what: "audience stats" },
  { suffix: "pipeline-activity", what: "pipeline activity" },
] as const;

for (const { suffix, what } of OFFER_ROUTES) {
  router.get(
    `/offers/:offerId/${suffix}`,
    authenticate,
    requireOrg,
    requireUser,
    async (req: AuthenticatedRequest, res) => {
      try {
        const result = await callExternalService(
          externalServices.features,
          `/offers/${encodeURIComponent(req.params.offerId)}/${suffix}${rawQueryString(req.originalUrl)}`,
          { headers: buildInternalHeaders(req) },
        );
        res.json(result);
      } catch (error: any) {
        console.error(`Failed to get ${what}:`, error.message);
        respondUpstreamError(res, error, `Failed to get ${what}`);
      }
    },
  );
}

for (const { suffix, what } of GRAIN_SUFFIXES) {
  router.get(
    `/brands/:brandId/${suffix}`,
    authenticate,
    requireOrg,
    requireUser,
    async (req: AuthenticatedRequest, res) => {
      try {
        const result = await callExternalService(
          externalServices.features,
          `/brands/${encodeURIComponent(req.params.brandId)}/${suffix}${rawQueryString(req.originalUrl)}`,
          { headers: buildInternalHeaders(req) },
        );
        res.json(result);
      } catch (error: any) {
        console.error(`Failed to get brand ${what}:`, error.message);
        respondUpstreamError(res, error, `Failed to get brand ${what}`);
      }
    },
  );
}

/**
 * GET /v1/features/brands/:brandId/offers
 *
 * The brand grain's fourth read, and the one a brand Overview's offer table is
 * built on: every offer of a brand, each with its own money combined across every
 * channel that offer is sold through, in one lean body a table can poll.
 *
 * Before it, that table had to pick a channel and print it — so a brand running
 * more than one acquisition channel saw a row that was right about one channel and
 * wrong about the offer. Nothing is combined here: money adds across an offer's
 * channels because a run belongs to one channel, people do not (a lead worked
 * through two channels is one lead) and no ratio does. features-service owns all
 * of it (CLAUDE.md #2).
 *
 * PATH NOTE — why this one is NOT `/v1/brands/:brandId/offers` like its three
 * siblings: `src/routes/brand.ts` already serves `GET /v1/brands/:id/offers` (the
 * brand's offer CATALOG, from brand-service) and brandRoutes mounts BEFORE this
 * router, so that route wins and a same-path declaration here would be dead code.
 * Two different questions that happen to share a noun. This takes the documented
 * `/v1/{service-name}/{original-downstream-path}` shape instead (CLAUDE.md "Future
 * direction"), which leaves the DOWNSTREAM path exactly what features-service
 * serves — `/brands/{brandId}/offers` — and renames nothing.
 *
 * The WHOLE query is forwarded off req.originalUrl (CLAUDE.md #11): `funnel`,
 * `pricing` and whatever features-service ships next all reach it, and a value it
 * rejects comes back as its own 400. Its named 404 / 409 / 502 reach the caller
 * with their reason intact via respondUpstreamError (CLAUDE.md #7).
 */
router.get(
  "/features/brands/:brandId/offers",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.features,
        `/brands/${encodeURIComponent(req.params.brandId)}/offers${rawQueryString(req.originalUrl)}`,
        { headers: buildInternalHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      console.error("Failed to get brand offers:", error.message);
      respondUpstreamError(res, error, "Failed to get brand offers");
    }
  },
);

export default router;
