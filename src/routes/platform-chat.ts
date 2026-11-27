import { Router } from "express";
import { authenticatePlatform, AuthenticatedRequest } from "../middleware/auth.js";
import { refuseForwardedIdentity } from "../middleware/server-to-server.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { PlatformChatConfigRequestSchema } from "../schemas.js";
import { invalidRequestBody } from "../lib/invalid-request.js";

const router = Router();

/**
 * PUT /platform-chat/config
 * Platform-level chat config deployment — no identity headers required.
 * Authenticated by X-API-Key (ADMIN_DISTRIBUTE_API_KEY) only.
 * Used by the dashboard at cold start when no Clerk session exists.
 */
router.put("/config", authenticatePlatform, refuseForwardedIdentity, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = PlatformChatConfigRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(invalidRequestBody(parsed.error));
    }

    const result = await callExternalService(
      externalServices.chat,
      "/platform-config",
      {
        method: "PUT",
        body: parsed.data,
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Deploy platform chat config error:", error);
    res.status(500).json({ error: error.message || "Failed to deploy platform chat config" });
  }
});

export default router;
