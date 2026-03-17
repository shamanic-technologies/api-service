import { Router } from "express";
import { authenticatePlatform, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { PlatformKeyRequestSchema } from "../schemas.js";

const router = Router();

/**
 * POST /platform-keys
 * Platform-level key registration — no identity headers required.
 * Authenticated by X-API-Key (ADMIN_DISTRIBUTE_API_KEY) only.
 * Used by the dashboard at cold start when no Clerk session exists.
 */
router.post("/", authenticatePlatform, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = PlatformKeyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.key,
      "/platform-keys",
      {
        method: "POST",
        body: parsed.data,
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Register platform key error:", error);
    res.status(500).json({ error: error.message || "Failed to register platform key" });
  }
});

export default router;
