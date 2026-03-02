import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { GenerateWorkflowRequestSchema } from "../schemas.js";
import { fetchKeySource } from "../lib/billing.js";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WorkflowProviders {
  providers: string[];
}

/**
 * Fetch requiredProviders for a single workflow by ID from workflow-service.
 * Returns an empty array on failure (best-effort enrichment).
 */
async function fetchRequiredProviders(workflowId: string): Promise<string[]> {
  try {
    const result = await callExternalService<WorkflowProviders>(
      externalServices.workflow,
      `/workflows/${workflowId}/required-providers`
    );
    return result.providers ?? [];
  } catch (err) {
    console.warn(`[workflows] Failed to fetch required-providers for ${workflowId}:`, (err as Error).message);
    return [];
  }
}

interface KeyItem {
  provider: string;
  maskedKey: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/**
 * Fetch the org's configured BYOK keys from key-service.
 */
async function fetchOrgKeys(orgId: string): Promise<KeyItem[]> {
  const result = await callExternalService<{ keys: KeyItem[] }>(
    externalServices.key,
    `/keys?keySource=org&orgId=${encodeURIComponent(orgId)}`
  );
  return result.keys ?? [];
}

/**
 * Resolve a workflow by name: find its ID from workflow-service list endpoint.
 */
async function resolveWorkflowByName(name: string): Promise<{ id: string; [key: string]: unknown } | null> {
  const result = await callExternalService<{ workflows: Array<{ id: string; name: string; [key: string]: unknown }> }>(
    externalServices.workflow,
    `/workflows?name=${encodeURIComponent(name)}`
  );
  const workflows = result.workflows ?? [];
  return workflows.find((w) => w.name === name) ?? workflows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /v1/workflows
 * List all workflows from workflow-service. All query params are optional filters.
 * Enriches each workflow with requiredProviders from workflow-service.
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

    const result = await callExternalService<{ workflows: Array<{ id: string; [key: string]: unknown }> }>(
      externalServices.workflow,
      `/workflows?${params.toString()}`
    );

    const workflows = result.workflows ?? [];

    // Enrich each workflow with requiredProviders in parallel
    const enriched = await Promise.all(
      workflows.map(async (wf) => {
        const requiredProviders = await fetchRequiredProviders(wf.id);
        return { ...wf, requiredProviders };
      })
    );

    res.json({ ...result, workflows: enriched });
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
 * GET /v1/workflows/:id/summary
 * Returns an AI-generated summary of a workflow's DAG in natural language.
 * Fetches the workflow (with DAG) from workflow-service and generates a summary
 * using the Anthropic API (via content-generation service).
 */
router.get("/workflows/:id/summary", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    // Fetch workflow with DAG and required providers in parallel
    const [workflow, requiredProviders] = await Promise.all([
      callExternalService<{ workflow: { id: string; name: string; dag?: { nodes: Array<{ id: string; type: string; config?: Record<string, unknown> }>; edges: Array<{ from: string; to: string }> } } }>(
        externalServices.workflow,
        `/workflows/${id}`
      ).then((r) => r.workflow),
      fetchRequiredProviders(id),
    ]);

    if (!workflow) {
      return res.status(404).json({ error: "Workflow not found" });
    }

    const dag = workflow.dag;
    if (!dag || !dag.nodes?.length) {
      return res.json({
        workflowName: workflow.name,
        summary: "This workflow has no steps defined yet.",
        requiredProviders,
        steps: [],
      });
    }

    // Build a concise summary from the DAG structure
    // Follow topological order based on edges
    const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));
    const inDegree = new Map<string, number>();
    for (const n of dag.nodes) inDegree.set(n.id, 0);
    for (const e of dag.edges) inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);

    // Topological sort (Kahn's algorithm)
    const queue: string[] = [];
    for (const [nodeId, deg] of inDegree) {
      if (deg === 0) queue.push(nodeId);
    }
    const ordered: string[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      ordered.push(current);
      for (const e of dag.edges) {
        if (e.from === current) {
          inDegree.set(e.to, (inDegree.get(e.to) || 0) - 1);
          if (inDegree.get(e.to) === 0) queue.push(e.to);
        }
      }
    }

    // Generate step descriptions from ordered nodes
    const steps: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const node = nodeMap.get(ordered[i]);
      if (!node) continue;

      const config = node.config || {};
      const service = config.service as string | undefined;
      const method = config.method as string | undefined;
      const path = config.path as string | undefined;

      // Build a human-readable step description
      let desc = node.id.replace(/[-_]/g, " ");
      if (node.type === "http.call" && service) {
        const providerHint = service.charAt(0).toUpperCase() + service.slice(1);
        desc = `${desc} (${providerHint}${method && path ? ` — ${method} ${path}` : ""})`;
      } else if (node.type === "condition") {
        desc = `${desc} (conditional branch)`;
      } else if (node.type === "wait") {
        desc = `${desc} (wait/delay)`;
      } else if (node.type === "for-each") {
        desc = `${desc} (loop)`;
      }

      steps.push(`${i + 1}. ${desc}`);
    }

    // Build summary from the steps
    const providerList = requiredProviders.length > 0
      ? ` Uses ${requiredProviders.join(", ")}.`
      : "";
    const summary = `This workflow has ${ordered.length} step${ordered.length === 1 ? "" : "s"}.${providerList}`;

    res.json({
      workflowName: workflow.name,
      summary,
      requiredProviders,
      steps,
    });
  } catch (error: any) {
    console.error("Workflow summary error:", error.message);
    res.status(500).json({ error: error.message || "Failed to get workflow summary" });
  }
});

/**
 * GET /v1/workflows/:id/key-status
 * Compare requiredProviders of a workflow with the org's configured BYOK keys.
 */
router.get("/workflows/:id/key-status", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId!;

    // Fetch required providers and org keys in parallel
    const [requiredProviders, orgKeys] = await Promise.all([
      fetchRequiredProviders(id),
      fetchOrgKeys(orgId),
    ]);

    // Build a map of configured providers
    const configuredMap = new Map(orgKeys.map((k) => [k.provider, k.maskedKey]));

    const keys = requiredProviders.map((provider) => ({
      provider,
      configured: configuredMap.has(provider),
      maskedKey: configuredMap.get(provider) ?? null,
    }));

    const missing = keys.filter((k) => !k.configured).map((k) => k.provider);

    // We need the workflow name — fetch from workflow-service
    let workflowName = id;
    try {
      const wf = await callExternalService<{ workflow: { name: string } }>(
        externalServices.workflow,
        `/workflows/${id}`
      );
      workflowName = wf.workflow?.name ?? id;
    } catch {
      // Fall back to id
    }

    res.json({
      workflowName,
      ready: missing.length === 0,
      keys,
      missing,
    });
  } catch (error: any) {
    console.error("Workflow key-status error:", error.message);
    res.status(500).json({ error: error.message || "Failed to get workflow key status" });
  }
});

/**
 * GET /v1/workflows/:id
 * Get a single workflow with full DAG from workflow-service
 */
router.get("/workflows/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const [workflow, requiredProviders] = await Promise.all([
      callExternalService(
        externalServices.workflow,
        `/workflows/${id}`
      ),
      fetchRequiredProviders(id),
    ]);

    const wfObj = workflow as { workflow?: Record<string, unknown> };
    if (wfObj.workflow) {
      wfObj.workflow.requiredProviders = requiredProviders;
    }

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

// ---------------------------------------------------------------------------
// Exported helpers for use by campaigns route (pre-campaign validation)
// ---------------------------------------------------------------------------
export { fetchRequiredProviders, fetchOrgKeys, resolveWorkflowByName };

export default router;
