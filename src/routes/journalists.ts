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
router.post("/journalists/resolve", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.journalist,
      "/journalists/resolve",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to resolve journalists" });
  }
});

export default router;
