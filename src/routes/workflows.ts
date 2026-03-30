import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, callExternalServiceWithStatus, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { GenerateWorkflowRequestSchema, UpdateWorkflowRequestSchema } from "../schemas.js";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value: string): boolean {
  return UUID_RE.test(value);
}

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

const RANKED_PARAMS = ["objective", "limit", "groupBy", "brandId", "featureSlug", "featureDynastySlug"];
const BEST_PARAMS = ["by", "orgId", "featureDynastySlug"];

// ---------------------------------------------------------------------------
// Public routes (no auth — proxied from workflow-service /public/*)
// ---------------------------------------------------------------------------

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

    for (const key of ["orgId", "humanId", "featureSlug", "featureDynastySlug", "workflowSlug", "workflowDynastySlug"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }

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
 * POST /v1/workflows
 * Create a new workflow
 */
router.post("/workflows", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.workflow,
      "/workflows",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: req.body,
      },
    );
    res.status(201).json(result);
  } catch (error: any) {
    console.error("Create workflow error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create workflow" });
  }
});

/**
 * GET /v1/workflows/:id/summary
 * Returns an AI-generated summary of a workflow's DAG in natural language.
 */
router.get("/workflows/:id/summary", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: "Invalid workflow ID — expected a UUID" });

    // Fetch workflow with DAG and required providers in parallel
    const [workflow, requiredProviders] = await Promise.all([
      callExternalService<{ id: string; name: string; slug: string; dag?: { nodes: Array<{ id: string; type: string; config?: Record<string, unknown> }>; edges: Array<{ from: string; to: string }> } }>(
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
        workflowSlug: workflow.slug,
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
      workflowSlug: workflow.slug,
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
    if (!isUUID(id)) return res.status(400).json({ error: "Invalid workflow ID — expected a UUID" });

    const internalHeaders = buildInternalHeaders(req);
    const [requiredProviders, orgKeys, keySources, workflow] = await Promise.all([
      fetchRequiredProviders(id, internalHeaders),
      fetchOrgKeys(internalHeaders),
      fetchKeySources(internalHeaders),
      callExternalService<{ slug: string }>(
        externalServices.workflow,
        `/workflows/${id}`,
        { headers: internalHeaders },
      ),
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

    res.json({
      workflowSlug: workflow.slug,
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
    if (!isUUID(id)) return res.status(400).json({ error: "Invalid workflow ID — expected a UUID" });

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
    if (!isUUID(id)) return res.status(400).json({ error: "Invalid workflow ID — expected a UUID" });

    const parsed = UpdateWorkflowRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const { status, data } = await callExternalServiceWithStatus(
      externalServices.workflow,
      `/workflows/${id}`,
      {
        method: "PUT",
        headers: buildInternalHeaders(req),
        body: parsed.data,
      },
    );

    res.status(status).json(data);
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
    if (!isUUID(id)) return res.status(400).json({ error: "Invalid workflow ID — expected a UUID" });

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
 * POST /v1/workflows/:id/execute
 * Execute a workflow by ID
 */
router.post("/workflows/:id/execute", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: "Invalid workflow ID — expected a UUID" });

    const result = await callExternalService(
      externalServices.workflow,
      `/workflows/${id}/execute`,
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: req.body,
      },
    );
    res.status(201).json(result);
  } catch (error: any) {
    console.error("Execute workflow error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to execute workflow" });
  }
});

// ---------------------------------------------------------------------------
// Workflow runs
// ---------------------------------------------------------------------------

/**
 * GET /v1/workflow-runs
 * List workflow runs with optional filters
 */
router.get("/workflow-runs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["workflowId", "campaignId", "featureSlug", "featureDynastySlug", "workflowSlug", "workflowDynastySlug", "status"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.workflow,
      `/workflow-runs${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("List workflow runs error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list workflow runs" });
  }
});

/**
 * GET /v1/workflow-runs/:id
 * Get a single workflow run by ID
 */
router.get("/workflow-runs/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: "Invalid workflow run ID — expected a UUID" });
    const result = await callExternalService(
      externalServices.workflow,
      `/workflow-runs/${id}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Get workflow run error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get workflow run" });
  }
});

/**
 * POST /v1/workflow-runs/:id/cancel
 * Cancel a running workflow
 */
router.post("/workflow-runs/:id/cancel", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: "Invalid workflow run ID — expected a UUID" });
    const result = await callExternalService(
      externalServices.workflow,
      `/workflow-runs/${id}/cancel`,
      {
        method: "POST",
        headers: buildInternalHeaders(req),
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error("Cancel workflow run error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to cancel workflow run" });
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

    const { featureSlug, description, hints, style } = parsed.data;

    const result = await callExternalService(
      externalServices.workflow,
      "/workflows/generate",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: {
          orgId: req.orgId,
          userId: req.userId,
          featureSlug,
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
