import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, callExternalServiceWithStatus, externalServices } from "../lib/service-client.js";
import { getRunsBatch, type RunWithCosts } from "@distribute/runs-client";
import { BrandUpsertRequestSchema, IcpSuggestionRequestSchema } from "../schemas.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

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
      "/orgs/brands",
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
 * GET /v1/brands
 * Get all brands for the organization (for dashboard)
 */
router.get("/brands", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams({ orgId: req.orgId! });

    const result = await callExternalService(
      externalServices.brand,
      `/orgs/brands?${params}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get brands error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get brands" });
  }
});

/**
 * GET /v1/brands/by-ids?ids=uuid1,uuid2,...
 * Batch lookup by id. Proxies to brand-service GET /internal/brands?ids=...
 * Caller is responsible for staying within the brand-service per-request cap
 * (the upstream will return 400 if exceeded — propagated verbatim).
 */
router.get("/brands/by-ids", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const ids = req.query.ids as string | undefined;
    if (!ids || ids.length === 0) {
      return res.status(400).json({ error: "ids query param (comma-separated UUIDs) is required" });
    }
    const result = await callExternalService(
      externalServices.brand,
      `/internal/brands?ids=${encodeURIComponent(ids)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get brands batch error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get brands batch" });
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
      `/internal/brands/${req.params.id}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get brand by id error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get brand" });
  }
});

/**
 * POST /v1/brands/extract-fields
 * Multi-brand field extraction. Dashboard sends brandIds in the body;
 * api-service sets x-brand-id CSV header and strips brandIds before proxying.
 */
router.post("/brands/extract-fields", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { brandIds, ...restBody } = req.body as { brandIds?: string[]; [k: string]: unknown };
    if (!brandIds || !Array.isArray(brandIds) || brandIds.length === 0) {
      return res.status(400).json({ error: "brandIds (non-empty string array) is required in the request body" });
    }

    const headers: Record<string, string> = {
      ...buildInternalHeaders(req),
      "x-brand-id": brandIds.join(","),
    };
    const result = await callExternalService(
      externalServices.brand,
      "/orgs/brands/extract-fields",
      {
        method: "POST",
        headers,
        body: restBody,
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Extract fields (header) error:", error);
    const msg = error.message || "Failed to extract fields";
    if (msg.includes("No Anthropic API key found")) {
      return res.status(400).json({
        error: "Anthropic API key not configured. Add your Anthropic key in the dashboard under Settings > API Keys.",
      });
    }
    res.status(error.statusCode || 500).json({ error: msg });
  }
});

/**
 * GET /v1/brands/:id/extracted-fields
 * List all previously extracted and cached fields for a brand.
 */
router.get("/brands/:id/extracted-fields", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      `/internal/brands/${req.params.id}/extracted-fields`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get extracted fields error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get extracted fields" });
  }
});

/**
 * POST /v1/brands/extract-images
 * Multi-brand image extraction. Dashboard sends brandIds in the body;
 * api-service sets x-brand-id CSV header and strips brandIds before proxying.
 */
router.post("/brands/extract-images", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { brandIds, ...restBody } = req.body as { brandIds?: string[]; [k: string]: unknown };
    if (!brandIds || !Array.isArray(brandIds) || brandIds.length === 0) {
      return res.status(400).json({ error: "brandIds (non-empty string array) is required in the request body" });
    }

    const headers: Record<string, string> = {
      ...buildInternalHeaders(req),
      "x-brand-id": brandIds.join(","),
    };
    const result = await callExternalService(
      externalServices.brand,
      "/orgs/brands/extract-images",
      {
        method: "POST",
        headers,
        body: restBody,
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Extract images error:", error);
    const msg = error.message || "Failed to extract images";
    if (msg.includes("No Anthropic API key found")) {
      return res.status(400).json({
        error: "Anthropic API key not configured. Add your Anthropic key in the dashboard under Settings > API Keys.",
      });
    }
    res.status(error.statusCode || 500).json({ error: msg });
  }
});

/**
 * GET /v1/brands/:id/extracted-images
 * List extracted images in cache. Supports ?campaignId= query param.
 */
router.get("/brands/:id/extracted-images", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.campaignId) params.set("campaignId", req.query.campaignId as string);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.brand,
      `/internal/brands/${req.params.id}/extracted-images${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get extracted images error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get extracted images" });
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
      "/orgs/icp-suggestion",
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
      `/internal/brands/${id}/runs`,
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
 * GET /v1/brands/:id/sales-economics-effective
 * Proxy to brand-service GET /orgs/brands/:id/sales-economics-effective.
 * Returns the brand's "gold" effective sales conversion-economics: its own saved
 * economics, or the org's cross-brand average when the brand has saved nothing,
 * plus a `source` provenance field ({ economics: { ...5 metrics } | null,
 * source: "user" | "cross-brand-average" | null }). Used by the dashboard
 * "new campaign" page to prefill inputs. Response shape is owned by the
 * downstream service — passthrough only.
 */
router.get("/brands/:id/sales-economics-effective", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/sales-economics-effective`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get sales economics effective error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get effective sales economics" });
  }
});

/**
 * GET /v1/brands/:id/sales-economics
 * Proxy to brand-service GET /orgs/brands/:id/sales-economics.
 * Returns the brand's sales conversion-economics metrics (5 numbers) or
 * { salesEconomics: null } when unset. Response shape is owned by the
 * downstream service — passthrough only.
 */
router.get("/brands/:id/sales-economics", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/sales-economics`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get sales economics error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get sales economics" });
  }
});

/**
 * PUT /v1/brands/:id/sales-economics
 * Proxy to brand-service PUT /orgs/brands/:id/sales-economics.
 * Saves the brand's 5 sales conversion-economics metrics. Body + response
 * shapes are owned by the downstream service; its 4xx validation errors
 * propagate verbatim — passthrough only.
 */
router.put("/brands/:id/sales-economics", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/sales-economics`,
      {
        method: "PUT",
        headers: buildInternalHeaders(req),
        body: req.body,
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Save sales economics error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to save sales economics" });
  }
});

/**
 * POST /v1/brands/:id/transfer
 * Transfer a brand to a different org. Resolves the Clerk org ID to an internal UUID,
 * then proxies to brand-service which orchestrates the full transfer.
 */
router.post("/brands/:id/transfer", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { targetOrgId } = req.body as { targetOrgId?: string };
    if (!targetOrgId) {
      return res.status(400).json({ error: "targetOrgId is required" });
    }

    // Resolve Clerk org ID → internal UUID via client-service
    const externalUserId = req.headers["x-external-user-id"] as string | undefined;
    if (!externalUserId) {
      return res.status(400).json({ error: "x-external-user-id header required for brand transfer" });
    }

    const resolved = await callExternalService<{ orgId: string; userId: string }>(
      externalServices.client,
      "/internal/resolve",
      {
        method: "POST",
        body: { externalOrgId: targetOrgId, externalUserId },
      },
    );

    if (!resolved.orgId) {
      return res.status(400).json({ error: "Failed to resolve target org" });
    }

    if (resolved.orgId === req.orgId) {
      return res.status(400).json({ error: "Target org is the same as the source org" });
    }

    // Verify user is a member of the target org
    try {
      await callExternalService(
        externalServices.client,
        `/internal/orgs/${resolved.orgId}/members/${req.userId}`,
      );
    } catch (membershipError: any) {
      if (membershipError.statusCode === 404) {
        return res.status(403).json({ error: "User is not a member of the target org" });
      }
      throw membershipError;
    }

    const result = await callExternalService(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/transfer`,
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: { targetOrgId: resolved.orgId },
      },
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Brand transfer error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to transfer brand" });
  }
});

/**
 * GET /v1/brands/:id/transfers
 * Get transfer history for a brand.
 */
router.get("/brands/:id/transfers", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      `/internal/brand-transfers?brandId=${req.params.id}`,
      {
        headers: buildInternalHeaders(req),
      },
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Brand transfer history error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get transfer history" });
  }
});

/**
 * GET /v1/brand-transfers/outgoing
 * Transfers where the current org is the source.
 */
router.get("/brand-transfers/outgoing", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const brandId = req.query.brandId as string | undefined;
    const qs = brandId ? `?brandId=${brandId}` : "";
    const result = await callExternalService(
      externalServices.brand,
      `/orgs/brand-transfers/outgoing${qs}`,
      {
        headers: buildInternalHeaders(req),
      },
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Outgoing transfer history error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get outgoing transfers" });
  }
});

/**
 * GET /v1/brand-transfers/incoming
 * Transfers where the current org is the target.
 */
router.get("/brand-transfers/incoming", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const brandId = req.query.brandId as string | undefined;
    const qs = brandId ? `?brandId=${brandId}` : "";
    const result = await callExternalService(
      externalServices.brand,
      `/orgs/brand-transfers/incoming${qs}`,
      {
        headers: buildInternalHeaders(req),
      },
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Incoming transfer history error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get incoming transfers" });
  }
});

// ---------------------------------------------------------------------------
// Customer Personas + Brand Profile (transparent proxies to brand-service)
//
// Mirror the sales-economics proxies above exactly: downstream /orgs/brands/:id/X
// → gateway /v1/brands/:id/X (the gateway strips /orgs per repo convention; the
// dashboard's api lib calls /v1/brands/:id/...). Auth + identity forwarding are
// identical (authenticate + requireOrg + requireUser + buildInternalHeaders).
//
// These use callExternalServiceWithStatus so the upstream status code (incl. 201
// on create/duplicate and 409 on brand-profile conflict) is forwarded verbatim
// rather than collapsed to 200. Body + response shapes are owned by brand-service
// — passthrough only, no re-validation. The raw query string is forwarded verbatim.
// ---------------------------------------------------------------------------

// Forward the incoming request's raw query string verbatim (e.g. ?status=active).
function rawQuery(req: AuthenticatedRequest): string {
  const i = req.url.indexOf("?");
  return i === -1 ? "" : req.url.slice(i);
}

/**
 * GET /v1/brands/:id/personas
 * Proxy to brand-service GET /orgs/brands/:id/personas.
 */
router.get("/brands/:id/personas", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/personas${rawQuery(req)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] List personas error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list personas" });
  }
});

/**
 * POST /v1/brands/:id/personas
 * Proxy to brand-service POST /orgs/brands/:id/personas. Returns 201 verbatim on create.
 */
router.post("/brands/:id/personas", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/personas${rawQuery(req)}`,
      { method: "POST", headers: buildInternalHeaders(req), body: req.body },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] Create persona error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create persona" });
  }
});

/**
 * POST /v1/brands/:id/personas/suggest
 * Proxy to brand-service POST /orgs/brands/:id/personas/suggest. Returns AI-generated persona drafts verbatim.
 */
router.post("/brands/:id/personas/suggest", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/personas/suggest${rawQuery(req)}`,
      { method: "POST", headers: buildInternalHeaders(req), body: req.body },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] Suggest personas error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to suggest personas" });
  }
});

/**
 * POST /v1/brands/:id/personas/:personaId/duplicate
 * Proxy to brand-service POST /orgs/brands/:id/personas/:personaId/duplicate. Returns 201 verbatim.
 */
router.post("/brands/:id/personas/:personaId/duplicate", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/personas/${req.params.personaId}/duplicate${rawQuery(req)}`,
      { method: "POST", headers: buildInternalHeaders(req), body: req.body },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] Duplicate persona error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to duplicate persona" });
  }
});

/**
 * PATCH /v1/brands/:id/personas/:personaId/status
 * Proxy to brand-service PATCH /orgs/brands/:id/personas/:personaId/status.
 */
router.patch("/brands/:id/personas/:personaId/status", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/personas/${req.params.personaId}/status${rawQuery(req)}`,
      { method: "PATCH", headers: buildInternalHeaders(req), body: req.body },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] Update persona status error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to update persona status" });
  }
});

/**
 * GET /v1/brands/:id/brand-profile
 * Proxy to brand-service GET /orgs/brands/:id/brand-profile.
 */
router.get("/brands/:id/brand-profile", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/brand-profile${rawQuery(req)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] Get brand profile error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get brand profile" });
  }
});

/**
 * POST /v1/brands/:id/brand-profile
 * Proxy to brand-service POST /orgs/brands/:id/brand-profile. Returns 201 verbatim on
 * create and 409 verbatim on conflict.
 */
router.post("/brands/:id/brand-profile", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.brand,
      `/orgs/brands/${req.params.id}/brand-profile${rawQuery(req)}`,
      { method: "POST", headers: buildInternalHeaders(req), body: req.body },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] Create brand profile error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create brand profile" });
  }
});

export default router;
