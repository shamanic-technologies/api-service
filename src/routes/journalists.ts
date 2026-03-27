import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// ── POST /v1/journalists/discover — discover journalists for brand+outlet ───
router.post("/journalists/discover", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.journalist,
      "/journalists/discover",
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

// ── POST /v1/journalists/resolve — resolve journalists for campaign+outlet ──
// Translates the POST body into a GET /campaign-outlet-journalists query on journalist-service
router.post("/journalists/resolve", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { outletId } = req.body as { outletId?: string };
    const campaignId = req.campaignId;

    if (!campaignId) {
      return res.status(400).json({ error: "Missing x-campaign-id header (required for journalist resolution)" });
    }
    if (!outletId) {
      return res.status(400).json({ error: "Missing outletId in request body" });
    }

    const params = new URLSearchParams({
      campaign_id: campaignId,
      outlet_id: outletId,
    });

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
