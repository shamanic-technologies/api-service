import { Router } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { QualifyRequestSchema } from "../schemas.js";
import { fetchKeySource } from "../lib/billing.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * POST /v1/qualify
 * Qualify an email reply using AI
 */
router.post("/qualify", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = QualifyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const {
      sourceService,
      sourceOrgId,
      sourceRefId,
      fromEmail,
      toEmail,
      subject,
      bodyText,
      bodyHtml,
      byokApiKey,
    } = parsed.data;

    // Use orgId from auth if not provided
    const orgId = sourceOrgId || req.orgId;

    // Use middleware-resolved keySource when sourceOrgId matches req.orgId or is absent.
    // Only re-resolve if sourceOrgId is a different org.
    let keySource: string | undefined = req.keySource;
    if (sourceOrgId && sourceOrgId !== req.orgId && req.appId) {
      keySource = await fetchKeySource(sourceOrgId, req.appId);
    }
    if (!keySource) keySource = "platform";

    // Build headers; override x-key-source if sourceOrgId resolved a different keySource
    const headers = buildInternalHeaders(req);
    if (keySource) headers["x-key-source"] = keySource;
    if (orgId && orgId !== req.orgId) headers["x-org-id"] = orgId;

    const result = await callExternalService(
      externalServices.replyQualification,
      "/qualify",
      {
        method: "POST",
        headers,
        body: {
          sourceService,
          sourceOrgId: orgId,
          sourceRefId,
          fromEmail,
          toEmail,
          subject,
          bodyText,
          bodyHtml,
          appId: req.appId!,
          userId: req.userId,
          byokApiKey,
        },
      }
    );

    res.json(result);
  } catch (error: any) {
    console.error("Qualify error:", error);
    res.status(500).json({ error: error.message || "Failed to qualify reply" });
  }
});

export default router;
