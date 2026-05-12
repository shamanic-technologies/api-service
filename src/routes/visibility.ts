import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// GET /v1/orgs/visibility-score-runs — list visibility-score runs with deltas
router.get("/orgs/visibility-score-runs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["brandId", "domain", "from", "to", "limit", "offset", "campaignId"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.aiVisibility,
      `/orgs/visibility-score-runs${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list visibility-score runs" });
  }
});

// POST /v1/orgs/visibility-score-runs — start a visibility-score audit
router.post("/orgs/visibility-score-runs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.aiVisibility,
      `/orgs/visibility-score-runs`,
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to start visibility-score run" });
  }
});

// GET /v1/orgs/visibility-score-runs/:id — single run with prompts[], competitors[], top_competitors[], citation_opportunities[]
router.get("/orgs/visibility-score-runs/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id;
    const result = await callExternalService(
      externalServices.aiVisibility,
      `/orgs/visibility-score-runs/${encodeURIComponent(id)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch visibility-score run" });
  }
});

export default router;
