import { Router } from "express";
import { authenticate, requireOrg, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { ResolveUserRequestSchema, ListUsersQuerySchema } from "../schemas.js";

const router = Router();

/**
 * POST /v1/users/resolve
 * Resolve external org/user IDs to internal UUIDs (idempotent upsert).
 * For anonymous users, the caller generates a UUID as externalUserId.
 */
router.post("/users/resolve", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = ResolveUserRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.client,
      "/resolve",
      {
        method: "POST",
        body: { appId: req.appId, ...parsed.data },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Resolve user error:", error);
    res.status(500).json({ error: error.message || "Failed to resolve user identity" });
  }
});

/**
 * GET /v1/users
 * List users for the authenticated org, with optional email filter and pagination.
 */
router.get("/users", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = ListUsersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten() });
    }

    const { email, limit, offset } = parsed.data;
    const params = new URLSearchParams({
      appId: req.appId!,
      orgId: req.orgId!,
      limit: String(limit),
      offset: String(offset),
    });
    if (email) params.set("email", email);

    const result = await callExternalService(
      externalServices.client,
      `/users?${params.toString()}`,
    );
    res.json(result);
  } catch (error: any) {
    console.error("List users error:", error);
    res.status(500).json({ error: error.message || "Failed to list users" });
  }
});

export default router;
