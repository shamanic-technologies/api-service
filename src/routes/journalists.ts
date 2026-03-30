import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// ── GET /v1/journalists — list journalists by brand ─────────────────────────
router.get("/journalists", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { brandId, runId, campaignId } = req.query as { brandId?: string; runId?: string; campaignId?: string };
    if (!brandId) {
      return res.status(400).json({ error: "Missing required query parameter: brandId" });
    }

    const params = new URLSearchParams();
    params.set("brand_id", brandId);
    if (runId) params.set("run_id", runId);
    if (campaignId) params.set("campaign_id", campaignId);

    const result = await callExternalService(
      externalServices.journalist,
      `/campaign-outlet-journalists?${params}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list journalists" });
  }
});

// ── POST /v1/journalists/discover — discover journalists for brand+outlet ───
router.post("/journalists/discover", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.journalist,
      "/discover",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to discover journalists" });
  }
});

// ── POST /v1/journalists/discover-emails — discover journalist emails ───────
router.post("/journalists/discover-emails", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.journalist,
      "/journalists/discover-emails",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to discover journalist emails" });
  }
});

// ── POST /v1/journalists/buffer/next — get next buffered journalist ──────────
router.post("/journalists/buffer/next", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.journalist,
      "/buffer/next",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get next buffered journalist" });
  }
});

// ── GET /v1/journalists/stats/costs — journalist discovery cost stats ────────
router.get("/journalists/stats/costs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["brandId", "campaignId", "groupBy"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    if (!params.get("brandId")) {
      return res.status(400).json({ error: "Missing required query parameter: brandId" });
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.journalist,
      `/journalists/stats/costs${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get journalist cost stats" });
  }
});

// ── POST /v1/journalists/resolve — resolve journalists for campaign+outlet or brand+outlet ──
// Translates the POST body into a GET /campaign-outlet-journalists query on journalist-service
router.post("/journalists/resolve", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { outletId, brandId } = req.body as { outletId?: string; brandId?: string };
    const campaignId = req.campaignId;

    if (!campaignId && !brandId) {
      return res.status(400).json({ error: "Either x-campaign-id header or brandId in request body is required" });
    }
    if (!outletId) {
      return res.status(400).json({ error: "Missing outletId in request body" });
    }

    const params = new URLSearchParams();
    if (campaignId) params.set("campaign_id", campaignId);
    if (brandId) params.set("brand_id", brandId);
    params.set("outlet_id", outletId);

    const result = await callExternalService<{
      campaignJournalists: Array<Record<string, unknown>>;
    }>(
      externalServices.journalist,
      `/campaign-outlet-journalists?${params}`,
      { headers: buildInternalHeaders(req) }
    );

    // Transform response to match the ResolveJournalistsResponse schema
    const journalists = (result.campaignJournalists || []).map((j) => ({
      id: j.journalistId ?? j.id,
      journalistName: j.journalistName,
      firstName: j.firstName,
      lastName: j.lastName,
      entityType: j.entityType,
      relevanceScore: typeof j.relevanceScore === "string" ? parseFloat(j.relevanceScore as string) : j.relevanceScore,
      whyRelevant: j.whyRelevant,
      whyNotRelevant: j.whyNotRelevant,
      articleUrls: j.articleUrls,
    }));

    res.json({ journalists, cached: true });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to resolve journalists" });
  }
});

export default router;
