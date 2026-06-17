import { Router, Request, Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
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
    for (const key of ["brandId", "campaignId", "workflowSlug", "groupBy", "lens"]) {
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
 * GET /v1/features/:slug/workflow-projection
 * Ranks a brand's workflows by cost-per-close and projects a budget through the sales funnel,
 * scoped by brandId. Proxied to features-service GET /features/:slug/workflow-projection.
 */
router.get("/features/:slug/workflow-projection", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["brandId", "objective", "budgetUsd"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
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
