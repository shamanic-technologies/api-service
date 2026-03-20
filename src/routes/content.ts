import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { ContentComposeRequestSchema } from "../schemas.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * POST /v1/content/compose
 * Proxy to content-generation-service POST /compose
 */
router.post("/content/compose", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = ContentComposeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService<{ composedVideoUrl: string }>(
      externalServices.emailgen,
      "/compose",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: parsed.data,
      },
    );

    res.json(result);
  } catch (error: any) {
    console.error("Content compose error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to compose content" });
  }
});

export default router;
