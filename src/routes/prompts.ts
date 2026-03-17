import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { VersionPromptRequestSchema } from "../schemas.js";

const router = Router();

/**
 * GET /v1/prompts?type=cold-email
 * Get a prompt template by type from content-generation service
 */
router.get("/prompts", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const type = req.query.type as string | undefined;
    if (!type) {
      return res.status(400).json({ error: "Missing required query parameter: type" });
    }

    const result = await callExternalService(
      externalServices.emailgen,
      `/prompts?type=${encodeURIComponent(type)}`,
      { headers: buildInternalHeaders(req) },
    );

    res.json(result);
  } catch (error: any) {
    console.error("Get prompt error:", error.message);
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || "Failed to get prompt" });
  }
});

/**
 * PUT /v1/prompts
 * Create a new version of a prompt template (auto-increments type name)
 */
router.put("/prompts", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = VersionPromptRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const result = await callExternalService(
      externalServices.emailgen,
      "/prompts",
      {
        method: "PUT",
        headers: buildInternalHeaders(req),
        body: parsed.data,
      },
    );

    res.status(201).json(result);
  } catch (error: any) {
    console.error("Version prompt error:", error.message);
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || "Failed to create prompt version" });
  }
});

export default router;
