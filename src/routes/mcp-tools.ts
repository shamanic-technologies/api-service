import { Router } from "express";
import { authenticatePlatform, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";

const router = Router();

// ── MCP tool definitions ────────────────────────────────────────────────────

const MCP_TOOLS = [
  {
    name: "getWorkflowDetails",
    description:
      "Get full details of a workflow including its DAG (nodes, edges, onError), name, description, tags, and required providers. " +
      "Use this to understand the structure of a workflow before suggesting changes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflowId: { type: "string", description: "UUID of the workflow to fetch" },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "getPrompt",
    description:
      "Get a prompt template by type (e.g. 'cold-email'). Returns the prompt text with {{variable}} placeholders, " +
      "the list of expected variables, and version metadata. Use this to understand what a content-generation node uses.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", description: "Prompt type identifier (e.g. 'cold-email', 'cold-email-v2')" },
      },
      required: ["type"],
    },
  },
  {
    name: "validateWorkflow",
    description:
      "Validate a workflow DAG for structural correctness and template contract compliance. " +
      "Returns whether the DAG is valid, any structural errors, and template contract issues " +
      "(missing variables, unknown variables, unreachable templates). " +
      "IMPORTANT: You MUST call this after every updateWorkflow call to verify the changes are correct.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflowId: { type: "string", description: "UUID of the workflow to validate" },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "updateWorkflow",
    description:
      "Update a workflow's name, description, tags, or DAG. Send only the fields you want to change. " +
      "When updating the DAG, send the complete dag object (nodes + edges + onError). " +
      "After calling this, you MUST call validateWorkflow to verify the changes are correct.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflowId: { type: "string", description: "UUID of the workflow to update" },
        name: { type: "string", description: "New workflow name" },
        description: { type: "string", description: "New workflow description" },
        tags: { type: "array", items: { type: "string" }, description: "New tags array" },
        dag: {
          type: "object",
          description: "Complete updated DAG with nodes, edges, and optional onError",
          properties: {
            nodes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Unique node ID within the DAG" },
                  type: { type: "string", description: "Node type (http.call, condition, wait, for-each, script)" },
                  config: { type: "object", description: "Static parameters for the node" },
                  inputMapping: { type: "object", description: "Dynamic input references using $ref syntax" },
                  retries: { type: "integer", description: "Retry count (default 3, set 0 for non-idempotent ops)" },
                },
                required: ["id", "type"],
              },
            },
            edges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "Source node ID" },
                  to: { type: "string", description: "Target node ID" },
                  condition: { type: "string", description: "JS expression for conditional branching" },
                },
                required: ["from", "to"],
              },
            },
            onError: { type: "string", description: "Node ID of the error handler" },
          },
          required: ["nodes", "edges"],
        },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "createFeature",
    description:
      "Create a new feature definition. A feature defines what a campaign type can do: its inputs (form fields), " +
      "outputs (metrics from the stats registry), charts (funnel-bar or breakdown-bar visualizations), " +
      "and entities (detail tabs like leads, companies, emails). " +
      "Charts must have at least 1 item. Entities must have at least 1 item. " +
      "Use GET /stats/registry to discover valid stats keys for outputs and chart steps/segments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Display name (e.g. 'Cold Email Outreach')" },
        description: { type: "string", description: "What this feature does" },
        icon: { type: "string", description: "Lucide icon name (e.g. 'envelope', 'globe', 'megaphone')" },
        category: { type: "string", description: "Feature category (e.g. 'sales', 'pr', 'discovery')" },
        channel: { type: "string", description: "Communication channel (e.g. 'email', 'phone', 'linkedin', 'database')" },
        audienceType: { type: "string", description: "Form layout type (e.g. 'cold-outreach', 'discovery')" },
        implemented: { type: "boolean", description: "Whether the feature is implemented (default true)" },
        displayOrder: { type: "integer", description: "Sort order in the UI (default 0)" },
        status: { type: "string", enum: ["active", "draft", "deprecated"], description: "Feature status (default 'active')" },
        inputs: {
          type: "array",
          description: "Input fields for the campaign creation form (min 1)",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Unique input key" },
              label: { type: "string", description: "Display label" },
              type: { type: "string", enum: ["text", "textarea", "number", "select"], description: "Input type" },
              placeholder: { type: "string", description: "Placeholder text" },
              description: { type: "string", description: "Help text for the input" },
              extractKey: { type: "string", description: "Key used for data extraction" },
              options: { type: "array", items: { type: "string" }, description: "Options for select type" },
            },
            required: ["key", "label", "type", "placeholder", "description", "extractKey"],
          },
        },
        outputs: {
          type: "array",
          description: "Output metrics — stats keys from the registry with display config (min 1)",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Stats registry key" },
              displayOrder: { type: "integer", description: "Sort order" },
              defaultSort: { type: "boolean", description: "Whether this is the default sort column" },
              sortDirection: { type: "string", enum: ["asc", "desc"], description: "Default sort direction" },
            },
            required: ["key", "displayOrder"],
          },
        },
        charts: {
          type: "array",
          description: "Chart visualizations (min 1). Two types: funnel-bar (steps, min 2) and breakdown-bar (segments, min 2)",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Unique chart key" },
              type: { type: "string", enum: ["funnel-bar", "breakdown-bar"], description: "Chart type" },
              title: { type: "string", description: "Chart title" },
              displayOrder: { type: "integer", description: "Sort order" },
              steps: {
                type: "array",
                description: "For funnel-bar: ordered steps (min 2). Each step references a stats registry key.",
                items: {
                  type: "object",
                  properties: { key: { type: "string", description: "Stats registry key" } },
                  required: ["key"],
                },
              },
              segments: {
                type: "array",
                description: "For breakdown-bar: segments (min 2). Each segment has a stats key, color, and sentiment.",
                items: {
                  type: "object",
                  properties: {
                    key: { type: "string", description: "Stats registry key" },
                    color: { type: "string", enum: ["green", "blue", "red", "gray", "orange"], description: "Segment color" },
                    sentiment: { type: "string", enum: ["positive", "neutral", "negative"], description: "Segment sentiment" },
                  },
                  required: ["key", "color", "sentiment"],
                },
              },
            },
            required: ["key", "type", "title", "displayOrder"],
          },
        },
        entities: {
          type: "array",
          description: "Entity types shown in campaign detail sidebar (e.g. ['leads', 'companies', 'emails']). Min 1.",
          items: { type: "string" },
        },
      },
      required: ["name", "description", "icon", "category", "channel", "audienceType", "inputs", "outputs", "charts", "entities"],
    },
  },
  {
    name: "versionPrompt",
    description:
      "Create a new version of a prompt template. The new version gets an auto-incremented type name " +
      "(e.g. 'cold-email' → 'cold-email-v2'). Use this when the user asks to modify a prompt template. " +
      "After versioning a prompt, you should call validateWorkflow if the workflow uses this template type.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sourceType: { type: "string", description: "Type of the prompt to version from (e.g. 'cold-email')" },
        prompt: { type: "string", description: "New prompt template text with {{variable}} placeholders" },
        variables: {
          type: "array",
          items: { type: "string" },
          description: "List of expected variable names used in the prompt",
        },
      },
      required: ["sourceType", "prompt", "variables"],
    },
  },
];

// ── Tool execution ──────────────────────────────────────────────────────────

function buildMcpHeaders(req: AuthenticatedRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const orgId = req.headers["x-org-id"] as string | undefined;
  const userId = req.headers["x-user-id"] as string | undefined;
  const runId = req.headers["x-run-id"] as string | undefined;
  if (orgId) headers["x-org-id"] = orgId;
  if (userId) headers["x-user-id"] = userId;
  if (runId) headers["x-run-id"] = runId;
  return headers;
}

type ToolArgs = Record<string, unknown>;

async function executeGetWorkflowDetails(args: ToolArgs, headers: Record<string, string>): Promise<unknown> {
  const { workflowId } = args as { workflowId: string };
  return callExternalService(externalServices.workflow, `/workflows/${workflowId}`, { headers });
}

async function executeGetPrompt(args: ToolArgs, headers: Record<string, string>): Promise<unknown> {
  const { type } = args as { type: string };
  return callExternalService(externalServices.emailgen, `/prompts?type=${encodeURIComponent(type)}`, { headers });
}

async function executeValidateWorkflow(args: ToolArgs, headers: Record<string, string>): Promise<unknown> {
  const { workflowId } = args as { workflowId: string };
  return callExternalService(externalServices.workflow, `/workflows/${workflowId}/validate`, {
    method: "POST",
    headers,
  });
}

async function executeUpdateWorkflow(args: ToolArgs, headers: Record<string, string>): Promise<unknown> {
  const { workflowId, ...body } = args as { workflowId: string; [k: string]: unknown };
  return callExternalService(externalServices.workflow, `/workflows/${workflowId}`, {
    method: "PUT",
    headers,
    body,
  });
}

async function executeCreateFeature(args: ToolArgs, headers: Record<string, string>): Promise<unknown> {
  return callExternalService(externalServices.features, "/features", {
    method: "POST",
    headers,
    body: args,
  });
}

async function executeVersionPrompt(args: ToolArgs, headers: Record<string, string>): Promise<unknown> {
  const { sourceType, prompt, variables } = args as { sourceType: string; prompt: string; variables: string[] };
  return callExternalService(externalServices.emailgen, "/prompts", {
    method: "PUT",
    headers,
    body: { sourceType, prompt, variables },
  });
}

const TOOL_EXECUTORS: Record<string, (args: ToolArgs, headers: Record<string, string>) => Promise<unknown>> = {
  getWorkflowDetails: executeGetWorkflowDetails,
  getPrompt: executeGetPrompt,
  validateWorkflow: executeValidateWorkflow,
  updateWorkflow: executeUpdateWorkflow,
  createFeature: executeCreateFeature,
  versionPrompt: executeVersionPrompt,
};

// ── JSON-RPC helpers ────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

function jsonRpcResponse(id: string | number | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id: string | number | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

// ── MCP endpoint ────────────────────────────────────────────────────────────

/**
 * POST /internal/mcp-tools
 * MCP Streamable HTTP endpoint — handles JSON-RPC 2.0 requests.
 * Called by chat-service for tool discovery and execution.
 * Auth: X-API-Key (ADMIN_DISTRIBUTE_API_KEY).
 * Identity headers (x-org-id, x-user-id, x-run-id) forwarded to downstream services.
 */
router.post("/mcp-tools", authenticatePlatform, async (req: AuthenticatedRequest, res) => {
  const rpc = req.body as JsonRpcRequest;

  if (!rpc || rpc.jsonrpc !== "2.0" || !rpc.method) {
    return res.status(400).json(jsonRpcError(rpc?.id, -32600, "Invalid JSON-RPC request"));
  }

  try {
    switch (rpc.method) {
      case "initialize": {
        return res.json(
          jsonRpcResponse(rpc.id, {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "api-service-mcp-tools", version: "1.0.0" },
          }),
        );
      }

      case "tools/list": {
        return res.json(jsonRpcResponse(rpc.id, { tools: MCP_TOOLS }));
      }

      case "tools/call": {
        const params = rpc.params as { name?: string; arguments?: ToolArgs } | undefined;
        const toolName = params?.name;
        const toolArgs = params?.arguments ?? {};

        if (!toolName) {
          return res.json(jsonRpcError(rpc.id, -32602, "Missing tool name in params.name"));
        }

        const executor = TOOL_EXECUTORS[toolName];
        if (!executor) {
          return res.json(jsonRpcError(rpc.id, -32602, `Unknown tool: ${toolName}`));
        }

        const headers = buildMcpHeaders(req);

        try {
          const result = await executor(toolArgs, headers);
          return res.json(
            jsonRpcResponse(rpc.id, {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            }),
          );
        } catch (err: any) {
          return res.json(
            jsonRpcResponse(rpc.id, {
              isError: true,
              content: [{ type: "text", text: err.message || "Tool execution failed" }],
            }),
          );
        }
      }

      default: {
        return res.json(jsonRpcError(rpc.id, -32601, `Method not found: ${rpc.method}`));
      }
    }
  } catch (error: any) {
    console.error("[mcp-tools] Unhandled error:", error.message);
    return res.status(500).json(jsonRpcError(rpc.id, -32603, "Internal error"));
  }
});

export default router;
