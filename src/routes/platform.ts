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
 * Get lightweight LLM context overview from api-registry (service names + endpoint counts)
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
    console.error("[api-service] Get platform LLM context error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get LLM context" });
  }
});

/**
 * GET /v1/platform/llm-context/:service
 * Get LLM-friendly endpoint details for a specific service from api-registry
 */
router.get("/platform/llm-context/:service", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { service } = req.params;
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const path = `/llm-context/${service}${queryString ? `?${queryString}` : ""}`;
    const result = await callExternalService(
      externalServices.apiRegistry,
      path,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get platform LLM context for service error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get LLM context for service" });
  }
});

export default router;
