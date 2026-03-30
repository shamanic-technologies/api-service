import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, callExternalServiceWithStatus, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * GET /v1/features
 * List features with optional filters
 */
router.get("/features", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["status", "category", "channel", "audienceType", "implemented"]) {
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
 * GET /v1/features/dynasty
 * Resolve stable dynasty identifiers for a versioned feature slug.
 */
router.get("/features/dynasty", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const slug = req.query.slug as string | undefined;
    if (!slug) {
      return res.status(400).json({ error: "Missing required query parameter: slug" });
    }
    const result = await callExternalService(
      externalServices.features,
      `/features/dynasty?slug=${encodeURIComponent(slug)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Dynasty lookup error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to resolve dynasty" });
  }
});

/**
 * GET /v1/features/by-dynasty/:dynastySlug
 * Get the active feature for a dynasty slug. Returns 404 if none active.
 */
router.get("/features/by-dynasty/:dynastySlug", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      `/features/by-dynasty/${encodeURIComponent(req.params.dynastySlug)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get feature by dynasty slug error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get feature by dynasty slug" });
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
 * GET /v1/features/:slug/inputs
 * Get input schema for a feature
 */
router.get("/features/:slug/inputs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}/inputs`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get feature inputs error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get feature inputs" });
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
 * POST /v1/features/:slug/prefill
 * Prefill feature form using brand data. Called by dashboard for "New Campaign".
 */
router.post("/features/:slug/prefill", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const format = req.query.format;
    const qs = format ? `?format=${encodeURIComponent(format as string)}` : "";
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}/prefill${qs}`,
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: req.body,
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Prefill feature error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to prefill feature" });
  }
});

/**
 * POST /v1/features
 * Create a single feature
 */
router.post("/features", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      "/features",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: req.body,
      },
    );
    res.status(201).json(result);
  } catch (error: any) {
    console.error("Create feature error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create feature" });
  }
});

/**
 * PUT /v1/features/:slug
 * Update a single feature by slug.
 * Returns 200 for in-place metadata updates, 201 when inputs/outputs changed
 * and a fork was created (fork-on-write semantics from features-service).
 */
router.put("/features/:slug", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}`,
      {
        method: "PUT",
        headers: buildInternalHeaders(req),
        body: req.body,
      },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("Update feature error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to update feature" });
  }
});

/**
 * PUT /v1/features
 * Batch upsert features (cold-start registration)
 */
router.put("/features", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      "/features",
      {
        method: "PUT",
        headers: buildInternalHeaders(req),
        body: req.body,
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Batch upsert features error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to upsert features" });
  }
});

export default router;
