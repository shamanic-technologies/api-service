import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { UpsertKeyRequestSchema, CreateApiKeyRequestSchema } from "../schemas.js";

const router = Router();

const ALLOWED_KEY_SOURCES = ["org", "app"] as const;
type AllowedKeySource = (typeof ALLOWED_KEY_SOURCES)[number];

/**
 * Validate keySource + authType combination.
 * - "org"  → any authenticated user with org context
 * - "app"  → only app key auth (authType === "app_key")
 * - "platform" → never allowed via public API
 */
function validateKeySourceAccess(
  keySource: string,
  req: AuthenticatedRequest,
): { error: string; status: number } | { keySource: AllowedKeySource } {
  if (!ALLOWED_KEY_SOURCES.includes(keySource as AllowedKeySource)) {
    return { status: 403, error: `keySource "${keySource}" is not allowed via the public API` };
  }

  if (keySource === "app" && req.authType !== "app_key") {
    return { status: 403, error: "keySource 'app' requires app key authentication" };
  }

  if (keySource === "org" && !req.orgId) {
    return { status: 400, error: "Organization context required for org keys" };
  }

  if (keySource === "app" && !req.appId) {
    return { status: 403, error: "App key authentication required for app keys" };
  }

  return { keySource: keySource as AllowedKeySource };
}

// -----------------------------------------------------------------------
// Provider keys — transparent proxy to key-service unified /keys endpoints
// -----------------------------------------------------------------------

/**
 * GET /v1/keys
 * List provider keys. keySource query param selects the key store (default: "org").
 */
router.get("/keys", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const keySource = (req.query.keySource as string) || "org";
    const access = validateKeySourceAccess(keySource, req);
    if ("error" in access) return res.status(access.status).json({ error: access.error });

    const params = new URLSearchParams({ keySource: access.keySource });
    if (access.keySource === "org") params.set("orgId", req.orgId!);
    if (access.keySource === "app") params.set("appId", req.appId!);

    const result = await callExternalService(externalServices.key, `/keys?${params}`);
    res.json(result);
  } catch (error: any) {
    console.error("List keys error:", error);
    res.status(500).json({ error: error.message || "Failed to list keys" });
  }
});

/**
 * POST /v1/keys
 * Upsert a provider key. keySource in body determines the key store.
 */
router.post("/keys", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = UpsertKeyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const { keySource, provider, apiKey } = parsed.data;

    const access = validateKeySourceAccess(keySource, req);
    if ("error" in access) return res.status(access.status).json({ error: access.error });

    const body: Record<string, string> = { keySource: access.keySource, provider, apiKey };
    if (access.keySource === "org") body.orgId = req.orgId!;
    if (access.keySource === "app") body.appId = req.appId!;

    const result = await callExternalService(externalServices.key, "/keys", {
      method: "POST",
      body,
    });
    res.json(result);
  } catch (error: any) {
    console.error("Upsert key error:", error);
    res.status(500).json({ error: error.message || "Failed to upsert key" });
  }
});

/**
 * DELETE /v1/keys/:provider
 * Delete a provider key. keySource query param selects the key store (default: "org").
 */
router.delete("/keys/:provider", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { provider } = req.params;
    const keySource = (req.query.keySource as string) || "org";

    const access = validateKeySourceAccess(keySource, req);
    if ("error" in access) return res.status(access.status).json({ error: access.error });

    const params = new URLSearchParams({ keySource: access.keySource });
    if (access.keySource === "org") params.set("orgId", req.orgId!);
    if (access.keySource === "app") params.set("appId", req.appId!);

    const result = await callExternalService(
      externalServices.key,
      `/keys/${encodeURIComponent(provider)}?${params}`,
      { method: "DELETE" }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Delete key error:", error);
    res.status(500).json({ error: error.message || "Failed to delete key" });
  }
});

// -----------------------------------------------------------------------
// API keys — user-facing API key management (unchanged, uses /internal/api-keys)
// -----------------------------------------------------------------------

/**
 * POST /v1/api-keys/session
 * Get or create a session API key for Foxy chat
 */
router.post("/api-keys/session", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.key,
      "/internal/api-keys/session",
      {
        method: "POST",
        body: { appId: req.appId, orgId: req.orgId, userId: req.userId },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Session API key error:", error);
    res.status(500).json({ error: error.message || "Failed to get session API key" });
  }
});

/**
 * POST /v1/api-keys
 * Generate a new API key for the organization
 */
router.post("/api-keys", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = CreateApiKeyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const { name } = parsed.data;

    const result = await callExternalService(
      externalServices.key,
      "/internal/api-keys",
      {
        method: "POST",
        body: {
          appId: req.appId,
          orgId: req.orgId,
          userId: req.userId,
          createdBy: req.userId,
          name,
        },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Create API key error:", error);
    res.status(500).json({ error: error.message || "Failed to create API key" });
  }
});

/**
 * GET /v1/api-keys
 * List API keys for the organization
 */
router.get("/api-keys", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.key,
      `/internal/api-keys?orgId=${req.orgId}`
    );
    res.json(result);
  } catch (error: any) {
    console.error("List API keys error:", error);
    res.status(500).json({ error: error.message || "Failed to list API keys" });
  }
});

/**
 * DELETE /v1/api-keys/:id
 * Revoke an API key
 */
router.delete("/api-keys/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const result = await callExternalService(
      externalServices.key,
      `/internal/api-keys/${id}`,
      {
        method: "DELETE",
        body: { orgId: req.orgId },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Delete API key error:", error);
    res.status(500).json({ error: error.message || "Failed to delete API key" });
  }
});

export default router;
