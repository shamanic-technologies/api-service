import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { UpsertKeyRequestSchema, CreateApiKeyRequestSchema } from "../schemas.js";

const router = Router();

// -----------------------------------------------------------------------
// Provider keys — transparent proxy to key-service unified /keys endpoints
// -----------------------------------------------------------------------

/**
 * GET /v1/keys
 * List provider keys for the organization.
 */
router.get("/keys", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    const params = new URLSearchParams({ orgId: req.orgId });
    const result = await callExternalService(externalServices.key, `/keys?${params}`, {
      headers: buildInternalHeaders(req),
    });
    res.json(result);
  } catch (error: any) {
    console.error("List keys error:", error);
    res.status(500).json({ error: error.message || "Failed to list keys" });
  }
});

/**
 * POST /v1/keys
 * Upsert a provider key for the organization.
 */
router.post("/keys", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = UpsertKeyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });

    const { provider, apiKey } = parsed.data;
    const result = await callExternalService(externalServices.key, "/keys", {
      method: "POST",
      body: { provider, apiKey, orgId: req.orgId },
      headers: buildInternalHeaders(req),
    });
    res.json(result);
  } catch (error: any) {
    console.error("Upsert key error:", error);
    res.status(500).json({ error: error.message || "Failed to upsert key" });
  }
});

/**
 * DELETE /v1/keys/:provider
 * Delete a provider key for the organization.
 */
router.delete("/keys/:provider", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    const { provider } = req.params;
    const params = new URLSearchParams({ orgId: req.orgId });
    const result = await callExternalService(
      externalServices.key,
      `/keys/${encodeURIComponent(provider)}?${params}`,
      { method: "DELETE", headers: buildInternalHeaders(req) }
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
        body: { orgId: req.orgId, userId: req.userId },
        headers: buildInternalHeaders(req),
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
          orgId: req.orgId,
          userId: req.userId,
          createdBy: req.userId,
          name,
        },
        headers: buildInternalHeaders(req),
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
      `/internal/api-keys?orgId=${req.orgId}`,
      { headers: buildInternalHeaders(req) },
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
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Delete API key error:", error);
    res.status(500).json({ error: error.message || "Failed to delete API key" });
  }
});

export default router;
