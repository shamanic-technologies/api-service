import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { GenerateWorkflowRequestSchema, UpdateWorkflowRequestSchema } from "../schemas.js";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProviderInfo {
  name: string;
  domain: string | null;
}

interface WorkflowProviders {
  providers: ProviderInfo[];
}

/**
 * Fetch requiredProviders for a single workflow by ID from workflow-service.
 * Returns an empty array on failure (best-effort enrichment).
 */
async function fetchRequiredProviders(workflowId: string, headers: Record<string, string> = {}): Promise<ProviderInfo[]> {
  try {
    const result = await callExternalService<WorkflowProviders>(
      externalServices.workflow,
      `/workflows/${workflowId}/required-providers`,
      { headers },
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
async function fetchOrgKeys(headers: Record<string, string>): Promise<KeyItem[]> {
  const result = await callExternalService<{ keys: KeyItem[] }>(
    externalServices.key,
    "/keys",
    { headers },
  );
  return result.keys ?? [];
}

interface KeySourceItem {
  provider: string;
  keySource: "org" | "platform";
}

/**
 * Fetch the org's key source preferences from key-service.
 * Providers not listed default to "platform".
 */
async function fetchKeySources(headers: Record<string, string>): Promise<KeySourceItem[]> {
  try {
    const result = await callExternalService<{ sources: KeySourceItem[] }>(
      externalServices.key,
      "/keys/sources",
      { headers },
    );
    return result.sources ?? [];
  } catch (err) {
    console.warn("[workflows] Failed to fetch key sources:", (err as Error).message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Proxy helper
// ---------------------------------------------------------------------------

/** Forward query params to workflow-service, building a URLSearchParams from the request. */
function buildWorkflowParams(query: Record<string, unknown>, keys: string[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) {
    if (query[key]) params.set(key, query[key] as string);
  }
  return params;
}

const RANKED_PARAMS = ["category", "channel", "audienceType", "objective", "limit", "groupBy", "brandId"];
const BEST_PARAMS = ["by", "orgId"];

// ---------------------------------------------------------------------------
// Public routes (no auth — proxied from workflow-service /public/*)
// ---------------------------------------------------------------------------

/**
 * GET /v1/public/workflows
 * Public list of workflows (no DAG, no auth).
 */
router.get("/public/workflows", async (_req, res) => {
  try {
    const params = buildWorkflowParams(_req.query as Record<string, unknown>, ["category", "channel", "audienceType"]);
    const result = await callExternalService(
      externalServices.workflow,
      `/public/workflows?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("Public list workflows error:", error.message);
    res.status(502).json({ error: error.message || "Failed to list public workflows" });
  }
});

/**
 * GET /v1/public/workflows/ranked
 * Public ranked workflows by performance (no DAG, no auth).
 */
router.get("/public/workflows/ranked", async (_req, res) => {
  try {
    const params = buildWorkflowParams(_req.query as Record<string, unknown>, RANKED_PARAMS);
    const result = await callExternalService(
      externalServices.workflow,
      `/public/workflows/ranked?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("Public ranked workflows error:", error.message);
    res.status(502).json({ error: error.message || "Failed to get public ranked workflows" });
  }
});

/**
 * GET /v1/public/workflows/best
 * Public hero records — best cost-per-open/reply (no auth).
 */
router.get("/public/workflows/best", async (_req, res) => {
  try {
    const params = buildWorkflowParams(_req.query as Record<string, unknown>, BEST_PARAMS);
    const result = await callExternalService(
      externalServices.workflow,
      `/public/workflows/best?${params}`,
      {},
    );
    res.json(result);
  } catch (error: any) {
    console.error("Public best workflows error:", error.message);
    res.status(502).json({ error: error.message || "Failed to get public best workflows" });
  }
});

// ---------------------------------------------------------------------------
// Authenticated routes
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
    if (req.query.category) params.set("category", req.query.category as string);
    if (req.query.channel) params.set("channel", req.query.channel as string);
    if (req.query.audienceType) params.set("audienceType", req.query.audienceType as string);
    if (req.query.humanId) params.set("humanId", req.query.humanId as string);

    const result = await callExternalService<{ workflows: Array<{ id: string; [key: string]: unknown }> }>(
      externalServices.workflow,
      `/workflows?${params.toString()}`,
      { headers: buildInternalHeaders(req) },
    );

    const workflows = result.workflows ?? [];

    // Enrich each workflow with requiredProviders in parallel
    const internalHeaders = buildInternalHeaders(req);
    const enriched = await Promise.all(
      workflows.map(async (wf) => {
        const requiredProviders = await fetchRequiredProviders(wf.id, internalHeaders);
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
 * GET /v1/workflows/ranked
 * Workflows ranked by performance, scoped to the authenticated org.
 * Proxies to workflow-service GET /workflows/ranked.
 */
router.get("/workflows/ranked", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = buildWorkflowParams(req.query as Record<string, unknown>, RANKED_PARAMS);
    const result = await callExternalService(
      externalServices.workflow,
      `/workflows/ranked?${params}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Ranked workflows error:", error.message);
    res.status(500).json({ error: error.message || "Failed to get ranked workflows" });
  }
});

/**
 * GET /v1/workflows/best
 * Hero records — best cost-per-open/reply, scoped to the authenticated org.
 * Proxies to workflow-service GET /workflows/best.
 */
router.get("/workflows/best", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = buildWorkflowParams(req.query as Record<string, unknown>, BEST_PARAMS);
    const result = await callExternalService(
      externalServices.workflow,
      `/workflows/best?${params}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Best workflows error:", error.message);
    res.status(500).json({ error: error.message || "Failed to get best workflows" });
  }
});

/**
 * GET /v1/workflows/:id/summary
 * Returns an AI-generated summary of a workflow's DAG in natural language.
 */
router.get("/workflows/:id/summary", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    // Fetch workflow with DAG and required providers in parallel
    const [workflow, requiredProviders] = await Promise.all([
      callExternalService<{ id: string; name: string; dag?: { nodes: Array<{ id: string; type: string; config?: Record<string, unknown> }>; edges: Array<{ from: string; to: string }> } }>(
        externalServices.workflow,
        `/workflows/${id}`,
        { headers: buildInternalHeaders(req) },
      ),
      fetchRequiredProviders(id, buildInternalHeaders(req)),
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

    const steps: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const node = nodeMap.get(ordered[i]);
      if (!node) continue;

      const config = node.config || {};
      const service = config.service as string | undefined;
      const method = config.method as string | undefined;
      const path = config.path as string | undefined;

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

    const providerNames = requiredProviders.map((p) => p.name);
    const providerList = providerNames.length > 0
      ? ` Uses ${providerNames.join(", ")}.`
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

    const internalHeaders = buildInternalHeaders(req);
    const [requiredProviders, orgKeys, keySources] = await Promise.all([
      fetchRequiredProviders(id, internalHeaders),
      fetchOrgKeys(internalHeaders),
      fetchKeySources(internalHeaders),
    ]);

    const configuredMap = new Map(orgKeys.map((k) => [k.provider, k.maskedKey]));
    const sourceMap = new Map(keySources.map((s) => [s.provider, s.keySource]));

    const keys = requiredProviders.map((p) => {
      const providerName = p.name;
      const keySource = sourceMap.get(providerName) ?? "platform";
      const hasOrgKey = configuredMap.has(providerName);
      // Platform keys are always available; org keys must be explicitly configured
      const configured = keySource === "platform" || hasOrgKey;
      return {
        provider: providerName,
        configured,
        maskedKey: configuredMap.get(providerName) ?? null,
        keySource,
      };
    });

    const missing = keys.filter((k) => !k.configured).map((k) => k.provider);

    let workflowName = id;
    try {
      const wf = await callExternalService<{ workflow: { name: string } }>(
        externalServices.workflow,
        `/workflows/${id}`,
        { headers: buildInternalHeaders(req) },
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
 * POST /v1/workflows/:id/validate
 * Validate a workflow DAG (structure + template contract check)
 */
router.post("/workflows/:id/validate", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const result = await callExternalService(
      externalServices.workflow,
      `/workflows/${id}/validate`,
      {
        method: "POST",
        headers: buildInternalHeaders(req),
      },
    );

    res.json(result);
  } catch (error: any) {
    console.error("Validate workflow error:", error.message);
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || "Failed to validate workflow" });
  }
});

/**
 * PUT /v1/workflows/:id
 * Update a workflow (name, description, tags, dag)
 */
router.put("/workflows/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const parsed = UpdateWorkflowRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const result = await callExternalService(
      externalServices.workflow,
      `/workflows/${id}`,
      {
        method: "PUT",
        headers: buildInternalHeaders(req),
        body: parsed.data,
      },
    );

    res.json(result);
  } catch (error: any) {
    console.error("Update workflow error:", error.message);
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || "Failed to update workflow" });
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
        `/workflows/${id}`,
        { headers: buildInternalHeaders(req) },
      ),
      fetchRequiredProviders(id, buildInternalHeaders(req)),
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

    const result = await callExternalService(
      externalServices.workflow,
      "/workflows/generate",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: {
          orgId: req.orgId,
          userId: req.userId,
          description,
          hints,
          ...(style && { style }),
        },
      }
    );

    res.json(result);
  } catch (error: any) {
    console.error("Generate workflow error:", error.message);
    const status = error.statusCode === 422 || error.message?.includes("422") ? 422 : 500;
    res.status(status).json({ error: error.message || "Failed to generate workflow" });
  }
});

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------
export { fetchRequiredProviders, fetchOrgKeys, fetchKeySources };

export default router;
