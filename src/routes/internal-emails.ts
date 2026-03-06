import { Router } from "express";
import { authenticatePlatform, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { DeployEmailTemplatesRequestSchema } from "../schemas.js";

const router = Router();

/**
 * PUT /internal/emails/templates
 * Platform-level template deployment — no identity headers required.
 * Authenticated by X-API-Key (ADMIN_DISTRIBUTE_API_KEY) only.
 * Used by the dashboard at cold start when no Clerk session exists.
 */
router.put("/emails/templates", authenticatePlatform, async (req: AuthenticatedRequest, res) => {
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
        body: {
          ...parsed.data,
        },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Deploy templates (internal) error:", error);
    res.status(500).json({ error: error.message || "Failed to deploy templates" });
  }
});

export default router;
