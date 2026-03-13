import { Router } from "express";
import { authenticate, requireOrg, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { SendEmailRequestSchema, DeployEmailTemplatesRequestSchema } from "../schemas.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * POST /v1/emails/send
 * Send a transactional email via the transactional-email service
 */
router.post("/emails/send", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = SendEmailRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.transactionalEmail,
      "/send",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: {
          orgId: req.orgId,
          userId: req.userId,
          ...parsed.data,
        },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Send email error:", error);
    res.status(500).json({ error: error.message || "Failed to send email" });
  }
});

/**
 * GET /v1/emails/stats
 * Get email sending stats from the transactional-email service
 */
router.get("/emails/stats", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams({ orgId: req.orgId! });
    if (req.query.eventType) params.set("eventType", req.query.eventType as string);

    const result = await callExternalService(
      externalServices.transactionalEmail,
      `/stats?${params}`,
      {
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Email stats error:", error);
    res.status(500).json({ error: error.message || "Failed to get email stats" });
  }
});

/**
 * PUT /v1/emails/templates
 * Deploy (upsert) email templates — idempotent, safe to call on every cold start
 */
router.put("/emails/templates", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = DeployEmailTemplatesRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.transactionalEmail,
      "/templates",
      {
        method: "PUT",
        headers: buildInternalHeaders(req),
        body: {
          ...parsed.data,
        },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Deploy templates error:", error);
    res.status(500).json({ error: error.message || "Failed to deploy templates" });
  }
});

export default router;
