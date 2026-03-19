import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { UpsertKeyRequestSchema, CreateApiKeyRequestSchema, SetKeySourceRequestSchema } from "../schemas.js";

const router = Router();

// -----------------------------------------------------------------------
// Provider keys — transparent proxy to key-service /keys endpoints
// -----------------------------------------------------------------------

/**
 * GET /v1/keys
 * List provider keys for the organization.
 */
router.get("/keys", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    const result = await callExternalService(externalServices.key, "/keys", {
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
      body: { provider, apiKey },
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
    const result = await callExternalService(
      externalServices.key,
      `/keys/${encodeURIComponent(provider)}`,
      { method: "DELETE", headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Delete key error:", error);
    res.status(500).json({ error: error.message || "Failed to delete key" });
  }
});

// -----------------------------------------------------------------------
// Key source preferences — org vs platform (BYOK) management
// -----------------------------------------------------------------------

/**
 * GET /v1/keys/sources
 * List all key source preferences for the organization.
 */
router.get("/keys/sources", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    const result = await callExternalService(externalServices.key, "/keys/sources", {
      headers: buildInternalHeaders(req),
    });
    res.json(result);
  } catch (error: any) {
    console.error("List key sources error:", error);
    res.status(500).json({ error: error.message || "Failed to list key sources" });
  }
});

/**
 * GET /v1/keys/:provider/source
 * Get key source preference for a specific provider.
 */
router.get("/keys/:provider/source", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    const { provider } = req.params;
    const result = await callExternalService(
      externalServices.key,
      `/keys/${encodeURIComponent(provider)}/source`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get key source error:", error);
    res.status(500).json({ error: error.message || "Failed to get key source" });
  }
});

/**
 * PUT /v1/keys/:provider/source
 * Set key source preference for a specific provider.
 */
router.put("/keys/:provider/source", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = SetKeySourceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });

    const { provider } = req.params;
    const result = await callExternalService(
      externalServices.key,
      `/keys/${encodeURIComponent(provider)}/source`,
      {
        method: "PUT",
        body: parsed.data,
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Set key source error:", error);
    res.status(500).json({ error: error.message || "Failed to set key source" });
  }
});

// -----------------------------------------------------------------------
// API keys — user-facing API key management
// -----------------------------------------------------------------------

/**
 * POST /v1/api-keys/session
 * Get or create a session API key for Foxy chat
 */
router.post("/api-keys/session", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.key,
      "/api-keys/session",
      {
        method: "POST",
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
      "/api-keys",
      {
        method: "POST",
        body: {
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
      "/api-keys",
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
      `/api-keys/${id}`,
      {
        method: "DELETE",
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
