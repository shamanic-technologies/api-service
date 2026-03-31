import { z } from "zod";
import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);
export const registry = new OpenAPIRegistry();

// ---------------------------------------------------------------------------
// Security schemes
// ---------------------------------------------------------------------------
registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description:
    "Bearer token authentication.\n\n" +
    "Use an API key (`distrib.usr_*`) as your Bearer token. " +
    "Create one via `POST /v1/api-keys` or in the dashboard.\n\n" +
    "Your key carries your org and user identity. No extra headers needed.",
});

const authed: Record<string, string[]>[] = [{ bearerAuth: [] }];

registry.registerComponent("securitySchemes", "apiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "X-API-Key",
  description:
    "Platform API key for internal/admin operations.\n\n" +
    "Used for cold-start operations (e.g. template deployment) " +
    "where no user session exists.",
});

const platformAuth: Record<string, string[]>[] = [{ apiKeyAuth: [] }];

// ---------------------------------------------------------------------------
// Common schemas
// ---------------------------------------------------------------------------
export const ErrorResponseSchema = z
  .object({ error: z.string().describe("Error message") })
  .openapi("ErrorResponse");

const errorContent = {
  "application/json": { schema: ErrorResponseSchema },
};

const CampaignIdParam = z.object({
  id: z.string().describe("Campaign ID"),
});

const BrandIdParam = z.object({
  id: z.string().describe("Brand ID"),
});

// ===================================================================
// HEALTH
// ===================================================================

registry.registerPath({
  method: "get",
  path: "/",
  tags: ["Health"],
  summary: "API info",
  description: "Returns API name, version, and docs URL",
  responses: {
    200: {
      description: "API information",
      content: {
        "application/json": {
          schema: z
            .object({
              name: z.string(),
              version: z.string(),
              docs: z.string(),
            })
            .openapi("ApiInfoResponse"),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check",
  description: "Returns service health status",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: z
            .object({
              status: z.string(),
              service: z.string(),
              version: z.string(),
            })
            .openapi("HealthResponse"),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/debug/config",
  tags: ["Health"],
  summary: "Debug configuration",
  description: "Returns debug info about external service configuration",
  responses: {
    200: { description: "Debug configuration data" },
  },
});

registry.registerPath({
  method: "get",
  path: "/openapi.json",
  tags: ["Health"],
  summary: "OpenAPI specification",
  description: "Returns the OpenAPI 3.0 JSON spec for this service",
  responses: {
    200: { description: "OpenAPI 3.0 specification" },
    404: { description: "Spec not generated yet", content: errorContent },
  },
});

// ===================================================================
// WORKFLOW RANKED & BEST (public + authenticated)
// ===================================================================

const rankedQueryParams = z.object({
  objective: z.string().optional().openapi({ example: "replied" }).describe("Stats key to rank by (e.g. 'replied', 'clicked', 'leads_found', 'outlets_found'). Dynamically resolved from the feature's declared outputs. If omitted, featureSlug or featureDynastySlug is required to auto-resolve the ranking metric."),
  limit: z.string().optional().openapi({ example: "10" }).describe("Max results (default 10, max 100)"),
  groupBy: z.string().optional().openapi({ example: "feature" }).describe("'feature' to group by featureSlug, 'brand' to group by brand"),
  brandId: z.string().optional().openapi({ example: "brand-uuid-123" }).describe("Filter by brand ID"),
  featureSlug: z.string().optional().openapi({ example: "pr-cold-email-outreach-v3" }).describe("Filter by exact versioned feature slug"),
  featureDynastySlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature dynasty slug (resolves to all versioned slugs in the lineage)"),
});

const bestQueryParams = z.object({
  by: z.string().optional().openapi({ example: "workflow" }).describe("'workflow' (default) or 'brand' — hero records by workflow or by brand"),
  objective: z.string().optional().openapi({ example: "replied" }).describe("Stats key to optimize for (e.g. 'replied', 'clicked', 'leads_found'). Dynamically resolved from the feature's declared outputs if omitted."),
  featureSlug: z.string().optional().openapi({ example: "pr-cold-email-outreach-v3" }).describe("Filter by exact versioned feature slug. Required if objective is not provided."),
  featureDynastySlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature dynasty slug (resolves to all versioned slugs in the lineage). Required if objective is not provided."),
});

// -- Workflow response schemas (mirroring workflow-service) --

const WorkflowEmailStatsSchema = z
  .object({
    sent: z.number().describe("Total emails sent"),
    delivered: z.number().describe("Total emails delivered"),
    opened: z.number().describe("Total emails opened"),
    clicked: z.number().describe("Total link clicks"),
    replied: z.number().describe("Total replies received"),
    bounced: z.number().describe("Total emails bounced"),
    unsubscribed: z.number().describe("Total unsubscribes"),
    recipients: z.number().describe("Total unique recipients"),
  })
  .openapi("WorkflowEmailStats");

const WorkflowMetadataSchema = z
  .object({
    id: z.string().describe("Workflow ID"),
    slug: z.string().describe("Unique technical identifier. Use this to execute via /workflows/by-slug/{slug}/execute"),
    name: z.string().describe("Workflow name"),
    displayName: z.string().nullable().describe("Stable display name for the workflow family"),
    dynastyName: z.string().describe("Stable name for the lineage. Constant across all versions of a dynasty"),
    dynastySlug: z.string().describe("Stable slug for the lineage. Use as key for dynasty-level lookups and stats grouping"),
    version: z.number().int().describe("Version number within the dynasty. Starts at 1"),
    createdForBrandId: z.string().nullable().describe("Brand ID that created this workflow"),
    category: z.string().optional().describe("Workflow category (e.g. 'sales', 'pr')"),
    channel: z.string().optional().describe("Communication channel (e.g. 'email')"),
    audienceType: z.string().optional().describe("Audience type (e.g. 'cold-outreach')"),
    featureSlug: z.string().describe("Feature slug this workflow belongs to (e.g. 'pr-cold-email-outreach')"),
    signature: z.string().describe("SHA-256 hash of the canonical DAG"),
    signatureName: z.string().describe("Human-readable name for this DAG variant"),
  })
  .openapi("WorkflowMetadata");

const WorkflowStatsSchema = z
  .object({
    totalCostInUsdCents: z.number().describe("Total cost across all completed runs"),
    totalOutcomes: z.number().describe("Total outcome count for the ranked metric (dynamic per feature — e.g. replies, leads found, outlets found)"),
    costPerOutcome: z.number().nullable().describe("Cost per outcome in USD cents, null if no outcomes"),
    completedRuns: z.number().describe("Number of completed runs"),
    email: z.object({
      transactional: WorkflowEmailStatsSchema.describe("Aggregated transactional email stats"),
      broadcast: WorkflowEmailStatsSchema.describe("Aggregated broadcast email stats"),
    }).optional().describe("Email engagement stats aggregated across runs. Present for email-based features."),
  })
  .openapi("WorkflowStats");

const RankedWorkflowItemSchema = z
  .object({
    workflow: WorkflowMetadataSchema,
    dag: z.object({
      nodes: z.array(z.any()).describe("DAG nodes"),
      edges: z.array(z.any()).describe("DAG edges"),
    }).describe("The DAG definition"),
    stats: WorkflowStatsSchema,
  })
  .openapi("RankedWorkflowItem");

const PublicRankedWorkflowItemSchema = z
  .object({
    workflow: WorkflowMetadataSchema,
    stats: WorkflowStatsSchema,
  })
  .openapi("PublicRankedWorkflowItem");

const BestWorkflowRecordSchema = z
  .object({
    workflowId: z.string().describe("ID of the workflow holding the record"),
    workflowSlug: z.string().describe("Slug of the workflow"),
    workflowName: z.string().describe("Display name of the workflow"),
    createdForBrandId: z.string().nullable().describe("Brand ID that created this workflow"),
    value: z.number().describe("The record value (cost per outcome in USD cents)"),
  })
  .openapi("BestWorkflowRecord");

const rankedResponse = {
  200: {
    description: "Ranked workflows with stats",
    content: {
      "application/json": {
        schema: z.object({
          results: z.array(RankedWorkflowItemSchema).describe("Workflows ranked by performance, best first"),
        }).openapi("RankedWorkflowResponse"),
      },
    },
  },
  502: { description: "Upstream service error", content: errorContent },
};

const publicRankedResponse = {
  200: {
    description: "Ranked workflows with stats (no DAG)",
    content: {
      "application/json": {
        schema: z.object({
          results: z.array(PublicRankedWorkflowItemSchema).describe("Workflows ranked by performance, best first"),
        }).openapi("PublicRankedWorkflowResponse"),
      },
    },
  },
  502: { description: "Upstream service error", content: errorContent },
};

const bestResponse = {
  200: {
    description: "Hero records — best cost-per-outcome for each dynamic metric. Metrics are resolved from the feature's declared outputs.",
    content: {
      "application/json": {
        schema: z.object({
          best: z.record(z.string(), BestWorkflowRecordSchema.nullable()).describe("Map of metric key (e.g. 'replied', 'leads_found') to the workflow holding the best cost-per-outcome record for that metric. Null if no data."),
        }).openapi("BestWorkflowResponse", {
          example: {
            best: {
              replied: { workflowId: "wf-uuid-123", workflowSlug: "sales-email-cold-outreach-sienna-v3", workflowName: "Sales Cold Outreach (Sienna)", createdForBrandId: "brand-uuid-456", value: 42 },
              clicked: null,
            },
          },
        }),
      },
    },
  },
  400: { description: "Bad request — neither objective nor featureSlug/featureDynastySlug provided", content: errorContent },
  502: { description: "Upstream service error", content: errorContent },
};

// Public endpoints (no auth)
registry.registerPath({
  method: "get",
  path: "/v1/public/workflows/ranked",
  tags: ["Workflows"],
  summary: "Ranked workflows (public)",
  description: "Public ranked workflows by performance. Ranking metrics are dynamically resolved from the feature's declared outputs. Supports groupBy=feature and groupBy=brand. No authentication required.",
  request: { query: rankedQueryParams },
  responses: publicRankedResponse,
});

registry.registerPath({
  method: "get",
  path: "/v1/public/workflows/best",
  tags: ["Workflows"],
  summary: "Hero records (public)",
  description: "Public hero records — best cost-per-outcome for dynamic metrics resolved from the feature's outputs. Use ?by=brand for brand-level heroes. Requires objective or featureSlug/featureDynastySlug. No authentication required.",
  request: { query: bestQueryParams },
  responses: bestResponse,
});

// Authenticated endpoints
registry.registerPath({
  method: "get",
  path: "/v1/workflows/ranked",
  tags: ["Workflows"],
  summary: "Ranked workflows",
  description: "Workflows ranked by performance, scoped to the authenticated org. Ranking metrics are dynamically resolved from the feature's declared outputs. Supports groupBy=feature and groupBy=brand.",
  security: authed,
  request: { query: rankedQueryParams },
  responses: { ...rankedResponse, 401: { description: "Unauthorized", content: errorContent } },
});

registry.registerPath({
  method: "get",
  path: "/v1/workflows/best",
  tags: ["Workflows"],
  summary: "Hero records",
  description: "Best cost-per-outcome records for dynamic metrics, scoped to the authenticated org. Metrics are resolved from the feature's declared outputs. Requires objective or featureSlug/featureDynastySlug. Use ?by=brand for brand-level heroes.",
  security: authed,
  request: { query: bestQueryParams },
  responses: { ...bestResponse, 401: { description: "Unauthorized", content: errorContent } },
});

// ===================================================================
// USER
// ===================================================================

registry.registerPath({
  method: "get",
  path: "/v1/me",
  tags: ["User"],
  summary: "Get current user info",
  description: "Returns the authenticated user and organization details",
  security: authed,
  responses: {
    200: {
      description: "Current user and org info",
      content: {
        "application/json": {
          schema: z
            .object({
              userId: z.string().optional(),
              orgId: z.string().optional(),
              authType: z.enum(["user_key", "admin"]).optional(),
            })
            .openapi("MeResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// CAMPAIGNS
// ===================================================================

// -- Request schemas --

export const CreateCampaignRequestSchema = z
  .object({
    name: z.string().describe("Campaign name"),
    workflowSlug: z.string().min(1).optional().describe("Exact versioned workflow slug (e.g. 'sales-email-cold-outreach-sienna-v3'). Use for pinning to a specific version. Provide this OR workflowDynastySlug."),
    workflowDynastySlug: z.string().min(1).optional().describe("Stable dynasty slug for the workflow lineage (e.g. 'sales-email-cold-outreach-sienna'). Campaign-service resolves to the latest version automatically. Preferred over workflowSlug for dashboard use."),
    brandUrls: z.array(z.string().min(1)).min(1).describe("Brand website URLs. First URL is the primary brand; additional URLs are secondary brands."),
    featureSlug: z.string().min(1).optional().describe("Exact versioned feature slug. Use for pinning to a specific version. Provide this OR featureDynastySlug."),
    featureDynastySlug: z.string().min(1).optional().describe("Stable dynasty slug for the feature lineage (e.g. 'pr-cold-email-outreach'). Campaign-service resolves to the latest version automatically. Preferred over featureSlug for dashboard use."),
    featureInputs: z.record(z.unknown()).describe("Opaque feature inputs. Validated by key-presence against features-service, never inspected by api-service."),
    maxBudgetDailyUsd: z.union([z.string(), z.number()]).optional().describe("Max daily budget in USD"),
    maxBudgetWeeklyUsd: z.union([z.string(), z.number()]).optional().describe("Max weekly budget in USD"),
    maxBudgetMonthlyUsd: z.union([z.string(), z.number()]).optional().describe("Max monthly budget in USD"),
    maxBudgetTotalUsd: z.union([z.string(), z.number()]).optional().describe("Max total budget in USD"),
    maxLeads: z.number().int().optional().describe("Maximum number of leads to contact"),
    endDate: z.string().optional().describe("Campaign end date"),
  })
  .refine(
    (d) => d.workflowSlug || d.workflowDynastySlug,
    { message: "Either workflowSlug or workflowDynastySlug is required", path: ["workflowSlug"] },
  )
  .refine(
    (d) => d.featureSlug || d.featureDynastySlug,
    { message: "Either featureSlug or featureDynastySlug is required", path: ["featureSlug"] },
  )
  .openapi("CreateCampaignRequest", {
    example: {
      name: "Q2 SaaS Outreach",
      workflowDynastySlug: "sales-email-cold-outreach-sienna",
      brandUrls: ["https://acme.com"],
      featureDynastySlug: "pr-cold-email-outreach",
      featureInputs: { targetAudience: "SaaS founders in the US", editorialAngle: "AI productivity tools" },
      maxBudgetTotalUsd: "500",
    },
  });

/** Known discovery workflow prefixes and their campaign types. */
export const DISCOVERY_PREFIXES: Array<{ prefix: string; type: string }> = [
  { prefix: "outlets-database-discovery-", type: "outlets-database-discovery" },
  { prefix: "journalists-database-discovery-", type: "journalists-database-discovery" },
];

export function isDiscoveryWorkflow(workflowSlug: string): boolean {
  return DISCOVERY_PREFIXES.some((d) => workflowSlug.startsWith(d.prefix));
}

export function deriveCampaignType(workflowSlug: string): string {
  const match = DISCOVERY_PREFIXES.find((d) => workflowSlug.startsWith(d.prefix));
  return match ? match.type : "cold-email-outreach";
}

// -- Common schemas --

const ErrorSummarySchema = z
  .object({
    failedStep: z.string().describe("Which DAG step failed (e.g. 'fetch_lead', 'generate_email')"),
    message: z.string().describe("Cleaned error message without stack traces"),
    rootCause: z.string().describe("User-friendly root cause (e.g. 'billing-service unavailable')"),
  })
  .openapi("ErrorSummary");

const RunCostDataSchema = z
  .object({
    status: z.string().describe("Run status (e.g. completed, failed)"),
    startedAt: z.string().nullable().describe("ISO timestamp when the run started"),
    completedAt: z.string().nullable().describe("ISO timestamp when the run completed"),
    totalCostInUsdCents: z.string().nullable().describe("Total cost in USD cents"),
    costs: z
      .array(
        z.object({
          costName: z.string(),
          totalCostInUsdCents: z.string(),
          actualCostInUsdCents: z.string(),
          provisionedCostInUsdCents: z.string(),
          quantity: z.number(),
        }),
      )
      .describe("Per-cost-name breakdown"),
    serviceName: z.string().nullable(),
    taskName: z.string().nullable(),
    error: z.string().optional().describe("Raw error message (for debugging). Only present on failed runs."),
    errorSummary: ErrorSummarySchema.optional().describe(
      "Structured error summary for failed runs. Contains a user-friendly rootCause, the failedStep, and a cleaned message. Only present when status is 'failed'."
    ),
    descendantRuns: z.array(z.unknown()).describe("Child runs"),
  })
  .openapi("RunCostData");

// -- Response schemas --

const CampaignSchema = z
  .object({
    id: z.string().describe("Campaign ID"),
    orgId: z.string().describe("Organization ID"),
    createdByUserId: z.string().nullable().describe("User who created the campaign"),
    name: z.string().describe("Campaign name"),
    workflowSlug: z.string().describe("Exact versioned workflow slug used for execution"),
    workflowDynastySlug: z.string().nullable().describe("Stable dynasty slug for the workflow lineage (unversioned)"),
    brandUrls: z.array(z.string()).nullable().describe("Brand website URLs"),
    brandIds: z.array(z.string()).describe("Brand IDs"),
    featureSlug: z.string().nullable().describe("Exact versioned feature slug for tracking"),
    featureDynastySlug: z.string().nullable().describe("Stable dynasty slug for the feature lineage (unversioned)"),
    featureInputs: z.record(z.unknown()).nullable().describe("Free-form JSONB inputs for the feature"),
    maxBudgetDailyUsd: z.string().nullable().describe("Max daily budget in USD"),
    maxBudgetWeeklyUsd: z.string().nullable().describe("Max weekly budget in USD"),
    maxBudgetMonthlyUsd: z.string().nullable().describe("Max monthly budget in USD"),
    maxBudgetTotalUsd: z.string().nullable().describe("Max total budget in USD"),
    maxLeads: z.number().nullable().describe("Maximum number of leads"),
    startDate: z.string().nullable().describe("Campaign start date"),
    endDate: z.string().nullable().describe("Campaign end date"),
    status: z.string().describe("Campaign status (e.g. 'active', 'stopped')"),
    toResumeAt: z.string().nullable().describe("Scheduled resume time"),
    notifyFrequency: z.string().nullable().describe("Notification frequency"),
    notifyChannel: z.string().nullable().describe("Notification channel"),
    notifyDestination: z.string().nullable().describe("Notification destination"),
    createdAt: z.string().describe("ISO timestamp"),
    updatedAt: z.string().describe("ISO timestamp"),
  })
  .openapi("Campaign");

// -- Paths --

registry.registerPath({
  method: "get",
  path: "/v1/campaigns",
  tags: ["Campaigns"],
  summary: "List campaigns",
  description:
    "List all campaigns for the organization. Supports filtering by brandId, status, and slug params. " +
    "Use workflowDynastySlug/featureDynastySlug to filter by lineage (matches all versions), or workflowSlug/featureSlug for exact version match.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().optional().openapi({ example: "brand-uuid-123" }).describe("Filter by brand ID"),
      status: z.string().optional().openapi({ example: "active" }).describe("Filter by status (e.g. 'active', 'stopped', 'all')"),
      workflowSlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-sienna-v3" }).describe("Filter by exact versioned workflow slug"),
      workflowDynastySlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-sienna" }).describe("Filter by workflow dynasty slug (matches all versions in the lineage)"),
      featureSlug: z.string().optional().openapi({ example: "pr-cold-email-outreach-v3" }).describe("Filter by exact versioned feature slug"),
      featureDynastySlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature dynasty slug (matches all versions in the lineage)"),
    }),
  },
  responses: {
    200: {
      description: "List of campaigns",
      content: {
        "application/json": {
          schema: z.object({
            campaigns: z.array(CampaignSchema),
          }).openapi("CampaignListResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/campaigns",
  tags: ["Campaigns"],
  summary: "Create a campaign",
  description:
    "Create a new campaign. Requires feature inputs and at least one of featureSlug/featureDynastySlug plus one of workflowSlug/workflowDynastySlug.\n\n" +
    "Use `workflowDynastySlug`/`featureDynastySlug` (preferred) to let campaign-service resolve to the latest version automatically. " +
    "Use `workflowSlug`/`featureSlug` only to pin to a specific version. " +
    "Feature inputs are validated by key-presence against features-service (api-service never inspects values).",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: CreateCampaignRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Created campaign",
      content: {
        "application/json": {
          schema: z.object({ campaign: CampaignSchema }).openapi("CreateCampaignResponse"),
        },
      },
    },
    400: {
      description: "Validation error.",
      content: errorContent,
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/campaigns/{id}",
  tags: ["Campaigns"],
  summary: "Get a campaign",
  description: "Get a specific campaign by ID",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "Campaign data",
      content: {
        "application/json": {
          schema: z.object({ campaign: CampaignSchema }).openapi("GetCampaignResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/campaigns/{id}",
  tags: ["Campaigns"],
  summary: "Update a campaign",
  description: "Update campaign fields (name, settings, etc.)",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "Updated campaign",
      content: {
        "application/json": {
          schema: z.object({ campaign: CampaignSchema }).openapi("UpdateCampaignResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/campaigns/{id}/stop",
  tags: ["Campaigns"],
  summary: "Stop a campaign",
  description: "Stop a running campaign",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "Stopped campaign",
      content: {
        "application/json": {
          schema: z.object({ campaign: CampaignSchema }).openapi("StopCampaignResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/campaigns/{id}/runs",
  tags: ["Campaigns"],
  summary: "Get campaign runs",
  description: "Get execution history/runs for a campaign",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "Campaign runs list",
      content: {
        "application/json": {
          schema: z.object({
            runs: z.array(RunCostDataSchema),
          }).openapi("CampaignRunsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/campaigns/{id}/stats",
  tags: ["Campaigns"],
  summary: "Get campaign stats",
  description:
    "Get campaign statistics (leads served/buffered/skipped, apollo metrics, emails sent/opened/clicked/replied, etc.)",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "Aggregated campaign statistics",
      content: {
        "application/json": {
          schema: z
            .object({
              campaignId: z.string(),
              leadsServed: z.number(),
              leadsContacted: z.number().describe("Count of unique leads that received at least one email"),
              leadsBuffered: z.number(),
              leadsSkipped: z.number(),
              apollo: z.object({
                enrichedLeadsCount: z.number(),
                searchCount: z.number(),
                fetchedPeopleCount: z.number(),
                totalMatchingPeople: z.number(),
              }).optional(),
              emailsGenerated: z.number(),
              totalCostUsd: z.number().optional(),
              emailsContacted: z.number().describe("Leads successfully submitted to email provider (immediate)"),
              emailsSent: z.number().describe("Emails confirmed sent by provider (from webhook)"),
              emailsDelivered: z.number().optional().describe("Emails confirmed delivered (from webhook)"),
              emailsOpened: z.number(),
              emailsClicked: z.number(),
              emailsReplied: z.number(),
              emailsBounced: z.number(),
              repliesWillingToMeet: z.number().optional(),
              repliesInterested: z.number().optional(),
              repliesNotInterested: z.number().optional(),
              repliesOutOfOffice: z.number().optional(),
              repliesUnsubscribe: z.number().optional(),
              totalCostInUsdCents: z.string().nullable().optional().describe("Total cost from campaign-service budget tracking"),
              costBreakdown: z.array(z.object({
                costName: z.string(),
                totalCostInUsdCents: z.string(),
                actualCostInUsdCents: z.string(),
                provisionedCostInUsdCents: z.string(),
                totalQuantity: z.string(),
              })).optional().describe("Per-cost-name breakdown from runs-service"),
            })
            .openapi("CampaignStatsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/campaigns/stats",
  tags: ["Campaigns"],
  summary: "Get stats for all campaigns (grouped)",
  description:
    "Aggregates stats from email-gateway, lead-service, content-generation, and runs-service " +
    "using groupBy=campaignId. Returns one entry per campaign. " +
    "Supports filtering by brandId, workflowSlug, featureSlug, workflowDynastySlug, or featureDynastySlug. " +
    "Replaces the old POST /v1/campaigns/stats/batch endpoint.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().optional().describe("Filter by brand ID"),
      workflowSlug: z.string().optional().describe("Filter by exact workflow slug"),
      featureSlug: z.string().optional().describe("Filter by exact feature slug"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
      featureDynastySlug: z.string().optional().describe("Filter by feature dynasty slug (resolved to all versioned slugs)"),
    }),
  },
  responses: {
    200: {
      description: "Per-campaign aggregated statistics",
      content: {
        "application/json": {
          schema: z
            .object({
              campaigns: z.array(
                z.object({
                  campaignId: z.string(),
                  leadsServed: z.number(),
                  leadsContacted: z.number().describe("Count of unique leads that received at least one email"),
                  leadsBuffered: z.number(),
                  leadsSkipped: z.number(),
                  emailsGenerated: z.number(),
                  emailsContacted: z.number().describe("Leads successfully submitted to email provider (immediate)"),
                  emailsSent: z.number().describe("Emails confirmed sent by provider (from webhook)"),
                  emailsDelivered: z.number().describe("Emails confirmed delivered (from webhook)"),
                  emailsOpened: z.number(),
                  emailsClicked: z.number(),
                  emailsReplied: z.number(),
                  emailsBounced: z.number(),
                  repliesWillingToMeet: z.number(),
                  repliesInterested: z.number(),
                  repliesNotInterested: z.number(),
                  repliesOutOfOffice: z.number(),
                  repliesUnsubscribe: z.number(),
                  totalCostInUsdCents: z.string().nullable(),
                  runCount: z.number(),
                }),
              ),
            })
            .openapi("CampaignsBatchStatsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// RunCostDataSchema is defined above (before campaigns section)

registry.registerPath({
  method: "get",
  path: "/v1/campaigns/{id}/leads",
  tags: ["Campaigns"],
  summary: "Get campaign leads",
  description:
    "Get all leads for a campaign with enrichment cost data",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "Campaign leads with enrichment run data",
      content: {
        "application/json": {
          schema: z
            .object({
              leads: z.array(
                z.object({
                  id: z.string(),
                  leadId: z.string().nullable().describe("Lead UUID for cross-referencing with delivery status"),
                  email: z.string().describe("Recipient email address"),
                  namespace: z.string().nullable().describe("Lead source (e.g. 'apollo', 'journalist')"),
                  apolloPersonId: z.string().nullable().describe("Apollo person ID, or null if lead is not from Apollo"),
                  journalistId: z.string().nullable().describe("Journalist ID from journalists-service, or null if lead is not a journalist"),
                  outletId: z.string().nullable().describe("Outlet ID, or null if lead is not a journalist"),
                  firstName: z.string().nullable(),
                  lastName: z.string().nullable(),
                  emailStatus: z.string().nullable(),
                  title: z.string().nullable(),
                  organizationName: z.string().nullable(),
                  organizationDomain: z.string().nullable().describe("Company domain from enrichment"),
                  organizationLogoUrl: z.string().nullable().describe("Company logo URL from enrichment"),
                  organizationIndustry: z.string().nullable(),
                  organizationSize: z.string().nullable(),
                  linkedinUrl: z.string().nullable(),
                  status: z.enum(["contacted", "served"]).describe("'contacted' if email was sent, 'served' if lead was served to workflow but not yet contacted"),
                  contacted: z.boolean().describe("Whether the lead has been contacted (email sent)"),
                  delivered: z.boolean().describe("Whether the email was delivered"),
                  bounced: z.boolean().describe("Whether the email bounced"),
                  replied: z.boolean().describe("Whether the lead replied"),
                  createdAt: z.string().nullable().describe("ISO timestamp (from lead-service servedAt)"),
                  enrichmentRunId: z.string().nullable(),
                  enrichmentRun: RunCostDataSchema.nullable().describe("Enrichment run cost data, null if no run"),
                }),
              ),
            })
            .openapi("CampaignLeadsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/campaigns/{id}/leads/status",
  tags: ["Campaigns"],
  summary: "Get per-lead delivery status",
  description:
    "Returns delivery status (contacted, delivered, bounced, replied) for each served lead in a campaign. Proxies to lead-service GET /leads/status.",
  security: authed,
  request: {
    params: CampaignIdParam,
    query: z.object({
      brandId: z.string().optional().describe("Optional brand ID filter"),
    }),
  },
  responses: {
    200: {
      description: "Per-lead delivery statuses",
      content: {
        "application/json": {
          schema: z
            .object({
              statuses: z.array(
                z.object({
                  leadId: z.string().describe("Lead UUID"),
                  email: z.string().describe("Recipient email"),
                  contacted: z.boolean().describe("Whether the lead has been contacted"),
                  delivered: z.boolean().describe("Whether the email was delivered"),
                  bounced: z.boolean().describe("Whether the email bounced"),
                  replied: z.boolean().describe("Whether the lead replied"),
                  lastDeliveredAt: z.string().nullable().describe("ISO timestamp of last delivery"),
                }),
              ),
            })
            .openapi("CampaignLeadsStatusResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/campaigns/{id}/emails",
  tags: ["Campaigns"],
  summary: "Get campaign emails",
  description:
    "Get all generated emails for a campaign across all runs, with generation cost data",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "Campaign emails with generation run data",
      content: {
        "application/json": {
          schema: z
            .object({
              emails: z.array(
                z.object({
                  id: z.string().describe("Generation ID"),
                  campaignId: z.string(),
                  subject: z.string().nullable().describe("Email subject line"),
                  bodyHtml: z.string().nullable().describe("Email body as HTML"),
                  bodyText: z.string().nullable().describe("Email body as plain text"),
                  sequence: z.number().nullable().describe("Sequence number in the campaign"),
                  leadFirstName: z.string().nullable(),
                  leadLastName: z.string().nullable(),
                  leadCompany: z.string().nullable(),
                  leadOrganizationDomain: z.string().nullable().describe("Company domain from lead enrichment"),
                  leadTitle: z.string().nullable(),
                  leadIndustry: z.string().nullable(),
                  clientCompanyName: z.string().nullable(),
                  generationRunId: z.string().nullable(),
                  createdAt: z.string().describe("ISO timestamp"),
                  generationRun: RunCostDataSchema.nullable().describe("Generation run cost data, null if no run"),
                }),
              ),
            })
            .openapi("CampaignEmailsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/campaigns/{id}/outlets",
  tags: ["Campaigns"],
  summary: "Get campaign outlets",
  description:
    "Get discovered outlets for a campaign (proxied from outlet-service)",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "List of outlets discovered for the campaign",
      content: {
        "application/json": {
          schema: z
            .object({
              outlets: z.array(
                z.object({
                  id: z.string().optional(),
                  outletName: z.string().nullable(),
                  outletUrl: z.string().nullable(),
                  outletDomain: z.string().nullable(),
                  relevanceScore: z.number().nullable(),
                  whyRelevant: z.string().nullable(),
                  outletStatus: z.string().nullable().describe("Campaign-level status: open, ended, or denied"),
                }),
              ),
            })
            .openapi("CampaignOutletsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/campaigns/{id}/journalists",
  tags: ["Campaigns"],
  summary: "Get campaign journalists",
  description:
    "Get discovered journalists for a campaign. Resolves journalists for each outlet via journalist-service.",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "List of journalists discovered for the campaign",
      content: {
        "application/json": {
          schema: z
            .object({
              journalists: z.array(
                z.object({
                  id: z.string().uuid(),
                  outletId: z.string().uuid(),
                  outletName: z.string().describe("Resolved outlet name"),
                  outletDomain: z.string().nullable().describe("Resolved outlet domain (e.g. techcrunch.com)"),
                  journalistName: z.string(),
                  firstName: z.string(),
                  lastName: z.string(),
                  entityType: z.enum(["individual", "organization"]),
                  relevanceScore: z.number().min(0).max(100),
                  whyRelevant: z.string(),
                  whyNotRelevant: z.string(),
                  articleUrls: z.array(z.string()),
                }),
              ),
            })
            .openapi("CampaignJournalistsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// OUTLETS
// ===================================================================

const OutletIdParam = z.object({
  id: z.string().uuid().openapi({ description: "Outlet ID" }),
});

registry.registerPath({
  method: "get",
  path: "/v1/outlets",
  tags: ["Outlets"],
  summary: "List outlets with filters",
  security: authed,
  request: {
    query: z.object({
      campaignId: z.string().uuid().optional(),
      brandId: z.string().uuid().optional(),
      status: z.enum(["open", "ended", "denied"]).optional(),
      runId: z.string().uuid().optional().openapi({ description: "Filter outlets by discovery run ID" }),
      limit: z.coerce.number().int().optional().default(100),
      offset: z.coerce.number().int().optional().default(0),
    }),
  },
  responses: {
    200: { description: "List of outlets" },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/outlets",
  tags: ["Outlets"],
  summary: "Create outlet (upsert by outlet_url)",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              outletName: z.string().min(1),
              outletUrl: z.string().url(),
              outletDomain: z.string().min(1),
              campaignId: z.string().uuid(),
              brandId: z.string().uuid(),
              whyRelevant: z.string(),
              whyNotRelevant: z.string(),
              relevanceScore: z.number().min(0).max(100),
              overallRelevance: z.string().optional(),
              relevanceRationale: z.string().optional(),
              status: z.enum(["open", "ended", "denied"]).optional().default("open"),
              workflowSlug: z.string().optional(),
            })
            .openapi("CreateOutletRequest"),
        },
      },
    },
  },
  responses: {
    201: { description: "Outlet created" },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/outlets/stats",
  tags: ["Outlets"],
  summary: "Aggregated outlet discovery metrics",
  description: "Returns outlet discovery stats. Supports filtering by brandId, campaignId, workflowSlug, featureSlug, workflowDynastySlug, featureDynastySlug and optional groupBy.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().uuid().optional(),
      campaignId: z.string().uuid().optional(),
      workflowSlug: z.string().optional(),
      workflowSlugs: z.string().optional().describe("Filter by multiple workflow slugs (comma-separated). Takes priority over workflowSlug."),
      featureSlug: z.string().optional().describe("Filter by exact feature slug"),
      featureSlugs: z.string().optional().describe("Filter by multiple feature slugs (comma-separated). Takes priority over featureSlug."),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
      featureDynastySlug: z.string().optional().describe("Filter by feature dynasty slug (resolved to all versioned slugs)"),
      groupBy: z.enum(["workflowSlug", "featureSlug", "brandId", "campaignId", "workflowDynastySlug", "featureDynastySlug"]).optional(),
    }),
  },
  responses: {
    200: { description: "Stats (flat or grouped)" },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/outlets/stats/costs",
  tags: ["Outlets"],
  summary: "Get outlet discovery cost stats",
  description:
    "Returns cost statistics for outlet discovery runs. Supports filtering by brandId, campaignId, " +
    "and grouping by outletId or runId. When grouped by outletId, cost = discovery run cost / number of outlets " +
    "in that run (summed across multiple runs). When grouped by runId, returns totalCostInUsdCents, outletCount, " +
    "and runCount per run. Without groupBy, returns flat totals across all discovery runs. " +
    "All costs are org-scoped — each org only sees costs from their own discovery runs.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().uuid().optional().describe("Filter by brand ID"),
      campaignId: z.string().uuid().optional().describe("Filter by campaign ID"),
      groupBy: z.enum(["outletId", "runId"]).optional().describe("Group results by outletId or runId"),
    }),
  },
  responses: {
    200: {
      description: "Cost statistics",
      content: {
        "application/json": {
          schema: z
            .object({
              groups: z.array(
                z.object({
                  dimensions: z.record(z.string()).describe("Grouping dimensions (e.g. outletId, runId)"),
                  totalCostInUsdCents: z.number().describe("Total cost (actual + provisioned) in USD cents"),
                  actualCostInUsdCents: z.number().describe("Actual billed cost in USD cents"),
                  provisionedCostInUsdCents: z.number().describe("Provisioned (estimated) cost in USD cents"),
                  runCount: z.number().int().describe("Number of discovery runs contributing to this group"),
                }),
              ),
            })
            .openapi("OutletStatsCostsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/outlets/bulk",
  tags: ["Outlets"],
  summary: "Bulk upsert outlets",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              outlets: z.array(
                z.object({
                  outletName: z.string().min(1),
                  outletUrl: z.string().url(),
                  outletDomain: z.string().min(1),
                  campaignId: z.string().uuid(),
                  brandId: z.string().uuid(),
                  whyRelevant: z.string(),
                  whyNotRelevant: z.string(),
                  relevanceScore: z.number().min(0).max(100),
                  overallRelevance: z.string().optional(),
                  relevanceRationale: z.string().optional(),
                  status: z.enum(["open", "ended", "denied"]).optional().default("open"),
                  workflowSlug: z.string().optional(),
                }),
              ),
            })
            .openapi("BulkCreateOutletsRequest"),
        },
      },
    },
  },
  responses: {
    201: { description: "Outlets created" },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/outlets/search",
  tags: ["Outlets"],
  summary: "Search outlets by name/url",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              query: z.string().min(1),
              campaignId: z.string().uuid().optional(),
              limit: z.number().int().min(0).max(100).optional().default(20),
            })
            .openapi("SearchOutletsRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Search results" },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/outlets/discover",
  tags: ["Outlets"],
  summary: "Discover relevant outlets via Google search + LLM scoring",
  description: "Generates search queries via LLM, searches Google, scores results, and stores discovered outlets as buffered. " +
    "Creates a child run — use the returned runId to query outlets from this specific discovery run via GET /v1/outlets?runId={runId}. " +
    "Requires x-campaign-id and x-brand-id headers.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              count: z.number().int().min(1).max(200).optional().default(15).describe("Number of outlets to discover (1-200, default 15)"),
            })
            .openapi("DiscoverOutletsRequest"),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Outlets discovered and stored as buffered",
      content: {
        "application/json": {
          schema: z
            .object({
              runId: z.string().uuid().describe("Child run ID for this discovery batch"),
              discovered: z.number().int().describe("Number of outlets discovered"),
            })
            .openapi("DiscoverOutletsResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/outlets/buffer/next",
  tags: ["Outlets"],
  summary: "Get next buffered outlet",
  description: "Returns the next buffered outlet from the queue. Response includes the runId of the discovery run that originally found the outlet.",
  security: authed,
  request: {},
  responses: {
    200: {
      description: "Next buffered outlet",
      content: {
        "application/json": {
          schema: z
            .object({
              runId: z.string().uuid().describe("Discovery run ID that originally found this outlet"),
            })
            .passthrough()
            .openapi("BufferNextOutletResponse"),
        },
      },
    },
    204: { description: "No buffered outlets available" },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/outlets/{id}",
  tags: ["Outlets"],
  summary: "Get outlet by ID",
  security: authed,
  request: { params: OutletIdParam },
  responses: {
    200: { description: "Outlet found" },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Outlet not found", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/outlets/{id}",
  tags: ["Outlets"],
  summary: "Update outlet",
  security: authed,
  request: {
    params: OutletIdParam,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              outletName: z.string().min(1).optional(),
              outletUrl: z.string().url().optional(),
              outletDomain: z.string().min(1).optional(),
              whyRelevant: z.string().optional(),
              whyNotRelevant: z.string().optional(),
              relevanceScore: z.number().min(0).max(100).optional(),
              overallRelevance: z.string().optional(),
              relevanceRationale: z.string().optional(),
            })
            .openapi("UpdateOutletRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Outlet updated" },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Outlet not found", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/outlets/{id}/status",
  tags: ["Outlets"],
  summary: "Update outlet status",
  security: authed,
  request: {
    params: OutletIdParam,
    query: z.object({
      campaignId: z.string().uuid().describe("Campaign ID (required)"),
    }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              status: z.enum(["open", "ended", "denied"]),
              reason: z.string().optional(),
            })
            .openapi("UpdateOutletStatusRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Status updated" },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

// ===================================================================
// JOURNALISTS
// ===================================================================

registry.registerPath({
  method: "get",
  path: "/v1/journalists",
  tags: ["Journalists"],
  summary: "List journalists by brand",
  description: "Returns all discovered journalists for a given brand across all campaigns. Proxies to journalists-service GET /campaign-outlet-journalists?brand_id={brandId}. Optionally filter by runId to get journalists from a specific discovery run, or by campaignId to get journalists from a specific campaign.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().uuid().describe("Brand ID to filter journalists by"),
      runId: z.string().uuid().optional().describe("Filter journalists by discovery run ID"),
      campaignId: z.string().uuid().optional().describe("Filter journalists by campaign ID"),
    }).openapi("ListJournalistsQuery"),
  },
  responses: {
    200: {
      description: "List of journalists for the brand",
      content: {
        "application/json": {
          schema: z
            .object({
              campaignJournalists: z.array(
                z.object({
                  id: z.string().uuid(),
                  journalistId: z.string().uuid(),
                  journalistName: z.string(),
                  firstName: z.string(),
                  lastName: z.string(),
                  entityType: z.enum(["individual", "organization"]),
                  relevanceScore: z.number().nullable(),
                  whyRelevant: z.string().nullable(),
                  whyNotRelevant: z.string().nullable(),
                  articleUrls: z.array(z.string()).nullable(),
                  status: z.enum(["buffered", "claimed", "served", "contacted", "skipped"]).describe("Current status of this journalist in the campaign pipeline"),
                  runId: z.string().uuid().nullable().describe("The discovery run that created this journalist entry"),
                }).passthrough(),
              ),
            })
            .passthrough()
            .openapi("ListJournalistsResponse"),
        },
      },
    },
    400: { description: "Missing brandId", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/journalists/discover",
  tags: ["Journalists"],
  summary: "Discover relevant journalists for a brand on an outlet",
  description: "Triggers journalist discovery for a given outlet. Requires x-campaign-id and x-brand-id headers. Creates a child run, discovers journalists, and stores them as buffered. Use the returned runId to query journalists from this specific discovery run via GET /v1/journalists?runId={runId}.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              outletId: z.string().uuid(),
              maxArticles: z.number().int().min(1).max(30).optional().default(15).describe("Maximum number of articles to search (1-30, default 15)"),
            })
            .openapi("DiscoverJournalistsRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Discovery initiated — returns run ID and count of discovered journalists",
      content: {
        "application/json": {
          schema: z
            .object({
              runId: z.string().uuid().describe("Child run ID for this discovery. Use to query journalists from this run or check costs via runs-service."),
              discovered: z.number().int().describe("Number of journalists discovered and stored as buffered"),
            })
            .openapi("DiscoverJournalistsResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/journalists/discover-emails",
  tags: ["Journalists"],
  summary: "Discover journalist emails via Apollo person match",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              outletId: z.string().uuid(),
              organizationDomain: z.string().min(1),
              journalistIds: z.array(z.string().uuid()).optional(),
              brandId: z.string().uuid(),
              campaignId: z.string().uuid(),
            })
            .openapi("DiscoverEmailsRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Discovery results",
      content: {
        "application/json": {
          schema: z
            .object({
              discovered: z.number(),
              total: z.number(),
              skipped: z.number(),
              results: z.array(
                z.object({
                  journalistId: z.string().uuid(),
                  email: z.string().nullable(),
                  emailStatus: z.string().nullable(),
                  cached: z.boolean(),
                  enrichmentId: z.string(),
                }),
              ),
            })
            .openapi("DiscoverEmailsResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/journalists/buffer/next",
  tags: ["Journalists"],
  summary: "Get next buffered journalist",
  description: "Returns the next buffered journalist from the queue. Response includes the runId (child run ID) for the buffer/next call.",
  security: authed,
  request: {},
  responses: {
    200: {
      description: "Next buffered journalist",
      content: {
        "application/json": {
          schema: z
            .object({
              runId: z.string().uuid().describe("Child run ID for this buffer/next call"),
            })
            .passthrough()
            .openapi("BufferNextJournalistResponse"),
        },
      },
    },
    204: { description: "No buffered journalists available" },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/journalists/resolve",
  tags: ["Journalists"],
  summary: "Resolve journalists for a campaign+outlet",
  description: "Discovers journalists if needed, scores them, and returns results sorted by relevance. Requires x-campaign-id header.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              outletId: z.string().uuid(),
              featureInputs: z.record(z.string()).optional(),
              maxArticles: z.number().int().min(1).max(30).optional(),
            })
            .openapi("ResolveJournalistsRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolved journalists sorted by relevance score",
      content: {
        "application/json": {
          schema: z
            .object({
              journalists: z.array(
                z.object({
                  id: z.string().uuid(),
                  journalistName: z.string(),
                  firstName: z.string(),
                  lastName: z.string(),
                  entityType: z.enum(["individual", "organization"]),
                  relevanceScore: z.number().min(0).max(100),
                  whyRelevant: z.string(),
                  whyNotRelevant: z.string(),
                  articleUrls: z.array(z.string()),
                }),
              ),
              cached: z.boolean(),
            })
            .openapi("ResolveJournalistsResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

const journalistStatsQueryParams = z.object({
  orgId: z.string().uuid().optional().describe("Filter by organization ID"),
  campaignId: z.string().uuid().optional().describe("Filter by campaign ID"),
  outletId: z.string().uuid().optional().describe("Filter by outlet ID"),
  brandId: z.string().uuid().optional().describe("Filter by brand ID"),
  featureSlug: z.string().optional().describe("Filter by exact feature slug"),
  workflowSlug: z.string().optional().describe("Filter by exact workflow slug"),
  workflowSlugs: z.string().optional().describe("Comma-separated list of workflow slugs to filter by"),
  featureDynastySlug: z.string().optional().describe("Filter by feature dynasty slug — resolves to all versioned slugs"),
  workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug — resolves to all versioned slugs"),
  groupBy: z.enum(["featureSlug", "workflowSlug", "featureDynastySlug", "workflowDynastySlug"]).optional().describe("Dimension to group results by"),
});

registry.registerPath({
  method: "get",
  path: "/v1/journalists/stats",
  tags: ["Journalists"],
  summary: "Get journalist stats with dynasty-aware filtering and grouping",
  description:
    "Returns journalist counts by status (buffered, claimed, served, contacted, skipped). " +
    "Supports filtering by brand, campaign, outlet, feature/workflow slugs, and dynasty slugs. " +
    "Optional groupBy returns per-slug breakdowns.",
  security: authed,
  request: { query: journalistStatsQueryParams },
  responses: {
    200: {
      description: "Journalist stats (flat or grouped)",
      content: {
        "application/json": {
          schema: z.object({
            totalJournalists: z.number(),
            byStatus: z.record(z.number()).describe("Map of status to count (buffered, claimed, served, contacted, skipped)"),
            groupedBy: z.record(z.object({
              totalJournalists: z.number(),
              byStatus: z.record(z.number()),
            })).optional().describe("Per-slug breakdown when groupBy is specified"),
          }).openapi("JournalistStatsResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/journalists/stats/costs",
  tags: ["Journalists"],
  summary: "Get journalist discovery cost stats",
  description:
    "Returns cost statistics for journalist discovery runs. Requires brandId. " +
    "Supports optional campaignId filter and groupBy=journalistId to get per-journalist breakdowns. " +
    "Costs are fetched from runs-service via POST /v1/runs/costs/batch.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().describe("Filter by brand ID (required)"),
      campaignId: z.string().optional().describe("Filter by campaign ID"),
      groupBy: z.enum(["journalistId"]).optional().describe("Group results by journalistId"),
    }),
  },
  responses: {
    200: {
      description: "Cost statistics",
      content: {
        "application/json": {
          schema: z
            .object({
              groups: z.array(
                z.object({
                  dimensions: z.record(z.string()).describe("Grouping dimensions (e.g. journalistId)"),
                  totalCostInUsdCents: z.number(),
                  actualCostInUsdCents: z.number(),
                  provisionedCostInUsdCents: z.number(),
                  runCount: z.number(),
                }),
              ),
            })
            .openapi("JournalistStatsCostsResponse"),
        },
      },
    },
    400: { description: "Missing required brandId parameter", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

// ===================================================================
// ARTICLES (airtik) — schemas synced from articles-service openapi.json
// ===================================================================

const ArticleSchema = z
  .object({
    id: z.string().uuid().openapi({ description: "Unique article identifier", example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }),
    articleUrl: z.string().url().openapi({ description: "Canonical URL of the article", example: "https://techcrunch.com/2025/03/15/ai-funding-roundup" }),
    snippet: z.string().nullable().openapi({ description: "Short text excerpt from the article or search result" }),
    ogDescription: z.string().nullable().openapi({ description: "OpenGraph og:description meta tag value" }),
    twitterCreator: z.string().nullable().openapi({ description: "Twitter/X @handle of the article creator", example: "@johndoe" }),
    newsKeywords: z.string().nullable().openapi({ description: "Comma-separated news keywords meta tag" }),
    articlePublished: z.string().nullable().openapi({ description: "Published date from article metadata", example: "2025-03-15T10:00:00Z" }),
    articleChannel: z.string().nullable().openapi({ description: "Channel or vertical the article belongs to", example: "Technology" }),
    twitterTitle: z.string().nullable().openapi({ description: "Twitter/X card title meta tag" }),
    articleSection: z.string().nullable().openapi({ description: "Section of the publication", example: "Startups" }),
    author: z.string().nullable().openapi({ description: "Serialized author data extracted via scraping (JSON array of ExtractedAuthor objects)" }),
    ogTitle: z.string().nullable().openapi({ description: "OpenGraph og:title meta tag value", example: "AI Funding Hits Record High in Q1 2025" }),
    articleAuthor: z.string().nullable().openapi({ description: "Raw author string from article:author meta tag" }),
    twitterDescription: z.string().nullable().openapi({ description: "Twitter/X card description meta tag" }),
    articleModified: z.string().nullable().openapi({ description: "Last modified date from article metadata" }),
    createdAt: z.string().datetime().openapi({ description: "When this article record was first created" }),
    updatedAt: z.string().datetime().openapi({ description: "When this article record was last updated" }),
  })
  .openapi("Article");

const ExtractedAuthorSchema = z
  .object({
    type: z.enum(["person", "organization"]).openapi({ description: "Whether this author is a person or an organization", example: "person" }),
    firstName: z.string().openapi({ description: "First name (empty string for organizations or single-name authors)", example: "Sarah" }),
    lastName: z.string().openapi({ description: "Last name, or full name for organizations", example: "Perez" }),
  })
  .openapi("ExtractedAuthor");

const DiscoveredArticleSchema = z
  .object({
    articleId: z.string().uuid().openapi({ description: "ID of the upserted article record" }),
    articleUrl: z.string().openapi({ description: "URL of the discovered article", example: "https://techcrunch.com/2025/03/15/ai-funding-roundup" }),
    title: z.string().nullable().openapi({ description: "Article title from OpenGraph or search result" }),
    snippet: z.string().nullable().openapi({ description: "Short excerpt from the article" }),
    authors: z.array(ExtractedAuthorSchema).openapi({ description: "Authors extracted via scraping + LLM analysis" }),
    publishedAt: z.string().nullable().openapi({ description: "Publication date extracted from article metadata", example: "2025-03-15T10:00:00Z" }),
  })
  .openapi("DiscoveredArticle");

const ArticleAuthorViewSchema = z
  .object({
    articleId: z.string().uuid().openapi({ description: "Article identifier" }),
    articleUrl: z.string().openapi({ description: "Canonical URL of the article" }),
    computedTitle: z.string().nullable().openapi({ description: "Best-effort title derived from og:title, twitter:title, or snippet" }),
    computedLargestContent: z.string().nullable().openapi({ description: "Longest content field available (for display/preview)" }),
    computedAuthors: z.array(z.string()).openapi({ description: "Deduplicated list of author names extracted from all metadata sources" }),
    computedPublishedAt: z.string().nullable().openapi({ description: "Best-effort publication date from available metadata" }),
    lastActivityAt: z.string().datetime().openapi({ description: "Most recent update across all linked records" }),
    articleCreatedAt: z.string().datetime().openapi({ description: "When the article was first indexed" }),
  })
  .openapi("ArticleAuthorView");

const TopicSchema = z
  .object({
    id: z.string().uuid().openapi({ description: "Unique topic identifier" }),
    topicName: z.string().openapi({ description: "Human-readable topic name", example: "Artificial Intelligence" }),
    createdAt: z.string().datetime().openapi({ description: "When this topic was created" }),
    updatedAt: z.string().datetime().openapi({ description: "When this topic was last updated" }),
  })
  .openapi("Topic");

const ArticleDiscoverySchema = z
  .object({
    id: z.string().uuid().openapi({ description: "Unique discovery record identifier" }),
    articleId: z.string().uuid().openapi({ description: "ID of the discovered article" }),
    orgId: z.string().uuid().openapi({ description: "Organization that owns this discovery" }),
    brandId: z.string().uuid().openapi({ description: "Brand this discovery is scoped to" }),
    featureSlug: z.string().openapi({ description: "Feature that triggered this discovery", example: "press-outreach-v3" }),
    workflowSlug: z.string().nullable().openapi({ description: "Workflow that triggered this discovery" }),
    campaignId: z.string().uuid().openapi({ description: "Campaign this discovery belongs to" }),
    outletId: z.string().uuid().nullable().openapi({ description: "Outlet linked to this discovery (if from outlet discovery)" }),
    journalistId: z.string().uuid().nullable().openapi({ description: "Journalist linked to this discovery (if from journalist discovery)" }),
    topicId: z.string().uuid().nullable().openapi({ description: "Topic linked to this discovery" }),
    createdAt: z.string().datetime().openapi({ description: "When this discovery was created" }),
  })
  .openapi("ArticleDiscovery");

const DiscoveryStatsSchema = z
  .object({
    totalDiscoveries: z.number().openapi({ description: "Total number of article discoveries" }),
    uniqueArticles: z.number().openapi({ description: "Number of unique articles" }),
    uniqueOutlets: z.number().openapi({ description: "Number of unique outlets" }),
    uniqueJournalists: z.number().openapi({ description: "Number of unique journalists" }),
  })
  .openapi("DiscoveryStats");

registry.registerPath({
  method: "get",
  path: "/v1/articles",
  tags: ["Articles"],
  summary: "List articles with pagination",
  security: authed,
  request: {
    query: z.object({
      limit: z.coerce.number().int().optional(),
      offset: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of articles",
      content: {
        "application/json": {
          schema: z.object({ articles: z.array(ArticleSchema) }).openapi("ListArticlesResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/articles",
  tags: ["Articles"],
  summary: "Create or upsert an article by URL",
  description: "Inserts a new article or updates an existing one based on the articleUrl (unique key). Returns the full article record.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              articleUrl: z.string().url().openapi({ description: "Canonical URL of the article (used as upsert key)", example: "https://techcrunch.com/2025/03/15/ai-funding-roundup" }),
              snippet: z.string().optional().openapi({ description: "Short text excerpt from the article" }),
              ogDescription: z.string().optional().openapi({ description: "OpenGraph og:description meta tag" }),
              twitterCreator: z.string().optional().openapi({ description: "Twitter/X @handle of the creator" }),
              newsKeywords: z.string().optional().openapi({ description: "Comma-separated news keywords" }),
              articlePublished: z.string().optional().openapi({ description: "Published date string from metadata" }),
              articleChannel: z.string().optional().openapi({ description: "Channel or vertical" }),
              twitterTitle: z.string().optional().openapi({ description: "Twitter/X card title" }),
              articleSection: z.string().optional().openapi({ description: "Section of the publication" }),
              author: z.string().optional().openapi({ description: "Serialized author data" }),
              ogTitle: z.string().optional().openapi({ description: "OpenGraph og:title" }),
              articleAuthor: z.string().optional().openapi({ description: "Raw author string from article:author meta tag" }),
              twitterDescription: z.string().optional().openapi({ description: "Twitter/X card description" }),
              articleModified: z.string().optional().openapi({ description: "Last modified date from metadata" }),
            })
            .openapi("CreateArticleRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Article created or updated",
      content: { "application/json": { schema: ArticleSchema } },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/articles/authors",
  tags: ["Articles"],
  summary: "Articles with computed authors (v_articles_authors)",
  security: authed,
  request: {
    query: z.object({
      limit: z.coerce.number().int().optional(),
      offset: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: "Articles with computed authors view",
      content: {
        "application/json": {
          schema: z.object({ articles: z.array(ArticleAuthorViewSchema) }).openapi("ListArticleAuthorsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/articles/{id}",
  tags: ["Articles"],
  summary: "Get a single article by ID",
  security: authed,
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: "Article ID" }),
    }),
  },
  responses: {
    200: {
      description: "Article found",
      content: { "application/json": { schema: ArticleSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Article not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/articles/bulk",
  tags: ["Articles"],
  summary: "Bulk upsert articles",
  description: "Upserts multiple articles in a single transaction. Each article is matched by articleUrl.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              articles: z.array(
                z.object({
                  articleUrl: z.string().url().openapi({ description: "Canonical URL of the article (used as upsert key)", example: "https://techcrunch.com/2025/03/15/ai-funding-roundup" }),
                  snippet: z.string().optional().openapi({ description: "Short text excerpt from the article" }),
                  ogDescription: z.string().optional().openapi({ description: "OpenGraph og:description meta tag" }),
                  twitterCreator: z.string().optional().openapi({ description: "Twitter/X @handle of the creator" }),
                  newsKeywords: z.string().optional().openapi({ description: "Comma-separated news keywords" }),
                  articlePublished: z.string().optional().openapi({ description: "Published date string from metadata" }),
                  articleChannel: z.string().optional().openapi({ description: "Channel or vertical" }),
                  twitterTitle: z.string().optional().openapi({ description: "Twitter/X card title" }),
                  articleSection: z.string().optional().openapi({ description: "Section of the publication" }),
                  author: z.string().optional().openapi({ description: "Serialized author data" }),
                  ogTitle: z.string().optional().openapi({ description: "OpenGraph og:title" }),
                  articleAuthor: z.string().optional().openapi({ description: "Raw author string from article:author meta tag" }),
                  twitterDescription: z.string().optional().openapi({ description: "Twitter/X card description" }),
                  articleModified: z.string().optional().openapi({ description: "Last modified date from metadata" }),
                }),
              ).openapi({ description: "Array of articles to upsert" }),
            })
            .openapi("BulkCreateArticlesRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Articles upserted",
      content: {
        "application/json": {
          schema: z.object({ articles: z.array(ArticleSchema) }).openapi("BulkCreateArticlesResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/articles/search",
  tags: ["Articles"],
  summary: "Full-text search across article fields",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              query: z.string().min(1).openapi({ description: "Full-text search query", example: "AI funding startup" }),
              limit: z.number().int().optional().openapi({ description: "Max results to return (default 20, max 100)" }),
              offset: z.number().int().optional().openapi({ description: "Number of results to skip for pagination" }),
            })
            .openapi("SearchArticlesRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Search results",
      content: {
        "application/json": {
          schema: z.object({ articles: z.array(ArticleSchema) }).openapi("SearchArticlesResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

// ── Topics ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/v1/topics",
  tags: ["Articles"],
  summary: "List all topics",
  security: authed,
  responses: {
    200: {
      description: "List of topics",
      content: {
        "application/json": {
          schema: z.object({ topics: z.array(TopicSchema) }).openapi("ListTopicsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/topics",
  tags: ["Articles"],
  summary: "Create or upsert a topic by name",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              topicName: z.string().min(1).openapi({ description: "Topic name (used as upsert key)", example: "Artificial Intelligence" }),
            })
            .openapi("CreateTopicRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Topic created or updated",
      content: { "application/json": { schema: TopicSchema } },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/topics/bulk",
  tags: ["Articles"],
  summary: "Bulk upsert topics",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              topics: z.array(
                z.object({
                  topicName: z.string().min(1).openapi({ description: "Topic name (used as upsert key)", example: "Artificial Intelligence" }),
                }),
              ).openapi({ description: "Array of topics to upsert" }),
            })
            .openapi("BulkCreateTopicsRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Topics upserted",
      content: {
        "application/json": {
          schema: z.object({ topics: z.array(TopicSchema) }).openapi("BulkCreateTopicsResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

// ── Discoveries ─────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/v1/discoveries",
  tags: ["Articles"],
  summary: "List article discoveries with filters",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().uuid().optional().openapi({ description: "Filter by brand ID" }),
      campaignId: z.string().uuid().optional().openapi({ description: "Filter by campaign ID" }),
      outletId: z.string().uuid().optional().openapi({ description: "Filter by outlet ID" }),
      journalistId: z.string().uuid().optional().openapi({ description: "Filter by journalist ID" }),
      topicId: z.string().uuid().optional().openapi({ description: "Filter by topic ID" }),
      limit: z.coerce.number().int().optional(),
      offset: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of discoveries with their associated articles",
      content: {
        "application/json": {
          schema: z.object({
            discoveries: z.array(
              z.object({
                discovery: ArticleDiscoverySchema,
                article: ArticleSchema,
              }),
            ),
          }).openapi("ListDiscoveriesResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/discoveries",
  tags: ["Articles"],
  summary: "Link an article to a campaign context",
  description: "Creates a discovery record that links an article to a specific org/brand/campaign context. Requires x-brand-id and x-campaign-id headers. Optionally associates the discovery with an outlet, journalist, or topic.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              articleId: z.string().uuid().openapi({ description: "ID of the article to link" }),
              brandId: z.string().uuid().openapi({ description: "Brand to scope this discovery to" }),
              campaignId: z.string().uuid().openapi({ description: "Campaign to scope this discovery to" }),
              outletId: z.string().uuid().optional().openapi({ description: "Outlet to associate with this discovery" }),
              journalistId: z.string().uuid().optional().openapi({ description: "Journalist to associate with this discovery" }),
              topicId: z.string().uuid().optional().openapi({ description: "Topic to associate with this discovery" }),
            })
            .openapi("CreateDiscoveryRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Discovery created",
      content: { "application/json": { schema: ArticleDiscoverySchema } },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/discoveries/bulk",
  tags: ["Articles"],
  summary: "Bulk link articles to campaign contexts",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              discoveries: z.array(
                z.object({
                  articleId: z.string().uuid().openapi({ description: "ID of the article to link" }),
                  brandId: z.string().uuid().openapi({ description: "Brand to scope this discovery to" }),
                  campaignId: z.string().uuid().openapi({ description: "Campaign to scope this discovery to" }),
                  outletId: z.string().uuid().optional().openapi({ description: "Outlet to associate with this discovery" }),
                  journalistId: z.string().uuid().optional().openapi({ description: "Journalist to associate with this discovery" }),
                  topicId: z.string().uuid().optional().openapi({ description: "Topic to associate with this discovery" }),
                }),
              ).openapi({ description: "Array of discovery records to create" }),
            })
            .openapi("BulkCreateDiscoveriesRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Discoveries created",
      content: {
        "application/json": {
          schema: z.object({ discoveries: z.array(ArticleDiscoverySchema) }).openapi("BulkCreateDiscoveriesResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

// ── Article stats ───────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/v1/articles/stats",
  tags: ["Articles"],
  summary: "Get aggregated article discovery stats",
  description:
    "Returns aggregated discovery stats (totalDiscoveries, uniqueArticles, uniqueOutlets, uniqueJournalists). " +
    "Supports filtering by orgId, brandId, campaignId, workflowSlug, featureSlug, and dynasty slugs. " +
    "Optional groupBy returns grouped results. Dynasty slug filters resolve to all versioned slugs via the respective service.",
  security: authed,
  request: {
    query: z.object({
      orgId: z.string().uuid().optional().describe("Filter by organization ID"),
      brandId: z.string().uuid().optional().describe("Filter by brand ID"),
      campaignId: z.string().uuid().optional().describe("Filter by campaign ID"),
      workflowSlug: z.string().optional().describe("Filter by exact workflow slug"),
      featureSlug: z.string().optional().describe("Filter by exact feature slug"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
      featureDynastySlug: z.string().optional().describe("Filter by feature dynasty slug (resolved to all versioned slugs)"),
      groupBy: z.enum(["brandId", "campaignId", "workflowSlug", "featureSlug", "workflowDynastySlug", "featureDynastySlug"]).optional().describe("Group results by dimension"),
    }),
  },
  responses: {
    200: {
      description: "Aggregated stats — flat when no groupBy, grouped array when groupBy is provided",
      content: {
        "application/json": {
          schema: z.union([
            z.object({ stats: DiscoveryStatsSchema }).openapi("FlatArticleStatsResponse"),
            z.object({
              groups: z.array(z.object({ key: z.string(), stats: DiscoveryStatsSchema })),
            }).openapi("GroupedArticleStatsResponse"),
          ]).openapi("ArticleStatsResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

// ── Discovery workflows ─────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/v1/discover/outlet-articles",
  tags: ["Articles"],
  summary: "Discover recent articles from an outlet via Google News + scraping",
  description:
    "Pipeline endpoint: (1) searches Google News for recent articles from the given outlet domain, " +
    "(2) scrapes each article URL to extract authors and publication dates via LLM, " +
    "(3) upserts the articles in the database, and (4) creates discovery records scoped to the campaign " +
    "(x-brand-id, x-campaign-id headers required). Returns the discovered articles with extracted author details.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              outletDomain: z.string().min(1).openapi({ description: "Domain of the outlet (e.g. techcrunch.com)", example: "techcrunch.com" }),
              brandId: z.string().uuid().openapi({ description: "Brand to scope discoveries to" }),
              campaignId: z.string().uuid().openapi({ description: "Campaign to scope discoveries to" }),
              maxArticles: z.number().int().optional().openapi({ description: "Max articles to discover (default 10, max 20)" }),
            })
            .openapi("DiscoverOutletArticlesRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Discovered articles with extracted author details",
      content: {
        "application/json": {
          schema: z.object({ articles: z.array(DiscoveredArticleSchema) }).openapi("DiscoverOutletArticlesResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/discover/journalist-publications",
  tags: ["Articles"],
  summary: "Discover recent publications by a journalist and create scoped discoveries",
  description:
    "Pipeline endpoint: (1) searches Google News for recent articles by the given journalist (by name), " +
    "(2) scrapes each article URL to extract authors and publication dates via LLM, " +
    "(3) upserts the articles in the database, and (4) creates discovery records scoped to the campaign and journalist " +
    "(x-brand-id, x-campaign-id headers required). Ideal for enriching pitch generation with a journalist's recent work.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              journalistFirstName: z.string().min(1).openapi({ description: "Journalist first name", example: "Sarah" }),
              journalistLastName: z.string().min(1).openapi({ description: "Journalist last name", example: "Perez" }),
              outletDomain: z.string().min(1).openapi({ description: "Outlet domain to scope the Google News search via site: filter (e.g. 'techcrunch.com')", example: "techcrunch.com" }),
              maxResults: z.number().int().optional().openapi({ description: "Max publications to find (default 10, max 20)" }),
            })
            .openapi("DiscoverJournalistPublicationsRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Discovered publications with extracted author details",
      content: {
        "application/json": {
          schema: z.object({ articles: z.array(DiscoveredArticleSchema) }).openapi("DiscoverJournalistPublicationsResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

// ===================================================================
// PROVIDER KEYS
// ===================================================================

export const UpsertKeyRequestSchema = z
  .object({
    provider: z
      .string()
      .describe("Provider name (e.g. openai, anthropic, stripe)"),
    apiKey: z.string().describe("The API key value"),
  })
  .openapi("UpsertKeyRequest");

const OrgKeyItemSchema = z
  .object({
    provider: z.string().describe("Provider name (e.g. openai, anthropic)"),
    maskedKey: z.string().describe("Masked API key value (e.g. sk-...abc)"),
    createdAt: z.string().nullable().describe("ISO timestamp"),
    updatedAt: z.string().nullable().describe("ISO timestamp"),
  })
  .openapi("OrgKeyItem");

registry.registerPath({
  method: "get",
  path: "/v1/keys",
  tags: ["Keys"],
  summary: "List provider keys",
  description:
    "List provider keys for the organization.",
  security: authed,
  responses: {
    200: {
      description: "List of provider keys (masked)",
      content: {
        "application/json": {
          schema: z.object({
            keys: z.array(OrgKeyItemSchema),
          }).openapi("ListKeysResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/keys",
  tags: ["Keys"],
  summary: "Upsert a provider key",
  description:
    "Store or update a provider API key for the organization.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: UpsertKeyRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Key stored",
      content: {
        "application/json": {
          schema: z.object({
            provider: z.string().describe("Provider name"),
            maskedKey: z.string().describe("Masked key value"),
            message: z.string().describe("Confirmation message"),
          }).openapi("UpsertKeyResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/keys/{provider}",
  tags: ["Keys"],
  summary: "Delete a provider key",
  description: "Remove a provider key for the organization.",
  security: authed,
  request: {
    params: z.object({
      provider: z.string().describe("Provider name"),
    }),
  },
  responses: {
    200: {
      description: "Key deleted",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string().describe("Confirmation message"),
          }).openapi("DeleteKeyResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// KEY SOURCE PREFERENCES
// ===================================================================

export const SetKeySourceRequestSchema = z
  .object({
    keySource: z
      .enum(["org", "platform"])
      .describe("Whether to use the org's own key or the platform key"),
  })
  .openapi("SetKeySourceRequest");

const KeySourcePreferenceSchema = z
  .object({
    provider: z.string().describe("Provider name"),
    keySource: z.enum(["org", "platform"]).describe("Key source preference"),
  })
  .openapi("KeySourcePreference");

registry.registerPath({
  method: "get",
  path: "/v1/keys/sources",
  tags: ["Keys"],
  summary: "List key source preferences",
  description:
    "List all explicit key source preferences for the organization. Providers not listed default to 'platform'.",
  security: authed,
  responses: {
    200: {
      description: "Key source preferences",
      content: {
        "application/json": {
          schema: z.object({
            sources: z.array(KeySourcePreferenceSchema),
          }).openapi("ListKeySourcesResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/keys/{provider}/source",
  tags: ["Keys"],
  summary: "Get key source preference",
  description:
    "Get the current key source preference for a provider. Returns 'platform' with isDefault=true if no explicit preference is set.",
  security: authed,
  request: {
    params: z.object({
      provider: z.string().describe("Provider name"),
    }),
  },
  responses: {
    200: {
      description: "Key source preference",
      content: {
        "application/json": {
          schema: z.object({
            provider: z.string().describe("Provider name"),
            orgId: z.string().describe("Organization ID"),
            keySource: z.enum(["org", "platform"]).describe("Key source preference"),
            isDefault: z.boolean().describe("Whether this is the default (no explicit preference set)"),
          }).openapi("GetKeySourceResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/keys/{provider}/source",
  tags: ["Keys"],
  summary: "Set key source preference",
  description:
    "Set whether the org uses its own key or the platform key for a given provider. If switching to 'org', an org key must already be stored.",
  security: authed,
  request: {
    params: z.object({
      provider: z.string().describe("Provider name"),
    }),
    body: {
      content: { "application/json": { schema: SetKeySourceRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Key source preference saved",
      content: {
        "application/json": {
          schema: z.object({
            provider: z.string().describe("Provider name"),
            orgId: z.string().describe("Organization ID"),
            keySource: z.enum(["org", "platform"]).describe("Key source preference"),
            message: z.string().describe("Confirmation message"),
          }).openapi("SetKeySourceResponse"),
        },
      },
    },
    400: { description: "Invalid request or no org key stored", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// PROVIDER REQUIREMENTS
// ===================================================================

export const ProviderRequirementsRequestSchema = z
  .object({
    endpoints: z
      .array(
        z.object({
          service: z.string().min(1).describe("Service name"),
          method: z.string().min(1).describe("HTTP method"),
          path: z.string().min(1).describe("Endpoint path"),
        })
      )
      .min(1)
      .describe("List of service endpoints to check"),
  })
  .openapi("ProviderRequirementsRequest");

registry.registerPath({
  method: "post",
  path: "/v1/keys/provider-requirements",
  tags: ["Keys"],
  summary: "Query provider requirements",
  description:
    "Given a list of service endpoints, returns which third-party providers each endpoint needs. Used to determine which keys are required before execution.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: ProviderRequirementsRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Provider requirements for the given endpoints",
      content: {
        "application/json": {
          schema: z.object({
            requirements: z.array(
              z.object({
                service: z.string().describe("Service name"),
                method: z.string().describe("HTTP method"),
                path: z.string().describe("Endpoint path"),
                provider: z.string().describe("Required provider"),
              })
            ).describe("Per-endpoint provider requirements"),
            providers: z.array(z.string()).describe("Unique list of all required providers"),
          }).openapi("ProviderRequirementsResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// API KEYS
// ===================================================================

export const CreateApiKeyRequestSchema = z
  .object({
    name: z
      .string()
      .optional()
      .describe("Human-readable name for the API key"),
  })
  .openapi("CreateApiKeyRequest");

const ApiKeyItemSchema = z
  .object({
    id: z.string().describe("API key ID"),
    keyPrefix: z.string().describe("Key prefix for identification (e.g. distrib.usr_abc...)"),
    name: z.string().nullable().describe("Human-readable name"),
    orgId: z.string().describe("Organization ID"),
    userId: z.string().describe("User ID"),
    createdBy: z.string().describe("Who created the key"),
    createdAt: z.string().nullable().describe("ISO timestamp"),
    lastUsedAt: z.string().nullable().describe("ISO timestamp of last usage"),
  })
  .openapi("ApiKeyItem");

registry.registerPath({
  method: "get",
  path: "/v1/api-keys",
  tags: ["Authentication"],
  summary: "List API keys",
  description: "List all API keys for the organization",
  security: authed,
  responses: {
    200: {
      description: "List of API keys",
      content: {
        "application/json": {
          schema: z.object({
            keys: z.array(ApiKeyItemSchema),
          }).openapi("ListApiKeysResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/api-keys",
  tags: ["Authentication"],
  summary: "Create an API key",
  description: "Create a new API key for your organization. This is the recommended way to authenticate with the API.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: CreateApiKeyRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Created API key (includes the full key — only shown once)",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().describe("API key ID"),
            key: z.string().describe("Full API key value (only returned at creation)"),
            name: z.string().describe("Key name"),
            orgId: z.string().describe("Organization ID"),
            userId: z.string().describe("User ID"),
            createdBy: z.string().describe("Who created the key"),
            createdAt: z.string().nullable().describe("ISO timestamp"),
          }).openapi("CreateApiKeyResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/api-keys/{id}",
  tags: ["Authentication"],
  summary: "Revoke an API key",
  description: "Delete/revoke an API key by ID",
  security: authed,
  request: {
    params: z.object({ id: z.string().describe("API key ID") }),
  },
  responses: {
    200: {
      description: "API key revoked",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string().describe("Confirmation message"),
          }).openapi("RevokeApiKeyResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/api-keys/session",
  tags: ["Authentication"],
  summary: "Get or create session API key",
  description:
    "Get or create a short-lived session API key for Foxy chat integration",
  security: authed,
  responses: {
    200: {
      description: "Session API key",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().describe("Key ID"),
            key: z.string().describe("Full API key value"),
            keyPrefix: z.string().describe("Key prefix for display"),
            name: z.string().nullable().describe("Key name"),
          }).openapi("SessionApiKeyResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// LEADS
// ===================================================================

export const LeadSearchRequestSchema = z
  .object({
    person_titles: z
      .array(z.string())
      .min(1)
      .describe("Job titles to search for"),
    organization_locations: z
      .array(z.string())
      .optional()
      .describe("Company locations filter"),
    organization_industries: z
      .array(z.string())
      .optional()
      .describe("Industry tag IDs filter"),
    organization_num_employees_ranges: z
      .array(z.string())
      .optional()
      .describe("Employee count ranges"),
    per_page: z
      .number()
      .int()
      .max(100)
      .optional()
      .default(10)
      .describe("Results per page (max 100)"),
  })
  .openapi("LeadSearchRequest");

registry.registerPath({
  method: "post",
  path: "/v1/leads/search",
  tags: ["Leads"],
  summary: "Search for leads",
  description:
    "Search for leads using Apollo-compatible filters (titles, locations, industries, company size)",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: LeadSearchRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Lead search results",
      content: {
        "application/json": {
          schema: z.object({
            people: z.array(z.object({
              id: z.string().describe("Person ID"),
              first_name: z.string().nullable().describe("First name"),
              last_name: z.string().nullable().describe("Last name"),
              email: z.string().nullable().describe("Email address"),
              title: z.string().nullable().describe("Job title"),
              linkedin_url: z.string().nullable().describe("LinkedIn URL"),
              organization: z.object({
                name: z.string().nullable(),
                website_url: z.string().nullable(),
                industry: z.string().nullable(),
                estimated_num_employees: z.number().nullable(),
              }).nullable().describe("Company info"),
            })).describe("Matching people"),
            pagination: z.object({
              page: z.number(),
              per_page: z.number(),
              total_entries: z.number(),
              total_pages: z.number(),
            }).describe("Pagination info"),
          }).openapi("LeadSearchResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// QUALIFY
// ===================================================================

export const QualifyRequestSchema = z
  .object({
    sourceService: z
      .string()
      .optional()
      .default("api")
      .describe("Source service identifier"),
    sourceOrgId: z
      .string()
      .optional()
      .describe("Organization ID (defaults to auth org)"),
    sourceRefId: z
      .string()
      .optional()
      .describe("Reference ID in the source system"),
    fromEmail: z.string().min(1).describe("Sender email address"),
    toEmail: z.string().min(1).describe("Recipient email address"),
    subject: z.string().optional().describe("Email subject line"),
    bodyText: z.string().optional().describe("Plain text email body"),
    bodyHtml: z.string().optional().describe("HTML email body"),
    byokApiKey: z
      .string()
      .optional()
      .describe("BYOK API key for AI provider"),
  })
  .refine((data) => data.bodyText || data.bodyHtml, {
    message: "bodyText or bodyHtml is required",
    path: ["bodyText"],
  })
  .openapi("QualifyRequest");

registry.registerPath({
  method: "post",
  path: "/v1/qualify",
  tags: ["Qualify"],
  summary: "Qualify an email reply",
  description:
    "Uses AI to qualify/classify an inbound email reply (interested, not interested, out-of-office, etc.)",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: QualifyRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Qualification result",
      content: {
        "application/json": {
          schema: z.object({
            qualification: z.string().describe("Classification (e.g. 'interested', 'not_interested', 'out_of_office', 'unsubscribe')"),
            confidence: z.number().optional().describe("Confidence score 0-1"),
            reasoning: z.string().optional().describe("AI reasoning for the classification"),
          }).openapi("QualifyResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// BRAND
// ===================================================================

export const BrandScrapeRequestSchema = z
  .object({
    url: z.string().min(1).describe("Brand website URL to scrape"),
    skipCache: z
      .boolean()
      .optional()
      .describe("Skip cached results and force re-scrape"),
  })
  .openapi("BrandScrapeRequest");

export const BrandUpsertRequestSchema = z
  .object({
    url: z.string().min(1).describe("Brand website URL"),
  })
  .openapi("BrandUpsertRequest");

export const IcpSuggestionRequestSchema = z
  .object({
    brandUrl: z.string().min(1).describe("Brand website URL"),
  })
  .openapi("IcpSuggestionRequest");

const BrandSummarySchema = z
  .object({
    id: z.string().describe("Brand ID"),
    domain: z.string().nullable().describe("Brand domain"),
    name: z.string().nullable().describe("Brand name"),
    brandUrl: z.string().nullable().describe("Brand website URL"),
    createdAt: z.string().nullable().describe("ISO timestamp"),
    updatedAt: z.string().nullable().describe("ISO timestamp"),
    logoUrl: z.string().nullable().describe("Logo URL"),
    elevatorPitch: z.string().nullable().describe("Short brand description"),
  })
  .openapi("BrandSummary");

const BrandDetailSchema = BrandSummarySchema.extend({
  bio: z.string().nullable().describe("Brand biography"),
  mission: z.string().nullable().describe("Brand mission statement"),
  location: z.string().nullable().describe("Brand location"),
  categories: z.string().nullable().describe("Brand categories"),
}).openapi("BrandDetail");

const ExtractFieldRequestSchema = z.object({
  key: z.string().describe("Field key (e.g. 'industry', 'valueProposition')"),
  description: z.string().describe("Description of what to extract"),
}).openapi("ExtractFieldRequest");

const ExtractFieldResultSchema = z.object({
  value: z.union([
    z.string(),
    z.array(z.unknown()),
    z.record(z.unknown()),
    z.null(),
  ]).describe("Extracted value. Type depends on the field key: string (companyOverview, valueProposition, callToAction), array (targetAudience, keyFeatures, customerPainPoints, productDifferentiators), object (socialProof, funding, additionalContext, riskReversal, scarcity, urgency), or null when the field was not found on the site (e.g. competitors, leadership)."),
  cached: z.boolean().describe("Whether this result was served from cache"),
  extractedAt: z.string().describe("ISO timestamp of extraction"),
  expiresAt: z.string().describe("ISO timestamp when cached result expires"),
  sourceUrls: z.array(z.string()).nullable().describe("URLs scraped to extract this field. Null for pre-existing extractions."),
}).openapi("ExtractFieldResult");

const CachedFieldSchema = z.object({
  key: z.string().describe("Field key"),
  value: z.union([
    z.string(),
    z.array(z.unknown()),
    z.record(z.unknown()),
    z.null(),
  ]).describe("Extracted value. Type depends on the field key: string, array, object, or null when not found."),
  sourceUrls: z.array(z.string()).nullable().describe("URLs scraped to extract this field. Null for pre-existing extractions."),
  extractedAt: z.string().describe("ISO timestamp of extraction"),
  expiresAt: z.string().describe("ISO timestamp when cached result expires"),
}).openapi("CachedField");

registry.registerPath({
  method: "post",
  path: "/v1/brand/scrape",
  tags: ["Brand"],
  summary: "Scrape brand info",
  description:
    "Scrape brand information from a URL using the scraping service",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: BrandScrapeRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Scraped brand information",
      content: {
        "application/json": {
          schema: z.object({ brand: BrandDetailSchema }).openapi("BrandScrapeResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brand/by-url",
  tags: ["Brand"],
  summary: "Get brand by URL",
  description: "Get cached brand info by website URL",
  security: authed,
  request: {
    query: z.object({
      url: z.string().describe("Brand website URL"),
    }),
  },
  responses: {
    200: {
      description: "Cached brand information",
      content: {
        "application/json": {
          schema: z.object({ brand: BrandDetailSchema }).openapi("BrandByUrlResponse"),
        },
      },
    },
    400: { description: "Missing url param", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands",
  tags: ["Brand"],
  summary: "List brands",
  description: "Get all brands for the organization",
  security: authed,
  responses: {
    200: {
      description: "List of brands",
      content: {
        "application/json": {
          schema: z.object({
            brands: z.array(BrandSummarySchema),
          }).openapi("ListBrandsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}",
  tags: ["Brand"],
  summary: "Get a brand",
  description: "Get a single brand by ID",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: {
      description: "Brand data",
      content: {
        "application/json": {
          schema: z.object({ brand: BrandDetailSchema }).openapi("GetBrandResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/extract-fields",
  tags: ["Brand"],
  summary: "Extract fields from brand (single brand, deprecated)",
  description:
    "Deprecated — use POST /v1/brands/extract-fields instead (reads brand IDs from x-brand-id header). " +
    "Generic field extraction: send fields you want with a key and description, and brand-service extracts them via AI. Results are cached 30 days per field.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            fields: z.array(ExtractFieldRequestSchema).describe("Fields to extract"),
          }).openapi("ExtractFieldsRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Extracted field results",
      content: {
        "application/json": {
          schema: z.object({
            brandId: z.string().describe("Brand ID"),
            results: z.record(z.string(), ExtractFieldResultSchema).describe("Extraction results keyed by field name (e.g. results.biography.value)"),
          }).openapi("ExtractFieldsResponse"),
        },
      },
    },
    400: { description: "Anthropic API key not configured", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/extract-fields",
  tags: ["Brand"],
  summary: "Extract fields from brand(s)",
  description:
    "Multi-brand field extraction: reads brand IDs from the x-brand-id header (comma-separated UUIDs). " +
    "Send fields you want with a key and description, and brand-service extracts them via AI. " +
    "Results are cached 30 days per field per brand. " +
    "Replaces POST /v1/brands/{id}/extract-fields for multi-brand campaigns.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            fields: z.array(ExtractFieldRequestSchema).describe("Fields to extract"),
          }).openapi("ExtractFieldsFromHeaderRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Extracted field results",
      content: {
        "application/json": {
          schema: z.object({
            brands: z.array(z.object({
              brandId: z.string().describe("Internal brand UUID"),
              domain: z.string().describe("Brand domain (e.g. acme.com)"),
              name: z.string().describe("Brand display name"),
            })).describe("Metadata for each brand included in the extraction"),
            fields: z.record(z.string(), z.object({
              value: z.union([
                z.string(),
                z.array(z.unknown()),
                z.record(z.unknown()),
                z.null(),
              ]).describe("Merged/primary extracted value across all brands"),
              byBrand: z.record(z.string(), z.object({
                value: z.union([
                  z.string(),
                  z.array(z.unknown()),
                  z.record(z.unknown()),
                  z.null(),
                ]).describe("Extracted value for this brand"),
                cached: z.boolean().describe("Whether this result was served from cache"),
                extractedAt: z.string().describe("ISO timestamp of extraction"),
                expiresAt: z.string().describe("ISO timestamp when cached result expires"),
                sourceUrls: z.array(z.string()).nullable().describe("URLs scraped to extract this field"),
              })).describe("Per-brand extraction details keyed by domain"),
            })).describe("Extraction results keyed by field name"),
          }).openapi("ExtractFieldsFromHeaderResponse"),
        },
      },
    },
    400: { description: "Missing x-brand-id header or Anthropic API key not configured", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/extracted-fields",
  tags: ["Brand"],
  summary: "List extracted fields for a brand",
  description:
    "Lists all previously extracted and cached fields for a brand.",
  security: authed,
  request: {
    params: BrandIdParam,
  },
  responses: {
    200: {
      description: "Cached extracted fields",
      content: {
        "application/json": {
          schema: z.object({
            brandId: z.string().describe("Brand ID"),
            fields: z.array(CachedFieldSchema).describe("Previously extracted and cached fields"),
          }).openapi("ExtractedFieldsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

const ExtractImageCategorySchema = z.object({
  key: z.string().describe("Image category key (e.g. 'logo', 'product_shots', 'hero_image')"),
  description: z.string().describe("Description of what kind of image to extract"),
  maxCount: z.number().int().positive().describe("Maximum number of images to extract for this category"),
}).openapi("ExtractImageCategory");

const ExtractedImageSchema = z.object({
  url: z.string().describe("Permanent R2 URL of the extracted image"),
  category: z.string().describe("Image category key"),
  sourceUrl: z.string().nullable().describe("Original source URL where the image was found"),
  extractedAt: z.string().describe("ISO timestamp of extraction"),
}).openapi("ExtractedImage");

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/extract-images",
  tags: ["Brand"],
  summary: "Extract images from brand",
  description:
    "Extract brand images by category (logo, product shots, hero image, etc.) via scraping + vision AI. Returns permanent R2 URLs.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            categories: z.array(ExtractImageCategorySchema).describe("Image categories to extract"),
          }).openapi("ExtractImagesRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Extracted image results",
      content: {
        "application/json": {
          schema: z.object({
            brandId: z.string().describe("Brand ID"),
            images: z.array(ExtractedImageSchema).describe("Extracted images"),
          }).openapi("ExtractImagesResponse"),
        },
      },
    },
    400: { description: "Anthropic API key not configured", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/extracted-images",
  tags: ["Brand"],
  summary: "List extracted images for a brand",
  description:
    "Lists all previously extracted and cached images for a brand. Supports ?campaignId= query param to filter by campaign.",
  security: authed,
  request: {
    params: BrandIdParam,
    query: z.object({
      campaignId: z.string().optional().describe("Filter by campaign ID"),
    }).openapi("ExtractedImagesQuery"),
  },
  responses: {
    200: {
      description: "Cached extracted images",
      content: {
        "application/json": {
          schema: z.object({
            brandId: z.string().describe("Brand ID"),
            images: z.array(ExtractedImageSchema).describe("Previously extracted and cached images"),
          }).openapi("ExtractedImagesResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brand/icp-suggestion",
  tags: ["Brand"],
  summary: "Get ICP suggestion",
  description:
    "Get AI-generated Ideal Customer Profile suggestion (Apollo-compatible search params) for a brand URL",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: IcpSuggestionRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "ICP suggestion (Apollo-compatible search params)",
      content: {
        "application/json": {
          schema: z.object({
            person_titles: z.array(z.string()).describe("Suggested job titles"),
            organization_locations: z.array(z.string()).optional().describe("Suggested locations"),
            organization_industries: z.array(z.string()).optional().describe("Suggested industries"),
            organization_num_employees_ranges: z.array(z.string()).optional().describe("Suggested company sizes"),
          }).openapi("IcpSuggestionResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands",
  tags: ["Brand"],
  summary: "Upsert brand",
  description:
    "Upsert a brand from a URL. Returns the brandId.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: BrandUpsertRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Brand upserted",
      content: {
        "application/json": {
          schema: z.object({
            brandId: z.string().describe("Brand ID"),
            domain: z.string().nullable().describe("Extracted domain"),
            name: z.string().nullable().describe("Brand name"),
            created: z.boolean().describe("True if newly created, false if already existed"),
          }).openapi("UpsertBrandResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/runs",
  tags: ["Brand"],
  summary: "Get brand runs",
  description:
    "Get extraction runs for a brand (extract-fields, icp-extraction) enriched with cost data",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: {
      description: "Brand extraction runs with cost data",
      content: {
        "application/json": {
          schema: z.object({
            runs: z.array(RunCostDataSchema),
          }).openapi("BrandRunsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// EMAIL-GATEWAY (delivery stats)
// ===================================================================

registry.registerPath({
  method: "get",
  path: "/v1/email-gateway/stats",
  tags: ["Email Gateway"],
  summary: "Get email delivery stats",
  description:
    "Get broadcast delivery statistics from email-gateway. Filter by brandId, campaignId, workflowSlug, featureSlug, workflowDynastySlug, or featureDynastySlug.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().optional().describe("Filter by brand ID"),
      campaignId: z.string().optional().describe("Filter by campaign ID"),
      workflowSlug: z.string().optional().describe("Filter by exact workflow slug"),
      featureSlug: z.string().optional().describe("Filter by exact feature slug"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
      featureDynastySlug: z.string().optional().describe("Filter by feature dynasty slug (resolved to all versioned slugs)"),
    }),
  },
  responses: {
    200: {
      description: "Delivery statistics (broadcast only)",
      content: {
        "application/json": {
          schema: z
            .object({
              emailsContacted: z.number().describe("Leads successfully submitted to email provider (immediate)"),
              emailsSent: z.number().describe("Emails confirmed sent by provider (from webhook)"),
              emailsDelivered: z.number().describe("Emails confirmed delivered (from webhook)"),
              emailsOpened: z.number(),
              emailsClicked: z.number(),
              emailsReplied: z.number(),
              emailsBounced: z.number(),
              repliesWillingToMeet: z.number(),
              repliesInterested: z.number(),
              repliesNotInterested: z.number(),
              repliesOutOfOffice: z.number(),
              repliesUnsubscribe: z.number(),
            })
            .openapi("EmailGatewayStatsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// RUNS (cost stats)
// ===================================================================

registry.registerPath({
  method: "get",
  path: "/v1/runs/stats/costs",
  tags: ["Runs"],
  summary: "Get cost stats from runs-service",
  description:
    "Get cost statistics grouped by a dimension. Supports groupBy=brandId, costName, campaignId, serviceName, workflowDynastySlug, featureDynastySlug. Filter by brandId, campaignId, taskName, workflowSlug, featureSlug, workflowDynastySlug, featureDynastySlug.",
  security: authed,
  request: {
    query: z.object({
      groupBy: z.string().describe("Grouping dimension: brandId, costName, campaignId, serviceName, workflowDynastySlug, featureDynastySlug"),
      brandId: z.string().optional().describe("Filter by brand ID"),
      campaignId: z.string().optional().describe("Filter by campaign ID"),
      taskName: z.string().optional().describe("Filter by task name (e.g. lead-serve)"),
      workflowSlug: z.string().optional().describe("Filter by exact workflow slug"),
      featureSlug: z.string().optional().describe("Filter by exact feature slug"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
      featureDynastySlug: z.string().optional().describe("Filter by feature dynasty slug (resolved to all versioned slugs)"),
    }),
  },
  responses: {
    200: {
      description: "Cost stats grouped by the requested dimension",
      content: {
        "application/json": {
          schema: z
            .object({
              groups: z.array(z.object({
                dimensions: z.record(z.string().nullable()).describe("Dimension key-value pairs (e.g. { brandId: '...' })"),
                totalCostInUsdCents: z.string(),
                actualCostInUsdCents: z.string(),
                provisionedCostInUsdCents: z.string(),
                cancelledCostInUsdCents: z.string(),
                runCount: z.number(),
                totalQuantity: z.string().optional().describe("Present when groupBy includes costName"),
              })),
            })
            .openapi("RunsCostStatsResponse"),
        },
      },
    },
    400: { description: "Missing groupBy parameter", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brand/{id}",
  tags: ["Brand"],
  summary: "Get brand scrape result",
  description: "Get brand scrape result by scrape ID",
  security: authed,
  request: {
    params: z.object({ id: z.string().describe("Scrape ID") }),
  },
  responses: {
    200: {
      description: "Brand scrape result",
      content: {
        "application/json": {
          schema: z.object({ brand: BrandDetailSchema }).openapi("BrandScrapeResultResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// WORKFLOWS
// ===================================================================

registry.registerPath({
  method: "get",
  path: "/v1/workflows",
  tags: ["Workflows"],
  summary: "List workflows",
  description:
    "List available workflows from the workflow-service. Supports filtering by exact versioned slugs or dynasty slugs (lineage match). " +
    "Use featureDynastySlug/workflowDynastySlug to match all versions in a lineage, or featureSlug/workflowSlug for exact version match.",
  security: authed,
  request: {
    query: z.object({
      humanId: z.string().optional().openapi({ example: "human-uuid-123" }).describe("Filter workflows by human expert ID"),
      featureSlug: z.string().optional().openapi({ example: "pr-cold-email-outreach-v3" }).describe("Filter by exact versioned feature slug"),
      featureDynastySlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature dynasty slug (resolves to all versioned slugs in the lineage)"),
      workflowSlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-sienna-v3" }).describe("Filter by exact versioned workflow slug"),
      workflowDynastySlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-sienna" }).describe("Filter by workflow dynasty slug (exact match on dynasty_slug column)"),
    }),
  },
  responses: {
    200: {
      description: "List of workflows",
      content: {
        "application/json": {
          schema: z.object({
            workflows: z.array(WorkflowMetadataSchema.extend({
              requiredProviders: z.array(z.object({
                name: z.string().describe("Provider name"),
                domain: z.string().nullable().describe("Provider domain"),
              })).optional().describe("External providers required by this workflow"),
            })),
          }).openapi("ListWorkflowsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/workflows/{id}",
  tags: ["Workflows"],
  summary: "Get a workflow",
  description: "Get a single workflow with full DAG definition",
  security: authed,
  request: {
    params: z.object({ id: z.string().uuid().describe("Workflow ID") }),
  },
  responses: {
    200: {
      description: "Workflow with DAG",
      content: {
        "application/json": {
          schema: WorkflowMetadataSchema.extend({
            dag: z.object({
              nodes: z.array(z.any()).describe("DAG nodes"),
              edges: z.array(z.any()).describe("DAG edges"),
            }).describe("The DAG definition"),
            requiredProviders: z.array(z.object({
              name: z.string().describe("Provider name"),
              domain: z.string().nullable().describe("Provider domain"),
            })).optional().describe("External providers required by this workflow"),
          }).openapi("GetWorkflowResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

export const WorkflowStyleSchema = z
  .object({
    type: z.enum(["human", "brand"]).describe("Style source type"),
    humanId: z
      .string()
      .optional()
      .describe("Human ID from human-service. Required when type is 'human'."),
    brandId: z
      .string()
      .optional()
      .describe("Brand ID from brand-service. Required when type is 'brand'."),
    name: z.string().min(1).describe("Display name of the human or brand (e.g. 'Hormozi', 'My Brand')"),
  })
  .openapi("WorkflowStyle");

export const GenerateWorkflowRequestSchema = z
  .object({
    featureSlug: z
      .string()
      .min(1)
      .describe("Feature slug for the generated workflow (e.g. 'pr-cold-email-outreach')"),
    description: z
      .string()
      .min(10)
      .describe(
        "Natural language description of the desired workflow. Be specific about steps, services, and data flow."
      ),
    hints: z
      .object({
        services: z.array(z.string()).optional().describe("Scope generation to these services"),
        nodeTypes: z.array(z.string()).optional().describe("Suggest specific node types"),
        expectedInputs: z
          .array(z.string())
          .optional()
          .describe("Expected flow_input field names (e.g. campaignId, email)"),
      })
      .optional()
      .describe("Optional hints to guide DAG generation"),
    style: WorkflowStyleSchema.optional().describe(
      "Optional style configuration. When provided, the workflow is generated in the style of an industry expert or brand."
    ),
  })
  .openapi("GenerateWorkflowRequest");

registry.registerPath({
  method: "post",
  path: "/v1/workflows/generate",
  tags: ["Workflows"],
  summary: "Generate a workflow DAG",
  description:
    "Uses AI to generate a workflow DAG from a natural language description. The generated workflow is validated and deployed automatically.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: GenerateWorkflowRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Generated and deployed workflow",
      content: {
        "application/json": {
          schema: z
            .object({
              workflow: z.object({
                id: z.string().describe("Workflow ID"),
                name: z.string().describe("Auto-generated workflow slug"),
                featureSlug: z.string().describe("Feature slug this workflow belongs to"),
                signature: z.string().describe("SHA-256 hash of the canonical DAG"),
                signatureName: z.string().describe("Human-readable name for this DAG variant"),
                action: z.enum(["created", "updated"]).describe("Whether the workflow was created or updated"),
                humanId: z.string().nullable().describe("Human ID if styled after an expert"),
                styleName: z.string().nullable().describe("Base style name for versioning (e.g. 'hormozi')"),
              }),
              dag: z.object({
                nodes: z.array(z.any()).describe("DAG nodes"),
                edges: z.array(z.any()).describe("DAG edges"),
              }),
              generatedDescription: z.string().describe("AI-generated description of the workflow"),
            })
            .openapi("GenerateWorkflowResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    422: {
      description: "Could not generate a valid DAG",
      content: errorContent,
    },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// WORKFLOW SUMMARY & KEY STATUS
// ===================================================================

const WorkflowIdParam = z.object({
  id: z.string().uuid().describe("Workflow ID"),
});

const ProviderInfoSchema = z
  .object({
    name: z.string().describe("Provider name (e.g. 'anthropic', 'apollo')"),
    domain: z.string().nullable().describe("Provider domain for logo display (e.g. 'anthropic.com'), null for internal services"),
  })
  .openapi("ProviderInfo");

export const WorkflowSummaryResponseSchema = z
  .object({
    workflowSlug: z.string().describe("Workflow slug"),
    summary: z.string().describe("Natural-language summary of the workflow"),
    requiredProviders: z.array(ProviderInfoSchema).describe("External providers required by this workflow, with domains for logo display"),
    steps: z.array(z.string()).describe("Ordered list of workflow steps in human-readable format"),
  })
  .openapi("WorkflowSummaryResponse");

registry.registerPath({
  method: "get",
  path: "/v1/workflows/{id}/summary",
  tags: ["Workflows"],
  summary: "Get workflow summary",
  description:
    "Returns a human-readable summary of a workflow's DAG, including ordered steps and required providers. " +
    "Useful for showing users what a workflow does without exposing the raw DAG.",
  security: authed,
  request: {
    params: WorkflowIdParam,
  },
  responses: {
    200: {
      description: "Workflow summary",
      content: { "application/json": { schema: WorkflowSummaryResponseSchema } },
    },
    404: { description: "Workflow not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

export const WorkflowKeyStatusItemSchema = z
  .object({
    provider: z.string().describe("Provider name (e.g. 'apollo', 'anthropic')"),
    configured: z.boolean().describe("Whether a key is available for this provider (via platform or org key)"),
    maskedKey: z.string().nullable().describe("Masked org key value, or null if not configured"),
    keySource: z.enum(["org", "platform"]).describe("Key source preference: 'platform' (default) or 'org' (BYOK)"),
  })
  .openapi("WorkflowKeyStatusItem");

export const WorkflowKeyStatusResponseSchema = z
  .object({
    workflowSlug: z.string().describe("Workflow slug"),
    ready: z.boolean().describe("True if all required provider keys are configured"),
    keys: z.array(WorkflowKeyStatusItemSchema).describe("Status of each required provider key"),
    missing: z.array(z.string()).describe("List of provider names with missing keys"),
  })
  .openapi("WorkflowKeyStatusResponse");

registry.registerPath({
  method: "get",
  path: "/v1/workflows/{id}/key-status",
  tags: ["Workflows"],
  summary: "Get key status for a workflow",
  description:
    "Compares the workflow's required providers against the org's key configuration, " +
    "taking into account key source preferences (platform vs org). " +
    "Providers using platform keys are always ready. " +
    "Returns which keys are present and which are missing, along with an overall readiness flag.",
  security: authed,
  request: {
    params: WorkflowIdParam,
  },
  responses: {
    200: {
      description: "Key status for the workflow",
      content: { "application/json": { schema: WorkflowKeyStatusResponseSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

export const MissingKeysErrorSchema = z
  .object({
    error: z.literal("missing_keys").describe("Error code"),
    message: z.string().describe("Human-readable error message"),
    missing: z.array(z.string()).describe("Provider names with missing keys"),
    configured: z.array(z.string()).describe("Provider names with configured keys"),
  })
  .openapi("MissingKeysError");

// ===================================================================
// WORKFLOW VALIDATE & UPDATE
// ===================================================================

const TemplateRefSchema = z
  .object({
    nodeId: z.string().describe("DAG node ID"),
    templateType: z.string().describe("Prompt template type used by this node"),
    variablesProvided: z.array(z.string()).describe("Variable names the workflow provides to this node"),
  })
  .openapi("TemplateRef");

const TemplateContractIssueSchema = z
  .object({
    nodeId: z.string().describe("DAG node ID that calls content-generation"),
    templateType: z.string().describe("Prompt template type (e.g. 'cold-email')"),
    field: z.string().describe("Variable name or template type"),
    severity: z.enum(["error", "warning"]).describe("'error' = missing required variable, 'warning' = extra/unknown variable"),
    reason: z.string().describe("Human-readable explanation of the issue"),
  })
  .openapi("TemplateContractIssue");

export const ValidationResultSchema = z
  .object({
    valid: z.boolean().describe("Whether the workflow DAG is valid"),
    errors: z
      .array(
        z.object({
          field: z.string().describe("Field that caused the error"),
          message: z.string().describe("Error description"),
        })
      )
      .optional()
      .describe("Structural validation errors"),
    templateContract: z
      .object({
        valid: z.boolean().describe("Whether all template contracts are satisfied"),
        templateRefs: z.array(TemplateRefSchema).describe("Content-generation template references found in the DAG"),
        issues: z.array(TemplateContractIssueSchema).describe("Variable mismatches between workflow and prompt templates"),
      })
      .optional()
      .describe("Template contract validation result. Present when content-generation service is reachable."),
  })
  .openapi("ValidationResult");

registry.registerPath({
  method: "post",
  path: "/v1/workflows/{id}/validate",
  tags: ["Workflows"],
  summary: "Validate a workflow DAG",
  description:
    "Validates the workflow's DAG structure and checks template contracts — " +
    "whether the variables provided by the workflow match those expected by prompt templates. " +
    "Use after every modification to verify consistency.",
  security: authed,
  request: {
    params: WorkflowIdParam,
  },
  responses: {
    200: {
      description: "Validation result",
      content: { "application/json": { schema: ValidationResultSchema } },
    },
    404: { description: "Workflow not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

const DAGNodeSchema = z
  .object({
    id: z.string().describe("Unique node identifier within the DAG"),
    type: z.string().describe("Node type (e.g. 'http.call', 'condition', 'wait', 'for-each', 'script')"),
    config: z.record(z.unknown()).optional().describe("Node-specific configuration"),
    inputMapping: z.record(z.unknown()).optional().describe("Maps input variables to this node"),
    retries: z.number().int().min(0).optional().describe("Number of retry attempts on failure. Defaults to 3 if omitted. Set to 0 for non-idempotent operations."),
  })
  .openapi("DAGNode");

const DAGEdgeSchema = z
  .object({
    from: z.string().describe("Source node ID"),
    to: z.string().describe("Target node ID"),
    condition: z.string().optional().describe("JavaScript expression for conditional branching. Only used when source node is type 'condition'. Edges WITH condition: target node only executes when the condition is true. Edges WITHOUT condition from a condition node: target always executes after the branch."),
  })
  .openapi("DAGEdge");

const DAGSchema = z
  .object({
    nodes: z.array(DAGNodeSchema).min(1).describe("The steps of the workflow. Must contain at least one node."),
    edges: z.array(DAGEdgeSchema).describe("Execution order between nodes. Empty array for single-node workflows."),
    onError: z.string().optional().describe("Node ID of an error handler that runs when any node fails"),
  })
  .openapi("DAG");

export const UpdateWorkflowRequestSchema = z
  .object({
    name: z.string().min(1).optional().describe("Workflow name"),
    description: z.string().optional().describe("Workflow description"),
    tags: z.array(z.string()).optional().describe("Tags for filtering/grouping"),
    dag: DAGSchema.optional().describe(
      "Optional new DAG. When omitted, only metadata (description, tags) is updated in-place. " +
      "When provided with the same structural signature, the DAG is updated in-place. " +
      "When provided with a different structural signature, a new workflow is created (fork) " +
      "and the original is kept active (unless its dynasty has zero campaign runs, in which case it is deprecated)."
    ),
  })
  .openapi("UpdateWorkflowRequest", {
    example: {
      description: "Updated workflow description",
      tags: ["email", "outreach"],
      dag: {
        nodes: [
          { id: "fetch-lead", type: "http.call", config: { service: "lead", method: "POST", path: "/buffer/next" }, inputMapping: { "body.campaignId": "$ref:flow_input.campaignId" } },
          { id: "send-email", type: "http.call", config: { service: "email-gateway", method: "POST", path: "/send" }, inputMapping: { "body.to": "$ref:fetch-lead.output.lead.email" }, retries: 0 },
        ],
        edges: [{ from: "fetch-lead", to: "send-email" }],
      },
    },
  });

registry.registerPath({
  method: "put",
  path: "/v1/workflows/{id}",
  tags: ["Workflows"],
  summary: "Update a workflow",
  description:
    "The single endpoint for modifying a workflow. Behavior depends on what you send:\n\n" +
    "**Metadata only** (no `dag` in body): updates description/tags in-place. Returns 200 with `_action: 'updated'`.\n\n" +
    "**DAG with same signature**: the DAG structure hasn't changed (e.g. only config tweaks that don't affect the hash). Updates in-place. Returns 200 with `_action: 'updated'`.\n\n" +
    "**DAG with new signature**: creates a new workflow in a new dynasty (fork). The original workflow is kept active unless its entire dynasty has zero campaign runs, in which case it is deprecated. Returns 201 with `_action: 'forked'`, plus `_forkedFromName`, `_forkedFromId`, and `_sourceDynastyDeprecated`.\n\n" +
    "Returns 409 if an active workflow with the same DAG signature already exists, with `existingWorkflowId` and `existingWorkflowSlug` in the response body.",
  security: authed,
  request: {
    params: WorkflowIdParam,
    body: {
      content: {
        "application/json": { schema: UpdateWorkflowRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated in-place (`_action: \"updated\"`)",
      content: {
        "application/json": {
          schema: WorkflowMetadataSchema.extend({
            _action: z.literal("updated").describe("Indicates the workflow was updated in-place"),
            dag: z.object({
              nodes: z.array(z.any()),
              edges: z.array(z.any()),
            }).optional(),
          }).openapi("UpdateWorkflowResponse"),
        },
      },
    },
    201: {
      description: "Forked — new workflow created because the DAG signature changed (`_action: \"forked\"`)",
      content: {
        "application/json": {
          schema: WorkflowMetadataSchema.extend({
            _action: z.literal("forked").describe("Indicates a new workflow was created (forked) due to a DAG signature change"),
            _forkedFromName: z.string().describe("Name of the source workflow that was forked"),
            _forkedFromId: z.string().describe("ID of the source workflow that was forked"),
            _sourceDynastyDeprecated: z.boolean().describe("Whether the source dynasty was deprecated as a result"),
            dag: z.object({
              nodes: z.array(z.any()),
              edges: z.array(z.any()),
            }).optional(),
          }).openapi("ForkedWorkflowResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Workflow not found", content: errorContent },
    409: {
      description: "Conflict — an active workflow with the same DAG signature already exists",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string().describe("Error message"),
            existingWorkflowId: z.string().uuid().describe("ID of the existing workflow that already has this DAG signature"),
            existingWorkflowSlug: z.string().describe("Slug of the existing workflow that already has this DAG signature"),
          }).openapi("WorkflowConflictResponse"),
        },
      },
    },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/workflows",
  tags: ["Workflows"],
  summary: "Create a workflow",
  description:
    "Create a new workflow with a DAG definition. The workflow is deployed to the execution engine and can then be executed via POST /v1/workflows/{id}/execute.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: z.object({}).passthrough().openapi("CreateWorkflowRequest") } },
    },
  },
  responses: {
    201: {
      description: "Workflow created",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("CreateWorkflowResponse") } },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/workflows/{id}/execute",
  tags: ["Workflows"],
  summary: "Execute a workflow",
  description:
    "Start executing a workflow. Returns a run ID that can be polled via GET /v1/workflow-runs/{id} for status and result.",
  security: authed,
  request: {
    params: WorkflowIdParam,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            inputs: z.record(z.any()).optional().describe("Runtime inputs accessible via $ref:flow_input.fieldName"),
          }).openapi("ExecuteWorkflowRequest"),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Execution started",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("WorkflowRunResponse") } },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Workflow not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// WORKFLOW RUNS
// ===================================================================

const WorkflowRunIdParam = z.object({
  id: z.string().describe("Workflow run ID (UUID)"),
});

registry.registerPath({
  method: "get",
  path: "/v1/workflow-runs",
  tags: ["Workflow Runs"],
  summary: "List workflow runs",
  description: "List workflow runs with optional filters. Results are scoped to the authenticated org.",
  security: authed,
  request: {
    query: z.object({
      workflowId: z.string().optional().openapi({ example: "wf-uuid-123" }).describe("Filter by workflow ID"),
      campaignId: z.string().optional().openapi({ example: "campaign-uuid-456" }).describe("Filter by campaign ID"),
      featureSlug: z.string().optional().openapi({ example: "pr-cold-email-outreach-v3" }).describe("Filter by exact versioned feature slug"),
      featureDynastySlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature dynasty slug (resolves to all versioned slugs via features-service)"),
      workflowSlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-sienna-v3" }).describe("Filter by exact versioned workflow slug"),
      workflowDynastySlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-sienna" }).describe("Filter by workflow dynasty slug (subquery on workflows of the dynasty)"),
      status: z.string().optional().openapi({ example: "completed" }).describe("Filter by status (queued, running, completed, failed, cancelled)"),
    }),
  },
  responses: {
    200: {
      description: "List of workflow runs",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("ListWorkflowRunsResponse") } },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/workflow-runs/{id}",
  tags: ["Workflow Runs"],
  summary: "Get a workflow run",
  description:
    "Get the current status and result of a workflow execution. If still running, polls the engine for the latest status before responding.",
  security: authed,
  request: { params: WorkflowRunIdParam },
  responses: {
    200: {
      description: "Workflow run details",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("GetWorkflowRunResponse") } },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Run not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/workflow-runs/{id}/cancel",
  tags: ["Workflow Runs"],
  summary: "Cancel a workflow run",
  description: "Cancel a running or queued workflow execution.",
  security: authed,
  request: { params: WorkflowRunIdParam },
  responses: {
    200: {
      description: "Run cancelled",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("CancelWorkflowRunResponse") } },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Run not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// PROMPTS (proxy to content-generation service)
// ===================================================================

export const PromptResponseSchema = z
  .object({
    id: z.string().describe("Prompt ID"),
    type: z.string().describe("Prompt type identifier (e.g. 'cold-email', 'cold-email-v2')"),
    prompt: z.string().describe("Prompt template text with {{variable}} placeholders"),
    variables: z.array(z.string()).describe("List of expected variable names used in the prompt"),
    createdAt: z.string().describe("ISO 8601 creation timestamp"),
    updatedAt: z.string().describe("ISO 8601 last-updated timestamp"),
  })
  .openapi("PromptResponse");

registry.registerPath({
  method: "get",
  path: "/v1/prompts",
  tags: ["Prompts"],
  summary: "Get a prompt template",
  description:
    "Returns a prompt template by type from the content-generation service. " +
    "Includes the template text and its declared variables.",
  security: authed,
  request: {
    query: z.object({
      type: z.string().describe("Prompt type to look up (e.g. 'cold-email')"),
    }),
  },
  responses: {
    200: {
      description: "Prompt template found",
      content: { "application/json": { schema: PromptResponseSchema } },
    },
    400: { description: "Missing type query parameter", content: errorContent },
    404: { description: "Prompt not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

export const VersionPromptRequestSchema = z
  .object({
    sourceType: z.string().min(1).describe("The type of the prompt to create a new version from (e.g. 'cold-email')"),
    prompt: z.string().min(1).describe("New prompt template text with {{variable}} placeholders. Must NOT contain company-specific data."),
    variables: z.array(z.string()).min(1).describe("List of expected variable names used in the prompt"),
  })
  .openapi("VersionPromptRequest");

registry.registerPath({
  method: "put",
  path: "/v1/prompts",
  tags: ["Prompts"],
  summary: "Create a new prompt version",
  description:
    "Creates a new version of a prompt template with an auto-incremented type name. " +
    "For example, sourceType 'cold-email' creates 'cold-email-v2'. " +
    "The source prompt is never modified.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: VersionPromptRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "New versioned prompt created",
      content: { "application/json": { schema: PromptResponseSchema } },
    },
    400: { description: "Invalid request", content: errorContent },
    404: { description: "Source prompt not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// CAMPAIGNS SSE STREAM
// ===================================================================

registry.registerPath({
  method: "get",
  path: "/v1/campaigns/{id}/stream",
  tags: ["Campaigns"],
  summary: "Stream campaign updates (SSE)",
  description:
    "Server-Sent Events endpoint that pushes real-time campaign updates (new leads, emails, status changes). Connect with EventSource.",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "SSE stream of campaign events",
      content: {
        "text/event-stream": {
          schema: z.string().describe("Server-Sent Events stream"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// ACTIVITY
// ===================================================================

registry.registerPath({
  method: "post",
  path: "/v1/activity",
  tags: ["Activity"],
  summary: "Track user activity",
  description:
    "Records user activity event. Fires a transactional email deduped per user per day.",
  security: authed,
  responses: {
    200: {
      description: "Activity tracked",
      content: {
        "application/json": {
          schema: z
            .object({ ok: z.boolean() })
            .openapi("ActivityResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// CHAT
// ===================================================================

export const ChatConfigRequestSchema = z
  .object({
    key: z.string().min(1).describe('Config key identifying this configuration (e.g. "workflow", "feature")'),
    systemPrompt: z.string().min(1).describe("System prompt for the AI assistant"),
    allowedTools: z.array(z.string()).min(1).describe("List of MCP tool names this config is allowed to invoke"),
  })
  .openapi("ChatConfigRequest");

export const ChatMessageRequestSchema = z
  .object({
    message: z.string().min(1).describe("The user's chat message"),
    configKey: z
      .string()
      .min(1)
      .describe(
        'The config key to use for this chat session (e.g. "workflow", "feature"). ' +
        "Must match a key previously registered via PUT /config or PUT /platform-config.",
      ),
    sessionId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "UUID of an existing session to continue. " +
        "Omit to create a new session. When omitted, the service creates a new session and returns " +
        'its ID in the first SSE event ({"sessionId":"<uuid>"}). Use that ID in subsequent requests ' +
        "to continue the conversation. If a sessionId is provided but does not exist or belongs to " +
        'a different org, the stream returns a "Session not found." error and closes.',
      ),
    context: z
      .record(z.unknown())
      .optional()
      .describe(
        "Free-form JSON injected into the system prompt for this request only (not stored). " +
        "Use this to pass dynamic data like workflow IDs, brand URLs, campaign objectives, etc.",
      ),
  })
  .openapi("ChatMessageRequest");

// ── SSE event schemas (mirrored from chat-service for client documentation) ─

export const SSESessionEventSchema = z
  .object({
    sessionId: z.string().uuid().describe("The session UUID — store this for subsequent requests"),
  })
  .openapi("SSESessionEvent");

export const SSETokenEventSchema = z
  .object({
    type: z.literal("token"),
    content: z.string().describe("Incremental text fragment of the AI response"),
  })
  .openapi("SSETokenEvent");

export const SSEThinkingStartEventSchema = z
  .object({
    type: z.literal("thinking_start"),
  })
  .openapi("SSEThinkingStartEvent");

export const SSEThinkingDeltaEventSchema = z
  .object({
    type: z.literal("thinking_delta"),
    thinking: z.string().describe("Incremental fragment of the model's internal reasoning"),
  })
  .openapi("SSEThinkingDeltaEvent");

export const SSEThinkingStopEventSchema = z
  .object({
    type: z.literal("thinking_stop"),
  })
  .openapi("SSEThinkingStopEvent");

export const SSEToolCallEventSchema = z
  .object({
    type: z.literal("tool_call"),
    id: z.string().describe("Unique identifier (format: tc_<uuid>) — use this to match with the corresponding tool_result"),
    name: z.string().describe("The MCP tool name being invoked"),
    args: z.record(z.unknown()).describe("Input arguments passed to the tool, as a JSON object"),
  })
  .openapi("SSEToolCallEvent");

export const SSEToolResultEventSchema = z
  .object({
    type: z.literal("tool_result"),
    id: z.string().describe("Matches the id from the corresponding tool_call event"),
    name: z.string().describe("The MCP tool name that produced this result"),
    result: z.unknown().optional().describe("The tool output — can be a string or a JSON object"),
  })
  .openapi("SSEToolResultEvent");

export const SSEInputRequestEventSchema = z
  .object({
    type: z.literal("input_request"),
    input_type: z.enum(["url", "text", "email"]).describe("The type of input widget the frontend should render"),
    label: z.string().describe("Human-readable label/question for the input"),
    placeholder: z.string().optional().describe("Placeholder text for the input field"),
    field: z.string().describe("Identifier for what the input represents"),
    value: z.string().optional().describe(
      "Pre-filled value for the input field. When present, the frontend renders the field already populated " +
      "so the user can confirm with a single click. When absent, the field is empty.",
    ),
  })
  .openapi("SSEInputRequestEvent");

export const SSEButtonsEventSchema = z
  .object({
    type: z.literal("buttons"),
    buttons: z
      .array(
        z.object({
          label: z.string().describe("Button display text"),
          value: z.string().describe("Text to send as the next user message when the button is clicked"),
        }),
      )
      .describe("Quick-reply buttons extracted from the AI response"),
  })
  .openapi("SSEButtonsEvent");

export const SSEErrorEventSchema = z
  .object({
    type: z.literal("error"),
    message: z
      .string()
      .describe(
        "Human-readable error message to display to the user (e.g. empty model response, context overflow, safety filter)",
      ),
  })
  .openapi("SSEErrorEvent");

registry.registerPath({
  method: "put",
  path: "/v1/chat/config",
  tags: ["Chat"],
  summary: "Register chat app config",
  description:
    "Register or update app configuration for chat (system prompt). Requires app key authentication.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: ChatConfigRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Config registered",
      content: {
        "application/json": {
          schema: z.object({
            orgId: z.string().describe("Organization ID"),
            key: z.string().describe("Config key"),
            systemPrompt: z.string().describe("The registered system prompt"),
            allowedTools: z.array(z.string()).describe("Allowed MCP tool names"),
            createdAt: z.string().describe("ISO timestamp of creation"),
            updatedAt: z.string().describe("ISO timestamp of last update"),
          }).openapi("ChatConfigResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "App key required", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/chat",
  tags: ["Chat"],
  summary: "Stream chat response (SSE)",
  description:
    "Send a message and receive a streamed AI response via Server-Sent Events (SSE).\n\n" +
    "**Session lifecycle:**\n" +
    "- To start a new conversation, **omit `sessionId`**. The first SSE event will be " +
    '`data: {"sessionId":"<uuid>"}` — store this ID.\n' +
    "- To continue a conversation, pass that `sessionId` in subsequent requests.\n" +
    "- If a provided `sessionId` does not exist or belongs to a different org, " +
    "the stream returns an error and closes.\n\n" +
    "**SSE event order:**\n" +
    "Each `data:` line contains a JSON object. Events arrive in this order:\n\n" +
    '1. **Session** — `{"sessionId":"<uuid>"}` (always first)\n' +
    "2. **Thinking** *(optional)* — `thinking_start` → one or more `thinking_delta` → `thinking_stop`\n" +
    '3. **Tokens** — `{"type":"token","content":"..."}` streamed incrementally\n' +
    "4. **Tool calls** *(optional, repeatable)* — `tool_call` followed by `tool_result`, " +
    "then more thinking/tokens as the AI continues\n" +
    "5. **Input request** *(optional)* — `input_request` when the AI needs structured user input\n" +
    '6. **Buttons** *(optional)* — `{"type":"buttons","buttons":[...]}` with quick-reply options\n' +
    '7. **Error** *(optional)* — `{"type":"error","message":"..."}` when the model returns an empty response ' +
    "(e.g. context overflow, safety filter). Always followed by `[DONE]`.\n" +
    '8. **Done** — `"[DONE]"` (always last)\n\n' +
    "See the SSE event schemas (SSESessionEvent, SSETokenEvent, SSEToolCallEvent, etc.) for exact payload shapes.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: ChatMessageRequestSchema } },
    },
  },
  responses: {
    200: {
      description:
        "SSE stream of chat events. Each `data:` line is a JSON object matching one of the SSE event schemas " +
        "(SSESessionEvent, SSETokenEvent, SSEThinkingStartEvent, SSEThinkingDeltaEvent, SSEThinkingStopEvent, " +
        'SSEToolCallEvent, SSEToolResultEvent, SSEInputRequestEvent, SSEButtonsEvent, SSEErrorEvent), except the final `data: "[DONE]"` which is a plain string.',
      content: {
        "text/event-stream": {
          schema: z.string().describe("Server-Sent Events stream"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    402: {
      description:
        "Insufficient credits. The organization's credit balance is too low to process this request. " +
        "Response includes `balance_cents` (current balance) and `required_cents` (minimum needed).",
      content: errorContent,
    },
    404: {
      description:
        "Session not found (invalid or expired sessionId), or chat config not registered " +
        "(register via PUT /v1/chat/config or ensure platform config exists)",
      content: errorContent,
    },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// PLATFORM KEYS
// ===================================================================

export const PlatformKeyRequestSchema = z
  .object({
    provider: z.string().min(1).describe("Provider name (e.g. 'anthropic', 'stripe')"),
    apiKey: z.string().min(1).describe("The API key value"),
  })
  .openapi("PlatformKeyRequest");

registry.registerPath({
  method: "post",
  path: "/platform-keys",
  tags: ["Platform"],
  summary: "Register a platform key",
  description:
    "Register or update a platform-level API key for a provider. " +
    "Platform-level — no org/user identity required. " +
    "Used by the dashboard at cold start. Idempotent (safe to call on every boot).",
  security: platformAuth,
  request: {
    body: {
      content: { "application/json": { schema: PlatformKeyRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Key registered",
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }).openapi("PlatformKeyResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Invalid or missing platform API key", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// PLATFORM PROMPTS
// ===================================================================

export const PlatformPromptRequestSchema = z
  .object({
    type: z.string().min(1).describe("Prompt type (e.g. 'cold-email')"),
    prompt: z.string().min(1).describe("The prompt template text"),
    variables: z.array(z.string()).describe("Template variable names (e.g. ['leadFirstName', 'leadLastName'])"),
  })
  .openapi("PlatformPromptRequest");

registry.registerPath({
  method: "put",
  path: "/platform-prompts",
  tags: ["Platform"],
  summary: "Deploy a platform prompt",
  description:
    "Register or update a platform-level prompt template. " +
    "Platform-level — no org/user identity required. " +
    "Used by the dashboard at cold start. Idempotent (safe to call on every boot).",
  security: platformAuth,
  request: {
    body: {
      content: { "application/json": { schema: PlatformPromptRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Prompt deployed",
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }).openapi("PlatformPromptResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Invalid or missing platform API key", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// PLATFORM CHAT CONFIG
// ===================================================================

export const PlatformChatConfigRequestSchema = z
  .object({
    key: z.string().min(1).describe('Config key identifying this configuration (e.g. "workflow", "feature")'),
    systemPrompt: z.string().min(1).describe("System prompt for the AI assistant"),
    allowedTools: z.array(z.string()).min(1).describe("List of MCP tool names this config is allowed to invoke"),
  })
  .openapi("PlatformChatConfigRequest");

registry.registerPath({
  method: "put",
  path: "/platform-chat/config",
  tags: ["Chat"],
  summary: "Deploy platform-level chat config",
  description:
    "Register or update the global chat configuration (system prompt). " +
    "Platform-level — no org/user identity required. " +
    "Used by the dashboard at cold start. Idempotent (safe to call on every boot).",
  security: platformAuth,
  request: {
    body: {
      content: { "application/json": { schema: PlatformChatConfigRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Config registered",
      content: {
        "application/json": {
          schema: z.object({
            key: z.string().describe("Config key"),
            systemPrompt: z.string().describe("The registered system prompt"),
            allowedTools: z.array(z.string()).describe("Allowed MCP tool names"),
            createdAt: z.string().describe("ISO timestamp of creation"),
            updatedAt: z.string().describe("ISO timestamp of last update"),
          }).openapi("PlatformChatConfigResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Invalid or missing platform API key", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// BILLING
// ===================================================================

export const ConfigureAutoReloadRequestSchema = z
  .object({
    reload_amount_cents: z
      .number()
      .int()
      .positive()
      .describe("Auto-reload amount in cents"),
    reload_threshold_cents: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Balance threshold in cents that triggers auto-reload"),
  })
  .openapi("ConfigureAutoReloadRequest");

export const DeductCreditsRequestSchema = z
  .object({
    amount_cents: z.number().int().positive().describe("Amount to deduct in cents"),
    description: z.string().min(1).describe("Reason for the deduction"),
    user_id: z.string().uuid().optional().describe("User ID"),
  })
  .openapi("DeductCreditsRequest");

export const CreateCheckoutSessionRequestSchema = z
  .object({
    success_url: z.string().url().describe("URL to redirect after successful payment"),
    cancel_url: z.string().url().describe("URL to redirect on cancellation"),
    reload_amount_cents: z
      .number()
      .int()
      .positive()
      .describe("Amount to reload in cents"),
  })
  .openapi("CreateCheckoutSessionRequest");

export const CreatePortalSessionRequestSchema = z
  .object({
    return_url: z.string().url().describe("URL to redirect after the portal session ends"),
  })
  .openapi("CreatePortalSessionRequest");

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts",
  tags: ["Billing"],
  summary: "Get billing account",
  description: "Get or create the billing account for the organization. If no account exists, one is auto-created with a Stripe customer and $2 trial credit.",
  security: authed,
  responses: {
    200: {
      description: "Billing account data",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().describe("Account ID"),
            orgId: z.string().describe("Organization ID"),
            creditBalanceCents: z.number().describe("Current credit balance in cents"),
            hasAutoReload: z.boolean().describe("Whether auto-reload is enabled (true when payment method + reload config are both set)"),
            hasPaymentMethod: z.boolean().describe("Whether a payment method is on file"),
            reloadAmountCents: z.number().nullable().describe("Auto-reload amount in cents (null if not configured)"),
            reloadThresholdCents: z.number().nullable().describe("Balance threshold in cents that triggers auto-reload (null if not configured)"),
            createdAt: z.string().describe("ISO timestamp"),
          }).openapi("BillingAccountResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/balance",
  tags: ["Billing"],
  summary: "Get account balance",
  description:
    "Quick check of current balance and depletion status. Auto-creates billing account if none exists.",
  security: authed,
  responses: {
    200: {
      description: "Balance info",
      content: {
        "application/json": {
          schema: z.object({
            balance_cents: z.number().describe("Current balance in cents"),
            depleted: z.boolean().describe("True if balance is zero or negative"),
          }).openapi("BalanceResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/transactions",
  tags: ["Billing"],
  summary: "Get transaction history",
  description: "List billing transactions for the organization",
  security: authed,
  responses: {
    200: {
      description: "Transaction list",
      content: {
        "application/json": {
          schema: z.object({
            transactions: z.array(z.object({
              id: z.string().describe("Transaction ID"),
              type: z.string().describe("Transaction type (e.g. 'credit', 'debit')"),
              amountCents: z.number().describe("Amount in cents"),
              description: z.string().describe("Transaction description"),
              createdAt: z.string().describe("ISO timestamp"),
            })),
          }).openapi("TransactionListResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/billing/accounts/auto-reload",
  tags: ["Billing"],
  summary: "Configure auto-reload",
  description: "Enable or update auto-reload settings for the billing account. Requires a payment method on file.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: ConfigureAutoReloadRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Auto-reload configured",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().describe("Account ID"),
            orgId: z.string().describe("Organization ID"),
            creditBalanceCents: z.number().describe("Current credit balance in cents"),
            hasAutoReload: z.boolean().describe("Whether auto-reload is enabled"),
            hasPaymentMethod: z.boolean().describe("Whether a payment method is on file"),
            reloadAmountCents: z.number().nullable().describe("Auto-reload amount in cents"),
            reloadThresholdCents: z.number().nullable().describe("Balance threshold in cents that triggers auto-reload"),
            createdAt: z.string().describe("ISO timestamp"),
          }).openapi("ConfigureAutoReloadResponse"),
        },
      },
    },
    400: { description: "No payment method on file", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/billing/accounts/auto-reload",
  tags: ["Billing"],
  summary: "Disable auto-reload",
  description: "Disable auto-reload for the billing account",
  security: authed,
  responses: {
    200: {
      description: "Auto-reload disabled",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().describe("Account ID"),
            orgId: z.string().describe("Organization ID"),
            creditBalanceCents: z.number().describe("Current credit balance in cents"),
            hasAutoReload: z.boolean().describe("Whether auto-reload is enabled"),
            hasPaymentMethod: z.boolean().describe("Whether a payment method is on file"),
            reloadAmountCents: z.number().nullable().describe("Auto-reload amount in cents"),
            reloadThresholdCents: z.number().nullable().describe("Balance threshold in cents that triggers auto-reload"),
            createdAt: z.string().describe("ISO timestamp"),
          }).openapi("DisableAutoReloadResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/credits/deduct",
  tags: ["Billing"],
  summary: "Deduct credits",
  description: "Deduct credits from the organization's billing account. Accepts negative balances — if insufficient and auto-reload fails, the deduction still goes through. Auto-creates billing account if none exists.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: DeductCreditsRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Credits deducted",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().describe("Whether the deduction succeeded"),
            balance_cents: z.number().describe("Balance after deduction"),
            depleted: z.boolean().describe("True if balance is zero or negative after deduction"),
          }).openapi("DeductCreditsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/checkout-sessions",
  tags: ["Billing"],
  summary: "Create Stripe checkout session",
  description: "Create a Stripe checkout session for purchasing credits",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: CreateCheckoutSessionRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Checkout session created with URL",
      content: {
        "application/json": {
          schema: z.object({
            url: z.string().describe("Stripe Checkout URL to redirect the user to"),
            sessionId: z.string().describe("Stripe Checkout session ID"),
          }).openapi("BillingCheckoutResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/portal-sessions",
  tags: ["Billing"],
  summary: "Create Stripe portal session",
  description: "Create a Stripe billing portal session for managing payment methods and subscriptions",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: CreatePortalSessionRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Portal session created with URL",
      content: {
        "application/json": {
          schema: z.object({
            url: z.string().describe("Stripe portal URL to redirect the user to"),
          }).openapi("BillingPortalSessionResponse"),
        },
      },
    },
    400: { description: "No Stripe customer found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});


// ===================================================================
// TRANSACTIONAL EMAILS
// ===================================================================

export const SendEmailRequestSchema = z
  .object({
    eventType: z.string().min(1).describe("Event type determining which template to use (e.g. 'webinar_welcome', 'j_minus_1')"),
    recipientEmail: z.string().email().optional().describe("Direct recipient email (fallback when no userId on the key)"),
    brandId: z.string().optional().describe("Brand ID for tracking"),
    campaignId: z.string().optional().describe("Campaign ID for tracking"),
    productId: z.string().optional().describe("Product/instance ID for product-scoped dedup (e.g. webinar ID)"),
    metadata: z.record(z.unknown()).optional().describe("Template variables for {{variable}} interpolation"),
  })
  .openapi("SendEmailRequest");

export const EmailStatsRequestSchema = z
  .object({
    eventType: z.string().optional().describe("Filter by event type"),
  })
  .openapi("EmailStatsRequest");

const TemplateItemSchema = z.object({
  name: z.string().min(1).describe("Template name (unique per app)"),
  subject: z.string().min(1).describe("Email subject line"),
  htmlBody: z.string().min(1).describe("HTML body with {{variable}} interpolation"),
  textBody: z.string().optional().describe("Plain text body (optional)"),
  from: z.string().optional().describe('Sender address, e.g. "Display Name <email@domain.com>"'),
  messageStream: z.string().optional().describe('Postmark message stream ID, e.g. "outbound" or "broadcast"'),
});

export const DeployEmailTemplatesRequestSchema = z
  .object({
    templates: z.array(TemplateItemSchema).min(1).describe("Templates to deploy"),
  })
  .openapi("DeployEmailTemplatesRequest");

registry.registerPath({
  method: "post",
  path: "/v1/emails/send",
  tags: ["Emails"],
  summary: "Send a transactional email",
  description:
    "Send a templated transactional email. Uses the org context for template lookup and dedup. " +
    "Dedup strategy depends on eventType (once-only, daily, product-scoped, or none).",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: SendEmailRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Email send results",
      content: {
        "application/json": {
          schema: z.object({
            sent: z.boolean().describe("Whether the email was sent"),
            messageId: z.string().optional().describe("Postmark message ID"),
            deduplicated: z.boolean().optional().describe("True if skipped due to dedup rules"),
          }).openapi("SendEmailResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/emails/stats",
  tags: ["Emails"],
  summary: "Get email stats",
  description: "Get aggregated email sending stats for the org. Filterable by eventType, workflowSlug, featureSlug, workflowDynastySlug, or featureDynastySlug.",
  security: authed,
  request: {
    query: z.object({
      eventType: z.string().optional().describe("Filter by event type"),
      workflowSlug: z.string().optional().describe("Filter by exact workflow slug"),
      featureSlug: z.string().optional().describe("Filter by exact feature slug"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
      featureDynastySlug: z.string().optional().describe("Filter by feature dynasty slug (resolved to all versioned slugs)"),
    }),
  },
  responses: {
    200: {
      description: "Aggregated email stats",
      content: {
        "application/json": {
          schema: z
            .object({
              stats: z.object({
                totalEmails: z.number().describe("Total email events"),
                sent: z.number().describe("Successfully sent"),
                failed: z.number().describe("Failed to send"),
              }),
            })
            .openapi("TransactionalEmailStatsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/emails/templates",
  tags: ["Emails"],
  summary: "Deploy email templates",
  description:
    "Idempotent upsert of email templates. Safe to call on every cold start. " +
    "Templates support {{variable}} interpolation from metadata passed at send time.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: DeployEmailTemplatesRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Templates deployed",
      content: {
        "application/json": {
          schema: z.object({
            deployed: z.number().describe("Number of templates deployed"),
            message: z.string().describe("Confirmation message"),
          }).openapi("DeployTemplatesResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ── Internal (platform-level) ──

registry.registerPath({
  method: "put",
  path: "/internal/emails/templates",
  tags: ["Internal"],
  summary: "Deploy email templates (platform)",
  description:
    "Platform-level template deployment — no identity headers required. " +
    "Authenticated by X-API-Key only. Used at cold start when no Clerk session exists. " +
    "Same body format as PUT /v1/emails/templates.",
  security: platformAuth,
  request: {
    body: {
      content: { "application/json": { schema: DeployEmailTemplatesRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Templates deployed",
      content: {
        "application/json": {
          schema: z.object({
            deployed: z.number(),
            message: z.string(),
          }).openapi("InternalDeployTemplatesResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// STRIPE (e-commerce — products, prices, coupons, checkout)
// ===================================================================

export const CreateStripeProductRequestSchema = z
  .object({
    name: z.string().min(1).describe("Product name"),
    description: z.string().optional().describe("Product description"),
    metadata: z.record(z.string()).optional().describe("Arbitrary key-value metadata"),
  })
  .openapi("CreateStripeProductRequest");

export const CreateStripePriceRequestSchema = z
  .object({
    productId: z.string().min(1).describe("Stripe product ID"),
    unitAmountCents: z.number().int().min(0).describe("Price in cents"),
    currency: z.string().min(3).max(3).default("usd").describe("ISO 4217 currency code"),
    recurring: z
      .object({
        interval: z.enum(["day", "week", "month", "year"]).describe("Billing interval"),
      })
      .optional()
      .describe("Recurring pricing config (omit for one-time)"),
  })
  .openapi("CreateStripePriceRequest");

export const CreateStripeCouponRequestSchema = z
  .object({
    id: z.string().optional().describe("Custom coupon ID (auto-generated if omitted)"),
    percentOff: z.number().min(0).max(100).optional().describe("Percent discount (0-100)"),
    amountOffCents: z.number().int().min(0).optional().describe("Fixed discount in cents"),
    currency: z.string().min(3).max(3).optional().describe("Currency for amountOff (required if amountOff is set)"),
    duration: z.enum(["once", "repeating", "forever"]).describe("How long the coupon applies"),
    durationInMonths: z.number().int().min(1).optional().describe("Months for 'repeating' duration"),
  })
  .openapi("CreateStripeCouponRequest");

const LineItemSchema = z.object({
  priceId: z.string().min(1).describe("Stripe price ID"),
  quantity: z.number().int().min(1).default(1).describe("Quantity"),
});

const DiscountSchema = z.object({
  couponId: z.string().min(1).describe("Stripe coupon ID"),
});

export const CreateStripeCheckoutRequestSchema = z
  .object({
    lineItems: z.array(LineItemSchema).min(1).describe("Line items for checkout"),
    mode: z.enum(["payment", "subscription"]).default("payment").describe("Checkout mode"),
    successUrl: z.string().url().describe("Redirect URL after success"),
    cancelUrl: z.string().url().describe("Redirect URL after cancel"),
    customerEmail: z.string().email().optional().describe("Pre-fill customer email"),
    customerId: z.string().optional().describe("Existing Stripe customer ID"),
    discounts: z.array(DiscountSchema).optional().describe("Coupons to apply"),
    metadata: z.record(z.string()).optional().describe("Metadata for the checkout session"),
  })
  .openapi("CreateStripeCheckoutRequest");

export const StripeStatsRequestSchema = z
  .object({
    brandId: z.string().optional().describe("Filter by brand ID"),
    campaignId: z.string().optional().describe("Filter by campaign ID"),
    runIds: z.array(z.string()).optional().describe("Filter by run IDs"),
  })
  .openapi("StripeStatsRequest");

// --- OpenAPI registrations ---

registry.registerPath({
  method: "get",
  path: "/v1/stripe/products/{productId}",
  tags: ["Stripe"],
  summary: "Get a Stripe product",
  description: "Retrieve a Stripe product by ID. Uses the app's Stripe key via key-service. No org context required.",
  security: authed,
  request: {
    params: z.object({ productId: z.string().describe("Stripe product ID") }),
  },
  responses: {
    200: {
      description: "Stripe product",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().describe("Stripe product ID"),
            name: z.string().describe("Product name"),
            description: z.string().nullable().describe("Product description"),
            active: z.boolean().describe("Whether the product is active"),
            metadata: z.record(z.string()).describe("Product metadata"),
          }).openapi("StripeProductResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/stripe/products",
  tags: ["Stripe"],
  summary: "Create a Stripe product",
  description: "Create a new Stripe product. Idempotent — returns existing product if the ID already exists. No org context required (app-level operation).",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: CreateStripeProductRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Created/existing product",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().describe("Stripe product ID"),
            name: z.string().describe("Product name"),
            active: z.boolean().describe("Whether the product is active"),
          }).openapi("CreateStripeProductResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/stripe/products/{productId}/prices",
  tags: ["Stripe"],
  summary: "List prices for a product",
  description: "List all active prices for a Stripe product. No org context required.",
  security: authed,
  request: {
    params: z.object({ productId: z.string().describe("Stripe product ID") }),
  },
  responses: {
    200: {
      description: "List of active prices",
      content: {
        "application/json": {
          schema: z.object({
            prices: z.array(z.object({
              id: z.string().describe("Stripe price ID"),
              unitAmount: z.number().describe("Price in smallest currency unit (cents)"),
              currency: z.string().describe("ISO 4217 currency code"),
              recurring: z.object({
                interval: z.string().describe("Billing interval"),
              }).nullable().describe("Null for one-time prices"),
              active: z.boolean().describe("Whether the price is active"),
            })),
          }).openapi("ListPricesResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/stripe/prices",
  tags: ["Stripe"],
  summary: "Create a Stripe price",
  description: "Create a new price for a product. Supports one-time and recurring pricing. No org context required (app-level operation).",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: CreateStripePriceRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Created price",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().describe("Stripe price ID"),
            unitAmount: z.number().describe("Price in cents"),
            currency: z.string().describe("Currency code"),
          }).openapi("CreateStripePriceResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/stripe/coupons/{couponId}",
  tags: ["Stripe"],
  summary: "Get a Stripe coupon",
  description: "Retrieve a Stripe coupon by ID. No org context required.",
  security: authed,
  request: {
    params: z.object({ couponId: z.string().describe("Stripe coupon ID") }),
  },
  responses: {
    200: {
      description: "Stripe coupon",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().describe("Coupon ID"),
            percentOff: z.number().nullable().describe("Percent discount"),
            amountOff: z.number().nullable().describe("Fixed discount in smallest currency unit"),
            currency: z.string().nullable().describe("Currency for amountOff"),
            duration: z.string().describe("Duration type"),
            valid: z.boolean().describe("Whether the coupon is still valid"),
          }).openapi("StripeCouponResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/stripe/coupons",
  tags: ["Stripe"],
  summary: "Create a Stripe coupon",
  description: "Create a new coupon. Supports percent or fixed-amount discounts. No org context required (app-level operation).",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: CreateStripeCouponRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Created coupon",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().describe("Coupon ID"),
            percentOff: z.number().nullable(),
            amountOff: z.number().nullable(),
            duration: z.string(),
          }).openapi("CreateStripeCouponResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/stripe/checkout",
  tags: ["Stripe"],
  summary: "Create a Stripe Checkout session",
  description:
    "Create a Stripe Checkout session for payment or subscription. Returns the checkout URL to redirect the customer.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: CreateStripeCheckoutRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Checkout session with URL",
      content: {
        "application/json": {
          schema: z.object({
            url: z.string().describe("Stripe Checkout URL to redirect the customer to"),
            sessionId: z.string().describe("Stripe Checkout session ID"),
          }).openapi("StripeCheckoutResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/stripe/stats",
  tags: ["Stripe"],
  summary: "Get Stripe sales stats",
  description: "Get aggregated sales stats. Filterable by brandId, campaignId, runIds, workflowSlug, featureSlug, workflowDynastySlug, or featureDynastySlug.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().optional().describe("Filter by brand ID"),
      campaignId: z.string().optional().describe("Filter by campaign ID"),
      runIds: z.string().optional().describe("Comma-separated run IDs"),
      workflowSlug: z.string().optional().describe("Filter by exact workflow slug"),
      featureSlug: z.string().optional().describe("Filter by exact feature slug"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
      featureDynastySlug: z.string().optional().describe("Filter by feature dynasty slug (resolved to all versioned slugs)"),
    }),
  },
  responses: {
    200: {
      description: "Aggregated sales stats",
      content: {
        "application/json": {
          schema: z
            .object({
              totalPayments: z.number().describe("Total number of payments"),
              totalAmountInCents: z.number().describe("Total payment amount in cents"),
              successCount: z.number().describe("Successful payments"),
              failureCount: z.number().describe("Failed payments"),
              refundCount: z.number().describe("Refunded payments"),
              disputeCount: z.number().describe("Disputed payments"),
            })
            .openapi("StripeStatsResponse"),
        },
      },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// USERS
// ===================================================================

export const ResolveUserRequestSchema = z
  .object({
    externalOrgId: z.string().min(1).describe("External organization ID from identity provider"),
    externalUserId: z.string().min(1).describe("External user ID — use a generated UUID for anonymous users"),
    email: z.string().email().optional().describe("User email address"),
    firstName: z.string().optional().describe("User first name"),
    lastName: z.string().optional().describe("User last name"),
    imageUrl: z.string().url().optional().describe("User avatar URL"),
  })
  .openapi("ResolveUserRequest");

export const ResolveUserResponseSchema = z
  .object({
    orgId: z.string().uuid().describe("Internal organization UUID"),
    userId: z.string().uuid().describe("Internal user UUID"),
    orgCreated: z.boolean().describe("Whether a new org was created"),
    userCreated: z.boolean().describe("Whether a new user was created"),
  })
  .openapi("ResolveUserResponse");

registry.registerPath({
  method: "post",
  path: "/v1/users/resolve",
  tags: ["Users"],
  summary: "Resolve external user identity",
  description:
    "Map external org/user IDs to internal UUIDs via client-service (idempotent upsert). " +
    "For anonymous users, generate a UUID as externalUserId — each call with a new ID creates a new user. " +
    "Calling again with the same IDs updates optional contact fields (email, firstName, etc.).",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: ResolveUserRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Resolved identity",
      content: { "application/json": { schema: ResolveUserResponseSchema } },
    },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// --- GET /v1/users --- list users for an org ---

export const ListUsersQuerySchema = z
  .object({
    email: z.string().email().optional().describe("Filter by exact email address"),
    limit: z.coerce.number().int().min(1).max(200).default(50).describe("Max results (1–200, default 50)"),
    offset: z.coerce.number().int().min(0).default(0).describe("Pagination offset (default 0)"),
  })
  .openapi("ListUsersQuery");

export const ListUsersUserSchema = z
  .object({
    id: z.string().uuid().describe("Internal user UUID"),
    externalId: z.string().describe("External user ID from identity provider"),
    email: z.string().nullable().describe("User email address"),
    firstName: z.string().nullable().describe("User first name"),
    lastName: z.string().nullable().describe("User last name"),
    imageUrl: z.string().nullable().describe("User avatar URL"),
    phone: z.string().nullable().describe("User phone number"),
    createdAt: z.string().describe("ISO timestamp of user creation"),
  })
  .openapi("ListUsersUser");

export const ListUsersResponseSchema = z
  .object({
    users: z.array(ListUsersUserSchema).describe("List of users"),
    total: z.number().int().describe("Total number of users matching the query"),
    limit: z.number().int().describe("Limit used for this page"),
    offset: z.number().int().describe("Offset used for this page"),
  })
  .openapi("ListUsersResponse");

registry.registerPath({
  method: "get",
  path: "/v1/users",
  tags: ["Users"],
  summary: "List users for the authenticated org",
  description:
    "Returns paginated users belonging to the caller's organization. " +
    "Supports optional email filtering and offset-based pagination.",
  security: authed,
  request: {
    query: ListUsersQuerySchema,
  },
  responses: {
    200: {
      description: "Paginated user list",
      content: { "application/json": { schema: ListUsersResponseSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// PLATFORM (api-registry proxies)
// ===================================================================

const PlatformServiceSchema = z
  .object({
    name: z.string().describe("Service name (e.g. 'lead', 'campaign')"),
    baseUrl: z.string().describe("Service base URL"),
    openapiUrl: z.string().describe("URL to the service's OpenAPI spec"),
  })
  .openapi("PlatformService");

const PlatformServicesResponseSchema = z
  .object({
    services: z.array(PlatformServiceSchema).describe("List of registered platform services"),
  })
  .openapi("PlatformServicesResponse");

registry.registerPath({
  method: "get",
  path: "/v1/platform/services",
  tags: ["Platform"],
  summary: "List all platform services",
  description:
    "Returns the list of all registered services on the platform. " +
    "Proxied from api-registry. Useful for service discovery.",
  security: authed,
  responses: {
    200: {
      description: "List of platform services",
      content: { "application/json": { schema: PlatformServicesResponseSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

const ServiceNameParam = z.object({
  service: z.string().describe("Service name (e.g. 'lead', 'campaign', 'workflow')"),
});

registry.registerPath({
  method: "get",
  path: "/v1/platform/services/{service}",
  tags: ["Platform"],
  summary: "Get OpenAPI spec for a service",
  description:
    "Returns the full OpenAPI specification for a specific platform service. " +
    "Proxied from api-registry. Use this to discover available endpoints, request/response schemas, and more.",
  security: authed,
  request: {
    params: ServiceNameParam,
  },
  responses: {
    200: {
      description: "OpenAPI specification",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("OpenApiSpec") } },
    },
    404: { description: "Service not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

const LlmEndpointSummarySchema = z
  .object({
    method: z.string().describe("HTTP method"),
    path: z.string().describe("Endpoint path"),
    summary: z.string().describe("Endpoint summary"),
    params: z.array(z.object({
      name: z.string(),
      in: z.string(),
      required: z.boolean(),
    })).optional().describe("Endpoint parameters"),
    bodyFields: z.array(z.string()).optional().describe("Request body field names"),
  })
  .openapi("LlmEndpointSummary");

const LlmServiceSummarySchema = z
  .object({
    service: z.string().describe("Service name"),
    baseUrl: z.string().describe("Service base URL"),
    title: z.string().optional().describe("Service title"),
    description: z.string().optional().describe("Service description"),
    endpoints: z.array(LlmEndpointSummarySchema).describe("Available endpoints"),
  })
  .openapi("LlmServiceSummary");

const LlmContextResponseSchema = z
  .object({
    _description: z.string().describe("Description of this context payload"),
    _usage: z.string().describe("Usage instructions for LLMs"),
    services: z.array(LlmServiceSummarySchema).describe("All platform services with their endpoints"),
  })
  .openapi("LlmContextResponse");

// ---------------------------------------------------------------------------
// ===================================================================
// PRESS KITS (proxy to press-kits-service)
// ===================================================================

const PressKitMediaKitStatusEnum = z
  .enum(["drafted", "generating", "validated", "denied", "failed", "archived"])
  .openapi("PressKitMediaKitStatus");

// ── Public endpoints (no auth) ──────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/press-kits/public/{token}",
  tags: ["Press Kits"],
  summary: "Get public press kit by share token",
  description: "Returns the public-facing press kit for journalists. No authentication required.",
  responses: {
    200: { description: "Public press kit data", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicPressKitResponse") } } },
    404: { description: "Not found", content: errorContent },
  },
});

// ── Authenticated endpoints ─────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/v1/press-kits/media-kits",
  tags: ["Press Kits"],
  summary: "List media kits",
  description: "List media kits, optionally filtered by org_id, organization_id, campaign_id, brand_id, or title.",
  security: authed,
  request: {
    query: z.object({
      org_id: z.string().optional().describe("Filter by org ID"),
      campaign_id: z.string().optional().describe("Filter by campaign ID — returns media kit(s) linked to this campaign"),
      brand_id: z.string().optional().describe("Filter by brand ID — returns media kit(s) linked to this brand"),
      title: z.string().optional().describe("Filter by title"),
    }),
  },
  responses: {
    200: { description: "Media kits list", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitMediaKitListResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/press-kits/media-kits/{id}",
  tags: ["Press Kits"],
  summary: "Get media kit by ID",
  security: authed,
  responses: {
    200: { description: "Media kit", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitMediaKitDetailResponse") } } },
    404: { description: "Not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/press-kits/media-kits",
  tags: ["Press Kits"],
  summary: "Create or edit media kit",
  description:
    "Idempotent create-or-edit. The org is identified via the `x-org-id` header. " +
    "The service auto-finds the latest active kit or creates a new one.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: z.object({ instruction: z.string().describe("Instructions for the generation") }).openapi("PressKitCreateEditRequest") } } },
  },
  responses: {
    200: { description: "Generation initiated", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitCreateEditResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/press-kits/media-kits/{id}/mdx",
  tags: ["Press Kits"],
  summary: "Update MDX content",
  description: "Update the MDX content of a specific media kit. Kit ID is in the URL.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: z.object({ mdxContent: z.string() }).openapi("PressKitUpdateMdxRequest") } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitUpdateMdxResponse") } } },
    404: { description: "Not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/press-kits/media-kits/{id}/status",
  tags: ["Press Kits"],
  summary: "Update media kit status",
  description: "Change the status of a specific media kit. Kit ID is in the URL.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: z.object({ status: PressKitMediaKitStatusEnum, denialReason: z.string().optional() }).openapi("PressKitUpdateStatusRequest") } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitUpdateStatusResponse") } } },
    404: { description: "Not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/press-kits/media-kits/{id}/validate",
  tags: ["Press Kits"],
  summary: "Validate media kit",
  description: "Validate a specific media kit. Kit ID is in the URL, no body required.",
  security: authed,
  responses: {
    200: { description: "Validated", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitValidateResponse") } } },
    404: { description: "Not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/press-kits/media-kits/{id}/cancel",
  tags: ["Press Kits"],
  summary: "Cancel draft media kit",
  description: "Cancel a draft media kit. Kit ID is in the URL, no body required.",
  security: authed,
  responses: {
    200: { description: "Draft cancelled", content: { "application/json": { schema: z.object({ success: z.boolean() }).openapi("PressKitCancelDraftResponse") } } },
    404: { description: "Not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ── Admin endpoints ─────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/v1/press-kits/admin/media-kits",
  tags: ["Press Kits"],
  summary: "List media kits (admin)",
  security: authed,
  responses: {
    200: { description: "Admin org list", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitAdminOrgListResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/press-kits/admin/media-kits/{id}",
  tags: ["Press Kits"],
  summary: "Delete media kit (admin)",
  security: authed,
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: z.object({ success: z.boolean() }).openapi("PressKitAdminDeleteResponse") } } },
    400: { description: "Bad request", content: errorContent },
    404: { description: "Not found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

// ── Internal endpoints ──────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/v1/press-kits/internal/media-kits/current",
  tags: ["Internal"],
  summary: "Get latest media kit for org (internal)",
  description: "Uses x-org-id header to identify the org. No path param needed.",
  security: authed,
  request: {
    query: z.object({
      brand_id: z.string().optional().describe("Filter by brand UUID"),
      campaign_id: z.string().optional().describe("Filter by campaign UUID"),
    }),
  },
  responses: {
    200: { description: "Media kit", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitInternalCurrentResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/press-kits/internal/media-kits/generation-data",
  tags: ["Internal"],
  summary: "Get generation workflow data (internal)",
  description: "Uses x-org-id header to identify the org.",
  security: authed,
  request: {
    query: z.object({
      media_kit_id: z.string().optional().describe("Target a specific kit. If omitted, finds the generating kit for the org."),
    }),
  },
  responses: {
    200: { description: "Generation data", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitGenerationDataResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/press-kits/internal/media-kits/generation-result",
  tags: ["Internal"],
  summary: "Upsert generation result (internal)",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: z.object({ mdxContent: z.string(), title: z.string().optional(), iconUrl: z.string().optional() }).openapi("PressKitUpsertGenerationRequest") } } },
  },
  responses: {
    200: { description: "Upserted", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitUpsertGenerationResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/press-kits/internal/email-data/{orgId}",
  tags: ["Internal"],
  summary: "Get press kit data for email templates (internal)",
  security: authed,
  responses: {
    200: { description: "Email template data", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitEmailDataResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/press-kits/media-kits/stats/views",
  tags: ["Press Kits"],
  summary: "Get media kit view stats",
  description:
    "Returns view statistics for media kits. Supports filtering by brandId, campaignId, mediaKitId, " +
    "date range (from/to), and grouping by country, mediaKitId, or day.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().optional().describe("Filter by brand ID"),
      campaignId: z.string().optional().describe("Filter by campaign ID"),
      mediaKitId: z.string().optional().describe("Filter by media kit ID"),
      featureSlug: z.string().optional().describe("Filter by feature slug"),
      workflowSlug: z.string().optional().describe("Filter by workflow slug"),
      featureDynastySlug: z.string().optional().describe("Filter by feature dynasty slug"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug"),
      from: z.string().optional().describe("Start date (ISO 8601)"),
      to: z.string().optional().describe("End date (ISO 8601)"),
      groupBy: z.enum(["country", "mediaKitId", "day"]).optional().describe("Group results by country, mediaKitId, or day"),
    }),
  },
  responses: {
    200: { description: "View statistics", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitMediaKitStatsViewsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/press-kits/media-kits/stats/costs",
  tags: ["Press Kits"],
  summary: "Get media kit cost stats",
  description:
    "Returns cost statistics for media kits. Supports filtering by mediaKitId, brandId, campaignId, " +
    "and grouping by mediaKitId. Costs include downstream service costs (chat-service, etc.) via run hierarchy. " +
    "Requires POST /v1/runs/costs/batch on runs-service to be deployed for costs to be visible.",
  security: authed,
  request: {
    query: z.object({
      mediaKitId: z.string().optional().describe("Filter by media kit ID"),
      brandId: z.string().optional().describe("Filter by brand ID"),
      campaignId: z.string().optional().describe("Filter by campaign ID"),
      featureSlug: z.string().optional().describe("Filter by feature slug"),
      workflowSlug: z.string().optional().describe("Filter by workflow slug"),
      featureDynastySlug: z.string().optional().describe("Filter by feature dynasty slug"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug"),
      groupBy: z.enum(["mediaKitId"]).optional().describe("Group results by mediaKitId"),
    }),
  },
  responses: {
    200: { description: "Cost statistics", content: { "application/json": { schema: z.object({}).passthrough().openapi("PressKitMediaKitStatsCostsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

// Content – Compose (proxy to content-generation-service)
// ---------------------------------------------------------------------------
export const ContentComposeRequestSchema = z
  .object({
    videoUrl: z.string().url().describe("Source video URL"),
    name: z.string().describe("Name to overlay"),
    age: z.number().describe("Age to overlay"),
    theme: z.string().describe("Theme text"),
    text: z.string().describe("Quote text to overlay"),
    outputBlobToken: z.string().describe("Vercel Blob write token for the output"),
    layout: z.enum(["quote-top", "webcam-top"]).default("quote-top").optional().describe("Video layout variant"),
  })
  .openapi("ContentComposeRequest");

export const ContentComposeResponseSchema = z
  .object({
    composedVideoUrl: z.string().url().describe("URL of the composed video"),
  })
  .openapi("ContentComposeResponse");

registry.registerPath({
  method: "post",
  path: "/v1/content/compose",
  tags: ["Content"],
  summary: "Compose a personalized video",
  description:
    "Proxy to content-generation-service POST /compose. " +
    "Composes a personalized video with overlaid text using FFmpeg + sharp, " +
    "then uploads the result to Vercel Blob.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: ContentComposeRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Composed video URL",
      content: { "application/json": { schema: ContentComposeResponseSchema } },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/platform/llm-context",
  tags: ["Platform"],
  summary: "Get LLM-friendly platform context",
  description:
    "Returns a compact summary of all platform services and their endpoints, optimized for LLM consumption. " +
    "Proxied from api-registry. Ideal for giving an LLM full platform awareness to answer questions " +
    "like 'what services exist?' or 'can the platform do X?'.",
  security: authed,
  responses: {
    200: {
      description: "LLM context with all services and endpoints",
      content: { "application/json": { schema: LlmContextResponseSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// FEATURES (proxy to features-service)
// ===================================================================

const FeaturePrefillRequestSchema = z
  .object({
    brandIds: z.array(z.string()).min(1).describe("Brand UUIDs to prefill from (CSV in x-brand-id header to features-service)"),
  })
  .openapi("FeaturePrefillRequest");

const FeaturePrefillFullValueSchema = z
  .object({
    value: z.any().describe("The prefilled value (string, object, or null)"),
    cached: z.boolean().describe("Whether this value was served from cache"),
    sourceUrls: z.array(z.string()).nullable().describe("URLs used to extract this value, or null"),
  })
  .openapi("FeaturePrefillFullValue");

const FeaturePrefillFullResponseSchema = z
  .object({
    prefilled: z
      .record(z.string(), FeaturePrefillFullValueSchema)
      .describe("Map of field name to rich prefill object with value, cached flag, and source URLs"),
  })
  .openapi("FeaturePrefillFullResponse");

const FeaturePrefillTextResponseSchema = z
  .object({
    prefilled: z
      .record(z.string(), z.string().nullable())
      .describe("Map of field name to flat string value (or null)"),
  })
  .openapi("FeaturePrefillTextResponse");

registry.registerPath({
  method: "get",
  path: "/v1/features",
  tags: ["Features"],
  summary: "List features",
  description:
    "List available features with optional filters. " +
    "Proxied from features-service.",
  security: authed,
  request: {
    query: z.object({
      status: z.string().optional().describe("Filter by status"),
      category: z.string().optional().describe("Filter by category"),
      channel: z.string().optional().describe("Filter by channel"),
      audienceType: z.string().optional().describe("Filter by audience type"),
      implemented: z.string().optional().describe("Filter by implementation status ('true' or 'false')"),
    }),
  },
  responses: {
    200: { description: "List of features", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeaturesListResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/dynasty",
  tags: ["Features"],
  summary: "Resolve feature dynasty",
  description:
    "Returns stable, unversioned dynasty identifiers (dynasty name and slug) for a given versioned feature slug. " +
    "Useful for composing workflow names. Proxied from features-service.",
  security: authed,
  request: {
    query: z.object({
      slug: z.string().describe("Versioned feature slug (e.g. 'pr-cold-email-outreach-v2')"),
    }),
  },
  responses: {
    200: {
      description: "Dynasty identifiers",
      content: {
        "application/json": {
          schema: z.object({
            feature_dynasty_name: z.string().describe("Stable dynasty display name"),
            feature_dynasty_slug: z.string().describe("Stable dynasty slug (unversioned)"),
          }).openapi("FeatureDynastyResponse"),
        },
      },
    },
    400: { description: "Missing slug parameter", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/by-dynasty/{dynastySlug}",
  tags: ["Features"],
  summary: "Get active feature by dynasty slug",
  description:
    "Returns the active feature definition for a dynasty slug (e.g. 'pr-cold-email-outreach'). " +
    "Returns 404 if no active feature exists for that dynasty. " +
    "Preferred over GET /features/{slug} when the dashboard works with dynasty slugs. Proxied from features-service.",
  security: authed,
  request: {
    params: z.object({ dynastySlug: z.string().openapi({ example: "pr-cold-email-outreach" }).describe("Dynasty slug (stable, unversioned — e.g. 'pr-cold-email-outreach')") }),
  },
  responses: {
    200: { description: "Active feature for the dynasty", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureByDynastyResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No active feature for this dynasty slug", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/{slug}",
  tags: ["Features"],
  summary: "Get feature by versioned slug",
  description: "Get a single feature definition by its exact versioned slug. Use GET /features/by-dynasty/{dynastySlug} when working with dynasty slugs. Proxied from features-service.",
  security: authed,
  request: {
    params: z.object({ slug: z.string().describe("Exact versioned feature slug") }),
  },
  responses: {
    200: { description: "Feature details", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/features/{slug}",
  tags: ["Features"],
  summary: "Update feature by slug",
  description: "Update a single feature definition by its slug. Metadata-only updates (description, icon, charts, etc.) apply in-place and return 200. If inputs or outputs change, a new feature is forked and the original is deprecated (fork-on-write) — returns 201 with forkedFrom details. Proxied from features-service.",
  security: authed,
  request: {
    params: z.object({ slug: z.string().describe("Feature slug") }),
    body: {
      content: { "application/json": { schema: z.object({}).passthrough().openapi("UpdateFeatureRequest") } },
    },
  },
  responses: {
    200: { description: "In-place update (metadata only)", content: { "application/json": { schema: z.object({}).passthrough().openapi("UpdateFeatureResponse") } } },
    201: { description: "Fork created (inputs/outputs changed). Response includes `forkedFrom` with the original feature's id, slug, and status.", content: { "application/json": { schema: z.object({}).passthrough().openapi("ForkedFeatureResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    409: { description: "Conflict (e.g. slug collision)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/{slug}/inputs",
  tags: ["Features"],
  summary: "Get feature input schema",
  description:
    "Get the input schema (required and optional fields) for a feature. " +
    "The slug param accepts both dynasty slugs (e.g. 'pr-cold-email-outreach') and versioned slugs. " +
    "Proxied from features-service.",
  security: authed,
  request: {
    params: z.object({ slug: z.string().openapi({ example: "pr-cold-email-outreach" }).describe("Feature slug (dynasty or versioned — both accepted)") }),
  },
  responses: {
    200: { description: "Feature input schema", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureInputsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/features/{slug}/prefill",
  tags: ["Features"],
  summary: "Prefill feature form from brand",
  description:
    "Prefill the 'New Campaign' form for a feature using brand data. " +
    "The slug param accepts both dynasty slugs (e.g. 'pr-cold-email-outreach') and versioned slugs. " +
    "Features-service calls brand-service internally to extract values. Proxied from features-service. " +
    "Use format=text for flat string values, format=full (default) for rich objects with cache/source metadata.",
  security: authed,
  request: {
    params: z.object({ slug: z.string().openapi({ example: "pr-cold-email-outreach" }).describe("Feature slug (dynasty or versioned — both accepted)") }),
    query: z.object({
      format: z
        .enum(["text", "full"])
        .optional()
        .describe("Response format. 'full' (default) returns objects with value/cached/sourceUrls. 'text' returns flat string values."),
    }),
    body: { content: { "application/json": { schema: FeaturePrefillRequestSchema } } },
  },
  responses: {
    200: {
      description: "Prefilled feature inputs. Shape depends on `format` query param.",
      content: {
        "application/json": {
          schema: z.union([FeaturePrefillFullResponseSchema, FeaturePrefillTextResponseSchema]).openapi("FeaturePrefillResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/stats/registry",
  tags: ["Features"],
  summary: "Stats key registry",
  description: "Public dictionary of stats keys with label and type per key. Proxied from features-service.",
  security: authed,
  responses: {
    200: { description: "Stats key registry", content: { "application/json": { schema: z.object({}).passthrough().openapi("StatsRegistryResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/stats",
  tags: ["Features"],
  summary: "Global stats cross-features",
  description:
    "Aggregated stats across all features. Supports groupBy (featureSlug, workflowSlug, featureDynastySlug, brandId, campaignId — comma-separated combos allowed) and optional filters. Requires x-org-id. Proxied from features-service.",
  security: authed,
  request: {
    query: z.object({
      groupBy: z.string().optional().openapi({ example: "featureDynastySlug" }).describe("Group dimension(s), comma-separated: featureSlug, workflowSlug, featureDynastySlug, brandId, campaignId"),
      brandId: z.string().optional().openapi({ example: "brand-uuid-123" }).describe("Filter by brand UUID"),
      campaignId: z.string().optional().describe("Filter by campaign UUID"),
      featureSlug: z.string().optional().openapi({ example: "pr-cold-email-outreach-v3" }).describe("Filter by exact feature slug"),
      workflowSlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-sienna-v3" }).describe("Filter by exact workflow slug"),
      featureDynastySlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature dynasty slug (resolved to all versioned slugs)"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
    }),
  },
  responses: {
    200: { description: "Global stats", content: { "application/json": { schema: z.object({}).passthrough().openapi("GlobalStatsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/{featureSlug}/stats",
  tags: ["Features"],
  summary: "Feature stats",
  description:
    "Stats for a specific feature, groupable by workflowSlug, brandId, or campaignId. Supports optional filters including featureDynastySlug. Requires x-org-id. Proxied from features-service.",
  security: authed,
  request: {
    params: z.object({ featureSlug: z.string().openapi({ example: "pr-cold-email-outreach-v3" }).describe("Feature slug") }),
    query: z.object({
      groupBy: z.string().optional().openapi({ example: "workflowSlug" }).describe("Group dimension: workflowSlug | brandId | campaignId"),
      brandId: z.string().optional().openapi({ example: "brand-uuid-123" }).describe("Filter by brand UUID"),
      campaignId: z.string().optional().openapi({ example: "campaign-uuid-456" }).describe("Filter by campaign UUID"),
      workflowSlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-sienna-v3" }).describe("Filter by exact workflow slug"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
    }),
  },
  responses: {
    200: { description: "Feature stats", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureStatsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/features",
  tags: ["Features"],
  summary: "Create a single feature",
  description: "Create a new feature definition with inputs, outputs, charts, and entities. Proxied from features-service.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureCreateRequest") } } },
  },
  responses: {
    201: { description: "Created feature", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureCreateResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: { description: "Conflict — feature with this name already exists", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/features",
  tags: ["Features"],
  summary: "Batch upsert features",
  description: "Idempotent batch upsert of feature definitions. Used for cold-start registration. Proxied from features-service.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("FeaturesBatchUpsertRequest") } } },
  },
  responses: {
    200: { description: "Upsert result", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeaturesBatchUpsertResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// PUBLIC FEATURES (no auth — landing page endpoints)
// ---------------------------------------------------------------------------

const PublicFeatureItemSchema = z.object({
  dynastyName: z.string().openapi({ example: "Sales Cold Email" }).describe("Stable dynasty display name"),
  dynastySlug: z.string().openapi({ example: "sales-cold-email" }).describe("Stable dynasty slug (unversioned)"),
  description: z.string().openapi({ example: "AI-powered cold email outreach campaigns" }),
  icon: z.string().openapi({ example: "mail" }).describe("Lucide icon name"),
  category: z.string().openapi({ example: "sales" }),
  channel: z.string().openapi({ example: "email" }),
  audienceType: z.string().openapi({ example: "cold-outreach" }),
  displayOrder: z.number().int().openapi({ example: 0 }),
}).openapi("PublicFeatureItem");

registry.registerPath({
  method: "get",
  path: "/public/features",
  tags: ["Features"],
  summary: "List active features (public, no auth)",
  description:
    "Returns all active features with display-safe fields only. " +
    "Designed for landing pages and public-facing UIs. Sorted by displayOrder ascending. " +
    "No authentication required. Proxied from features-service.",
  responses: {
    200: {
      description: "Active features",
      content: {
        "application/json": {
          schema: z.object({
            features: z.array(PublicFeatureItemSchema).describe("Active features sorted by displayOrder"),
          }).openapi("PublicFeaturesListResponse"),
        },
      },
    },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/public/features/dynasty/slugs",
  tags: ["Features"],
  summary: "List dynasty versioned slugs (public, no auth)",
  description:
    "Returns all versioned feature slugs (active + deprecated) belonging to a dynasty. " +
    "No authentication required. Proxied from features-service.",
  request: {
    query: z.object({
      dynastySlug: z.string().openapi({ example: "sales-cold-email" }).describe("The stable dynasty slug (unversioned)"),
    }),
  },
  responses: {
    200: {
      description: "Dynasty slugs",
      content: {
        "application/json": {
          schema: z.object({
            slugs: z.array(z.string()).describe("All versioned slugs in the dynasty, sorted by version ascending"),
          }).openapi("PublicDynastySlugsResponse"),
        },
      },
    },
    400: { description: "Missing dynastySlug parameter", content: errorContent },
    404: { description: "No features found for this dynasty slug", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});
