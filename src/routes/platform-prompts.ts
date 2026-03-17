import { Router } from "express";
import { authenticatePlatform, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { PlatformPromptRequestSchema } from "../schemas.js";

const router = Router();

/**
 * PUT /platform-prompts
 * Platform-level prompt deployment — no identity headers required.
 * Authenticated by X-API-Key (ADMIN_DISTRIBUTE_API_KEY) only.
 * Used by the dashboard at cold start when no Clerk session exists.
 */
router.put("/", authenticatePlatform, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = PlatformPromptRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.emailgen,
      "/platform-prompts",
      {
        method: "PUT",
        body: parsed.data,
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Deploy platform prompt error:", error);
    res.status(500).json({ error: error.message || "Failed to deploy platform prompt" });
  }
});

export default router;
