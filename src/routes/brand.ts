import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { getRunsBatch, type RunWithCosts } from "@distribute/runs-client";
import { BrandScrapeRequestSchema, BrandUpsertRequestSchema, IcpSuggestionRequestSchema } from "../schemas.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * POST /v1/brand/scrape
 * Scrape brand information from a URL using scraping-service
 */
router.post("/brand/scrape", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = BrandScrapeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const { url, skipCache } = parsed.data;

    const result = await callExternalService(
      externalServices.scraping,
      "/scrape",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: {
          url,
          sourceService: "api-service",
          sourceOrgId: req.orgId,
          userId: req.userId,
          skipCache,
        },
      }
    );

    res.json(result);
  } catch (error: any) {
    console.error("Brand scrape error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to scrape brand" });
  }
});

/**
 * POST /v1/brands
 * Upsert a brand from a URL. Returns { brandId }.
 */
router.post("/brands", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = BrandUpsertRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService<{ brandId: string }>(
      externalServices.brand,
      "/brands",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: {
          url: parsed.data.url,
          orgId: req.orgId!,
          userId: req.userId!,
        },
      }
    );

    res.json(result);
  } catch (error: any) {
    console.error("Brand upsert error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to upsert brand" });
  }
});

/**
 * GET /v1/brand/by-url
 * Get cached brand info by URL
 */
router.get("/brand/by-url", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const url = req.query.url as string;

    if (!url) {
      return res.status(400).json({ error: "url query param is required" });
    }

    const params = new URLSearchParams({ url });

    const result = await callExternalService(
      externalServices.scraping,
      `/scrape/by-url?${params}`,
      { headers: buildInternalHeaders(req) },
    );

    res.json(result);
  } catch (error: any) {
    console.error("Get brand error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get brand" });
  }
});

/**
 * GET /v1/brands
 * Get all brands for the organization (for dashboard)
 */
router.get("/brands", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams({ orgId: req.orgId! });

    const result = await callExternalService(
      externalServices.brand,
      `/brands?${params}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get brands error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get brands" });
  }
});

/**
 * GET /v1/brands/:id
 * Get a single brand by ID from brand-service
 */
router.get("/brands/:id", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      `/brands/${req.params.id}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get brand by id error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get brand" });
  }
});

/**
 * GET /v1/brands/:id/sales-profile
 * Read-only: returns the sales profile for a brand, or 404 if none exists.
 */
router.get("/brands/:id/sales-profile", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      `/brands/${req.params.id}/sales-profile`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get brand sales profile error:", error);
    const statusCode = error.statusCode || 500;
    if (statusCode === 404) {
      return res.status(404).json({ error: "Sales profile not found" });
    }
    res.status(statusCode).json({ error: error.message || "Failed to get sales profile" });
  }
});

/**
 * POST /v1/brands/:id/sales-profile
 * Create: triggers AI extraction for the brand. Returns 409 if a profile already exists.
 */
router.post("/brands/:id/sales-profile", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      `/brands/${req.params.id}/sales-profile`,
      {
        method: "POST",
        headers: buildInternalHeaders(req),
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Create brand sales profile error:", error);
    const msg = error.message || "Failed to create sales profile";
    if (msg.includes("No Anthropic API key found")) {
      return res.status(400).json({
        error: "Anthropic API key not configured. Add your Anthropic key in the dashboard under Settings > API Keys.",
      });
    }
    const statusCode = error.statusCode || 500;
    if (statusCode === 409) {
      return res.status(409).json({ error: "Sales profile already exists. Use PUT to refresh." });
    }
    res.status(statusCode).json({ error: msg });
  }
});

/**
 * PUT /v1/brands/:id/sales-profile
 * Refresh: forces re-extraction of the sales profile.
 */
router.put("/brands/:id/sales-profile", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      `/brands/${req.params.id}/sales-profile`,
      {
        method: "PUT",
        headers: buildInternalHeaders(req),
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Refresh brand sales profile error:", error);
    const msg = error.message || "Failed to refresh sales profile";
    if (msg.includes("No Anthropic API key found")) {
      return res.status(400).json({
        error: "Anthropic API key not configured. Add your Anthropic key in the dashboard under Settings > API Keys.",
      });
    }
    res.status(error.statusCode || 500).json({ error: msg });
  }
});

/**
 * POST /v1/brand/icp-suggestion
 * Get ICP suggestion (Apollo-compatible search params) for a brand URL
 */
router.post("/brand/icp-suggestion", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = IcpSuggestionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const { brandUrl } = parsed.data;

    const result = await callExternalService(
      externalServices.brand,
      "/icp-suggestion",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: {
          orgId: req.orgId,
          userId: req.userId,
          url: brandUrl,
        },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("ICP suggestion error:", error.message);
    const msg = error.message || "Failed to get ICP suggestion";
    if (msg.includes("No Anthropic API key found")) {
      return res.status(400).json({
        error: "Anthropic API key not configured. Add your Anthropic key in the dashboard under Settings > API Keys.",
      });
    }
    res.status(error.statusCode || 500).json({ error: msg });
  }
});

/**
 * GET /v1/brands/:id/runs
 * Get extraction runs for a brand (sales-profile, icp-extraction) from brand-service,
 * enriched with cost data from runs-service.
 */
router.get("/brands/:id/runs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    // 1. Get runs list from brand-service
    const data = await callExternalService<{ runs?: Array<{ id: string; taskName: string; status: string; startedAt: string; completedAt: string | null }> }>(
      externalServices.brand,
      `/brands/${id}/runs`,
      { headers: buildInternalHeaders(req) },
    );
    const runs: Array<{ id: string; taskName: string; status: string; startedAt: string; completedAt: string | null }> = data.runs || [];

    if (runs.length === 0) {
      return res.json({ runs: [] });
    }

    // 2. Batch-fetch RunWithCosts from runs-service
    const runIds = runs.map((r) => r.id);
    let runMap = new Map<string, RunWithCosts>();
    try {
      runMap = await getRunsBatch(runIds, req.orgId, buildInternalHeaders(req));
    } catch (err) {
      console.warn("Failed to fetch run costs for brand runs:", err);
    }

    // 3. Enrich and return sorted by startedAt desc
    // Flatten costs: include both the run's own costs and all descendant run costs
    const enriched = runs
      .map((run) => {
        const withCosts = runMap.get(run.id);
        const allCosts = [
          ...(withCosts?.costs || []),
          ...(withCosts?.descendantRuns?.flatMap((dr: { costs: unknown[] }) => dr.costs) || []),
        ];
        return {
          id: run.id,
          taskName: run.taskName,
          status: withCosts?.status || run.status,
          startedAt: withCosts?.startedAt || run.startedAt,
          completedAt: withCosts?.completedAt || run.completedAt,
          totalCostInUsdCents: withCosts?.totalCostInUsdCents || null,
          costs: allCosts,
        };
      })
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    res.json({ runs: enriched });
  } catch (error: any) {
    console.error("Get brand runs error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get brand runs" });
  }
});

/**
 * GET /v1/brand/:id
 * Get brand scrape result by ID
 */
router.get("/brand/:id", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const result = await callExternalService(
      externalServices.scraping,
      `/scrape/${id}`,
      { headers: buildInternalHeaders(req) },
    );

    res.json(result);
  } catch (error: any) {
    console.error("Get brand error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get brand" });
  }
});

export default router;
