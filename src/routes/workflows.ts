import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { GenerateWorkflowRequestSchema } from "../schemas.js";
import { fetchKeySource } from "../lib/billing.js";

const router = Router();

/**
 * GET /v1/workflows
 * List all workflows from workflow-service. All query params are optional filters.
 */
router.get("/workflows", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();

    if (req.query.orgId) params.set("orgId", req.query.orgId as string);
    if (req.query.appId) params.set("appId", req.query.appId as string);
    if (req.query.category) params.set("category", req.query.category as string);
    if (req.query.channel) params.set("channel", req.query.channel as string);
    if (req.query.audienceType) params.set("audienceType", req.query.audienceType as string);
    if (req.query.humanId) params.set("humanId", req.query.humanId as string);

    const result = await callExternalService(
      externalServices.workflow,
      `/workflows?${params.toString()}`
    );

    res.json(result);
  } catch (error: any) {
    console.error("List workflows error:", error.message);
    res.status(500).json({ error: error.message || "Failed to list workflows" });
  }
});

/**
 * GET /v1/workflows/best
 * Get the best-performing workflow from workflow-service (lowest cost per outcome)
 */
router.get("/workflows/best", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();

    if (req.query.appId) params.set("appId", req.query.appId as string);
    if (req.query.category) params.set("category", req.query.category as string);
    if (req.query.channel) params.set("channel", req.query.channel as string);
    if (req.query.audienceType) params.set("audienceType", req.query.audienceType as string);
    if (req.query.objective) params.set("objective", req.query.objective as string);

    const result = await callExternalService(
      externalServices.workflow,
      `/workflows/best?${params.toString()}`
    );

    res.json(result);
  } catch (error: any) {
    console.error("Get best workflow error:", error.message);
    res.status(500).json({ error: error.message || "Failed to get best workflow" });
  }
});

/**
 * GET /v1/workflows/:id
 * Get a single workflow with full DAG from workflow-service
 */
router.get("/workflows/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const workflow = await callExternalService(
      externalServices.workflow,
      `/workflows/${req.params.id}`
    );

    res.json(workflow);
  } catch (error: any) {
    console.error("Get workflow error:", error.message);
    res.status(500).json({ error: error.message || "Failed to get workflow" });
  }
});

/**
 * POST /v1/workflows/generate
 * Generate a workflow DAG from natural language via workflow-service
 */
router.post("/workflows/generate", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = GenerateWorkflowRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const { description, hints, style } = parsed.data;

    // Resolve keySource from billing-service
    const keySource = await fetchKeySource(req.orgId!, req.appId!);

    const result = await callExternalService(
      externalServices.workflow,
      "/workflows/generate",
      {
        method: "POST",
        body: {
          appId: req.appId!,
          orgId: req.orgId,
          userId: req.userId,
          keySource,
          description,
          hints,
          ...(style && { style }),
        },
      }
    );

    res.json(result);
  } catch (error: any) {
    console.error("Generate workflow error:", error.message);
    const status = error.message?.includes("422") ? 422 : 500;
    res.status(status).json({ error: error.message || "Failed to generate workflow" });
  }
});

export default router;
