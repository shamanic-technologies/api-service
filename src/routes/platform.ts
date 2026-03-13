import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * GET /v1/platform/services
 * List all services from api-registry
 */
router.get("/platform/services", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.apiRegistry,
      "/services",
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("List platform services error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list services" });
  }
});

/**
 * GET /v1/platform/services/:service
 * Get OpenAPI spec for a specific service from api-registry
 */
router.get("/platform/services/:service", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { service } = req.params;
    const result = await callExternalService(
      externalServices.apiRegistry,
      `/openapi/${service}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get platform service spec error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get service spec" });
  }
});

/**
 * GET /v1/platform/llm-context
 * Get LLM context from api-registry (service descriptions + endpoint summaries for chat)
 */
router.get("/platform/llm-context", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.apiRegistry,
      "/llm-context",
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get platform LLM context error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get LLM context" });
  }
});

export default router;
