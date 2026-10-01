import { Router } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { QualifyRequestSchema } from "../schemas.js";
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

    // A user key acts only in the organization its request targets: a body
    // `sourceOrgId` naming any other org is a cross-org write, refused here.
    // The override below is for the platform key's service callers only.
    if (req.authType === "user_key" && sourceOrgId && sourceOrgId !== req.orgId) {
      return res.status(403).json({
        error: "sourceOrgId is not the organization this request targets",
        code: "org_not_member",
        fix: "Omit sourceOrgId, or name that organization with `?orgId=<id>` (it must be one of your organizations).",
      });
    }

    // Use orgId from auth if not provided
    const orgId = sourceOrgId || req.orgId;

    // Build headers; override x-org-id if sourceOrgId is a different org
    const headers = buildInternalHeaders(req);
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
