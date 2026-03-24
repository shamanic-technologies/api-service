import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * GET /v1/features
 * List features with optional filters
 */
router.get("/features", authenticate, async (req: AuthenticatedRequest, res) => {
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
 * GET /v1/features/:slug
 * Get a single feature by slug
 */
router.get("/features/:slug", authenticate, async (req: AuthenticatedRequest, res) => {
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
router.get("/features/:slug/inputs", authenticate, async (req: AuthenticatedRequest, res) => {
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
 * POST /v1/features/:slug/prefill
 * Prefill feature form using brand data. Called by dashboard for "New Campaign".
 */
router.post("/features/:slug/prefill", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.features,
      `/features/${encodeURIComponent(req.params.slug)}/prefill`,
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
 * PUT /v1/features
 * Batch upsert features (cold-start registration)
 */
router.put("/features", authenticate, async (req: AuthenticatedRequest, res) => {
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
