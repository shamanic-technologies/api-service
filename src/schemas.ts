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

export const AuthFailureResponseSchema = z
  .object({
    error: z.string().describe("Short error, unchanged from earlier versions (e.g. \"Invalid API key\")"),
    code: z
      .enum([
        "missing_credentials",
        "wrong_header",
        "invalid_admin_key",
        "malformed_key",
        "key_not_recognized",
        "key_validation_unavailable",
        "org_target_required",
        "org_not_member",
        "org_not_found",
        "brand_not_found",
        "brand_in_several_orgs",
        "brands_span_orgs",
        "no_organization",
        "membership_unavailable",
      ])
      .describe(
        "Why the request was refused before reaching a service. The `org_*` / `brand_*` / `no_organization` / `membership_unavailable` codes are about WHICH organization a user-key request acts in: name a brand (`brandId`) or an organization (`orgId`); `organizations` lists the choices when relevant. " +
        "The other codes say why authentication failed. `wrong_header` = a user key was sent in a header other than `Authorization`. `key_not_recognized` covers both a mistyped key and a revoked one: revoked keys are erased, so the two cannot be told apart. `key_validation_unavailable` (HTTP 503) means the key could not be checked and says nothing about its validity.",
      ),
    message: z.string().describe("What happened, in plain words"),
    fix: z.string().describe("What to do next"),
    organizations: z
      .array(z.object({ id: z.string(), name: z.string().nullable() }))
      .optional()
      .describe("For organization-target refusals: the organizations the caller can name with `orgId`"),
  })
  .openapi("AuthFailureResponse");

const authFailureContent = {
  "application/json": { schema: AuthFailureResponseSchema },
};

/** Success-first block placed FIRST in campaign stats responses (src/lib/stats-headline.ts). */
const StatsHeadlineSchema = z
  .object({
    meetingsBooked: z.number().nullable().describe("Replies classified as meeting booked (email-gateway repliesDetail.meetingBooked)"),
    positiveReplies: z.number().nullable().describe("Positive replies (email-gateway recipientStats.repliesPositive). 0 is shown as 0."),
    moneyEarnedInUsdCents: z.null().describe("Not served yet, see notServed"),
    roi: z.null().describe("Not served yet, see notServed"),
    deliveryRate: z.number().nullable().describe("delivered/sent as a 0..1 ratio, served by email-gateway (recipientStats.deliveryRate). null when nothing was sent, or when email-gateway could not be reached (see unavailable)"),
    delivered: z.number().nullable().describe("Recipients delivered (email-gateway recipientStats.delivered)"),
    sent: z.number().nullable().describe("Recipients sent (email-gateway recipientStats.sent)"),
    costInUsdCents: z.string().nullable().describe("Same value as the response's totalCostInUsdCents"),
    notServed: z.array(z.string()).describe("Figures no producer serves yet, each naming the service that would serve it"),
    unavailable: z.array(z.string()).describe("Producers that could not be reached for this response; their figures are null, not zero"),
  })
  .openapi("StatsHeadline");

/** Failure counts placed LAST in campaign stats responses. Same values as recipientStats. */
const StatsFailureDetailsSchema = z
  .object({
    bounced: z.number().nullable(),
    unsubscribed: z.number().nullable(),
    negativeReplies: z.number().nullable(),
  })
  .openapi("StatsFailureDetails");

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
  path: "/openapi.json",
  tags: ["Health"],
  summary: "OpenAPI specification",
  description:
    "Returns the OpenAPI 3.0 JSON document for this API — the document you are reading. " +
    "It describes every operation you can call with your API key.",
  responses: {
    200: {
      description: "OpenAPI 3.0 specification",
      content: {
        "application/json": {
          // The document this gateway itself serves — passthrough, because the
          // shape is the OpenAPI 3.0 specification and re-declaring it here
          // would be a second, drifting copy of a standard.
          schema: z.object({}).passthrough().openapi("OpenApiDocumentResponse"),
        },
      },
    },
    404: { description: "Spec not generated yet", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/openapi.json",
  tags: ["Internal"],
  security: platformAuth,
  summary: "Complete OpenAPI specification (platform key)",
  description:
    "The complete OpenAPI 3.0 document, including the platform operations that the " +
    "published document at `GET /openapi.json` does not advertise. Requires the platform " +
    "API key — the same key those operations themselves require, so this exposes nothing " +
    "to a caller who could not already call them. Staff tooling (the CLI) generates its " +
    "command surface from this document.",
  responses: {
    200: {
      description: "OpenAPI 3.0 specification, every operation included",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("InternalOpenApiDocumentResponse"),
        },
      },
    },
    401: { description: "Invalid or missing platform API key", content: errorContent },
  },
});

// ===================================================================
// SHARED REPLY SCHEMAS (email-gateway aggregate buckets + granular detail)
// ===================================================================

const RepliesDetailSchema = z.object({
  interested: z.number(),
  meetingBooked: z.number(),
  closed: z.number(),
  notInterested: z.number(),
  wrongPerson: z.number(),
  unsubscribe: z.number(),
  neutral: z.number(),
  autoReply: z.number(),
  outOfOffice: z.number(),
}).openapi("RepliesDetail");

const RecipientStatsSchema = z.object({
  contacted: z.number().describe("Leads submitted to email provider (COUNT DISTINCT by lead)"),
  sent: z.number().describe("Recipients with at least one sent email"),
  delivered: z.number().describe("Recipients with at least one delivered email"),
  deliveryRate: z.number().nullable().optional().describe("delivered/sent as a 0..1 ratio, served by email-gateway; null when sent=0"),
  opened: z.number().describe("Recipients who opened at least one email"),
  bounced: z.number().describe("Recipients who bounced"),
  clicked: z.number().describe("Recipients who clicked"),
  unsubscribed: z.number().describe("Recipients who unsubscribed"),
  repliesPositive: z.number(),
  repliesNegative: z.number(),
  repliesNeutral: z.number(),
  repliesAutoReply: z.number(),
  repliesDetail: RepliesDetailSchema,
}).openapi("RecipientStats");

const EmailStatsSchema = z.object({
  sent: z.number().describe("Total emails sent (COUNT *)"),
  delivered: z.number().describe("Total emails delivered"),
  opened: z.number().describe("Total email opens"),
  clicked: z.number().describe("Total email clicks"),
  bounced: z.number().describe("Total emails bounced"),
  unsubscribed: z.number().describe("Total unsubscribes"),
  stepStats: z.array(z.record(z.unknown())).describe("Per-step breakdown"),
}).openapi("EmailStats");

// ===================================================================
// WORKFLOW RANKED & BEST (public + authenticated)
// ===================================================================

// All ranked/best endpoints now proxy to features-service
const rankedQueryParams = z.object({
  featureSlug: z.string().openapi({ example: "pr-cold-email-outreach" }).describe("Feature slug (required)."),
  objective: z.string().openapi({ example: "recipientsRepliesPositive" }).describe("Stats key to rank by (required). e.g. 'recipientsRepliesPositive', 'leadsServed'. Use GET /v1/features/stats/registry for the full list."),
  groupBy: z.enum(["workflow", "brand"]).openapi({ example: "workflow" }).describe("'workflow' or 'brand' — group results by workflow or by brand."),
  limit: z.string().optional().openapi({ example: "10" }).describe("Max results (default 3)"),
});

const bestQueryParams = z.object({
  featureSlug: z.string().openapi({ example: "pr-cold-email-outreach" }).describe("Feature slug (required)."),
  groupBy: z.enum(["workflow", "brand"]).openapi({ example: "workflow" }).describe("'workflow' or 'brand' — group results by workflow or by brand."),
});

const publicRevenueQueryParams = z.object({
  featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug (required)."),
  groupBy: z.enum(["brand", "workflow"]).openapi({ example: "workflow" }).describe("Group public revenue results by brand or workflow."),
});

const publicWorkflowEngagementLatencyQueryParams = z.object({
  featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug (required)."),
  groupBy: z.enum(["workflow"]).openapi({ example: "workflow" }).describe("Group public workflow engagement latency results by workflow."),
});

const publicCostProjectionQueryParams = z.object({
  featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug (required)."),
});

const publicCostPerOutcomeTrendQueryParams = z.object({
  featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug (required)."),
  objective: z.string().openapi({ example: "positiveReply" }).describe("Optimization objective — one of websiteVisit / positiveReply / signup / formSubmission / meetingBooked / purchase (required)."),
  days: z.string().optional().openapi({ example: "30" }).describe("Number of trailing display days to emit (default 30, max 180)."),
  windowOutcomes: z.string().optional().openapi({ example: "100" }).describe("Target outcomes per moving-average window (default 100)."),
});

const publicBestModelCostPerOutcomeTrendQueryParams = z.object({
  featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug (required)."),
  objective: z.string().openapi({ example: "positiveReply" }).describe("Optimization objective — one of websiteVisit / positiveReply / signup / formSubmission / meetingBooked / purchase (required)."),
  days: z.string().optional().openapi({ example: "30" }).describe("Number of trailing display days to emit (default 30, max 180)."),
  windowOutcomes: z.string().optional().openapi({ example: "100" }).describe("Target outcomes per moving-average window (default 100)."),
});

const publicWorkflowCostPerOutcomeQueryParams = z.object({
  featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug (required)."),
  objective: z.string().openapi({ example: "positiveReply" }).describe("Optimization objective — one of websiteVisit / positiveReply / signup / formSubmission / meetingBooked / purchase (required)."),
});

const publicCostPerOutcomeLifetimeQueryParams = z.object({
  featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug (required)."),
});

const publicCostPerOutcomeDistributionQueryParams = z.object({
  featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug (required)."),
  objective: z.string().openapi({ example: "positiveReply" }).describe("Optimization objective — one of websiteVisit / positiveReply / signup / formSubmission / meetingBooked / purchase (required)."),
  buckets: z.string().optional().openapi({ example: "10" }).describe("Number of equal-width histogram bars (default 10, max 50)."),
});

// The parameters features-service documents today, not a whitelist: the handler
// forwards the caller's raw query string, so anything it ships next arrives
// without an edit here (CLAUDE.md #11).
const publicReturnOnSpendQueryParams = z.object({
  featureSlug: z.string().optional().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug the return is measured over."),
  minSpendUsd: z.string().optional().openapi({ example: "100" }).describe("Spend floor in USD selecting the brand population the median is taken over. Producer-owned default; a non-numeric or negative value is a 400 at features-service."),
}).passthrough();

// The parameters features-service documents today, not a whitelist: the handler
// forwards the caller's raw query string, so anything it ships next arrives
// without an edit here (CLAUDE.md #11).
const publicFunnelReturnOnSpendQueryParams = z.object({
  channelSlug: z.string().optional().openapi({ example: "sales-cold-email-outreach" }).describe("Narrow to one acquisition channel. Omitted returns every published channel's pairs. An unknown slug is a 404 at features-service, never an empty pair list."),
  minSpendUsd: z.string().optional().openapi({ example: "100" }).describe("Spend floor in USD selecting the brand population each pair's medians are taken over. Producer-owned default; a non-numeric or negative value is a 400 at features-service."),
}).passthrough();

// The parameters features-service documents today, not a whitelist: the handler
// forwards the caller's raw query string, so anything it ships next arrives
// without an edit here (CLAUDE.md #11).
const publicChannelFunnelEconomicsQueryParams = z.object({
  channelSlug: z.string().optional().openapi({ example: "sales-cold-email-outreach" }).describe("Narrow to one channel. Omitted returns every pair in the catalogue. An unknown slug is a 404 at features-service, never an empty pair list."),
}).passthrough();

// The parameters features-service documents today, not a whitelist: the handler
// forwards the caller's raw query string (CLAUDE.md #11).
const publicOutcomeReturnOnSpendQueryParams = z.object({
  channelSlug: z.string().optional().openapi({ example: "sales-cold-email-outreach" }).describe("Narrow to one acquisition channel. An unknown slug is a 404 at features-service."),
  minSpendUsd: z.string().optional().openapi({ example: "100" }).describe("Spend floor in USD selecting the brand population each median is taken over. Producer-owned default; a non-numeric or negative value is a 400 at features-service."),
}).passthrough();

// The parameters features-service documents today, not a whitelist (CLAUDE.md #11).
const publicChannelOutcomeEconomicsQueryParams = z.object({
  channelSlug: z.string().optional().openapi({ example: "sales-cold-email-outreach" }).describe("Narrow to one channel. An unknown slug is a 404 at features-service."),
}).passthrough();

const auditSendForecastQueryParams = z.object({
  days: z.coerce.number().int().optional().openapi({ example: 14 }).describe("Future horizon in days (1..90). A 7-day past tail is always included. Optional; downstream defaults to 14."),
});

const auditActiveUsersQueryParams = z.object({
  days: z.coerce.number().int().optional().openapi({ example: 90 }).describe("Trailing days in the daily series. Optional; downstream defaults to 90 (max 365)."),
  weeks: z.coerce.number().int().optional().openapi({ example: 26 }).describe("Trailing ISO weeks in the weekly series. Optional; downstream defaults to 26 (max 104)."),
  months: z.coerce.number().int().optional().openapi({ example: 12 }).describe("Trailing months in the monthly series. Optional; downstream defaults to 12 (max 36)."),
});

const auditRevenueQueryParams = z.object({
  days: z.coerce.number().int().optional().openapi({ example: 90 }).describe("Trailing days in the daily revenue series. Optional; downstream default applies."),
  weeks: z.coerce.number().int().optional().openapi({ example: 26 }).describe("Trailing ISO weeks in the weekly revenue series. Optional; downstream default applies."),
  months: z.coerce.number().int().optional().openapi({ example: 12 }).describe("Trailing months in the monthly revenue series. Optional; downstream default applies."),
});

const WorkflowMetadataSchema = z
  .object({
    id: z.string().describe("Workflow ID"),
    workflowSlug: z.string().describe("Unique technical identifier. Use this to execute via /workflows/by-slug/{workflowSlug}/execute"),
    workflowName: z.string().describe("Workflow name"),
    displayName: z.string().nullable().describe("Stable display name for the workflow family"),
    workflowDynastyName: z.string().describe("Stable name for the lineage. Constant across all versions of a dynasty"),
    workflowDynastySlug: z.string().describe("Stable slug for the lineage. Use as key for dynasty-level lookups and stats grouping"),
    version: z.number().int().describe("Version number within the dynasty. Starts at 1"),
    createdForBrandId: z.string().nullable().describe("Brand ID that created this workflow"),
    category: z.string().optional().describe("Workflow category (e.g. 'sales', 'pr')"),
    channel: z.string().optional().describe("Communication channel (e.g. 'email')"),
    audienceType: z.string().optional().describe("Audience type (e.g. 'cold-outreach')"),
    featureSlug: z.string().describe("Feature slug this workflow belongs to (e.g. 'pr-cold-email-outreach')"),
    signature: z.string().describe("SHA-256 hash of the canonical DAG"),
    workflowDynastySignatureName: z.string().describe("Human-readable name for this DAG variant within the dynasty"),
    status: z.enum(["active", "deprecated"]).optional().describe("Dynasty lifecycle status. 'deprecated' workflows are hidden from selection. Owned by workflow-service."),
  })
  .passthrough()
  .openapi("WorkflowMetadata");

// Ranked & best responses are pass-through from features-service.
// stats is a dynamic map — keys depend on the feature's output definitions.
// Do NOT define typed stats schemas here — features-service owns the shape.

const rankedResponse = {
  200: {
    description: "Pass-through from features-service. Each result has a stats object with dynamic keys matching the feature's outputs (e.g. recipientsSent, recipientsRepliesPositive, recipientPositiveReplyRate, costPerRecipientPositiveReplyCents). For groupBy=brand, result items may include optional public-safe timeline points: date, cumulativePipelineUsd, emailsSent, emailsOpened, emailsClicked, emailsReplied. Use GET /v1/features/stats/registry for the canonical stats key list.",
    content: {
      "application/json": {
        schema: z.object({}).passthrough().openapi("RankedResponse"),
      },
    },
  },
  400: { description: "Bad request from features-service", content: errorContent },
  404: { description: "Feature not found", content: errorContent },
  502: { description: "Upstream service error", content: errorContent },
};

const bestResponse = {
  200: {
    description: "Pass-through from features-service. Best cost-per-outcome records per metric.",
    content: {
      "application/json": {
        schema: z.object({}).passthrough().openapi("BestResponse"),
      },
    },
  },
  400: { description: "Bad request — featureSlug is required", content: errorContent },
  502: { description: "Upstream service error", content: errorContent },
};

// Public endpoints (no auth) — proxied to features-service
registry.registerPath({
  method: "get",
  path: "/v1/public/features/ranked",
  tags: ["Features"],
  summary: "Ranked features (public)",
  description: "Public ranked workflows by performance. Proxied to features-service. featureSlug and groupBy are required. No authentication required.",
  request: { query: rankedQueryParams },
  responses: rankedResponse,
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/best",
  tags: ["Features"],
  summary: "Hero records (public)",
  description: "Public hero records — best cost-per-outcome. Proxied to features-service. featureSlug and groupBy are required. No authentication required.",
  request: { query: bestQueryParams },
  responses: bestResponse,
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/revenue",
  tags: ["Features"],
  summary: "Public feature revenue",
  description:
    "Public expected-pipeline revenue, cost-of-acquisition percentage, and ROI multiple for a feature, grouped by brand or workflow. " +
    "Proxied to features-service GET /public/stats/revenue. Response is producer-owned and may include brand or workflow results with headline.totalPipelineUsd and costEconomics. No authentication required.",
  request: { query: publicRevenueQueryParams },
  responses: {
    200: { description: "Public feature revenue — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicFeatureRevenueResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/workflow-engagement-latency",
  tags: ["Features"],
  summary: "Public workflow engagement latency",
  description:
    "Public average/median time to first link click and first positive reply for a feature, grouped by workflow. " +
    "Proxied to features-service GET /public/stats/workflow-engagement-latency. Response is producer-owned. No authentication required.",
  request: { query: publicWorkflowEngagementLatencyQueryParams },
  responses: {
    200: { description: "Public workflow engagement latency — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicWorkflowEngagementLatencyResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/cost-projection",
  tags: ["Features"],
  summary: "Public feature cost projection",
  description:
    "Public feature-wide expected cost per meeting-booked and per purchase. " +
    "Proxied to features-service GET /public/stats/cost-projection. Response is producer-owned. No authentication required.",
  request: { query: publicCostProjectionQueryParams },
  responses: {
    200: { description: "Public feature cost projection — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicCostProjectionResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/cost-per-outcome-trend",
  tags: ["Features"],
  summary: "Public cost-per-outcome trend",
  description:
    "Public cross-org dated moving-average cost-per-outcome series for a feature and one objective. " +
    "Proxied to features-service GET /public/stats/cost-per-outcome-trend. Forwards featureSlug, objective, and optional days/windowOutcomes. Response is producer-owned. No authentication required.",
  request: { query: publicCostPerOutcomeTrendQueryParams },
  responses: {
    200: { description: "Public cost-per-outcome trend — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicCostPerOutcomeTrendResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/best-model-cost-per-outcome-trend",
  tags: ["Features"],
  summary: "Public best-model cost-per-outcome trend",
  description:
    "Public cross-org dated cost-per-outcome timeseries of the single BEST workflow model for a feature and one objective — the drop-in replacement for the pooled cost-per-outcome-trend, coherent with the best-model headline (min cost-per-outcome across workflows). Every point is a single workflow's cost, never pooled across workflows. " +
    "Proxied to features-service GET /public/stats/best-model-cost-per-outcome-trend. Forwards featureSlug, objective, and optional days/windowOutcomes. Response is producer-owned. No authentication required.",
  request: { query: publicBestModelCostPerOutcomeTrendQueryParams },
  responses: {
    200: { description: "Public best-model cost-per-outcome trend — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicBestModelCostPerOutcomeTrendResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/workflow-cost-per-outcome",
  tags: ["Features"],
  summary: "Public per-workflow cost-per-outcome",
  description:
    "Public cross-org per-workflow-dynasty cost-per-outcome ratio for a feature and one objective. " +
    "Proxied to features-service GET /public/stats/workflow-cost-per-outcome. Forwards featureSlug and objective. Response is producer-owned. No authentication required.",
  request: { query: publicWorkflowCostPerOutcomeQueryParams },
  responses: {
    200: { description: "Public per-workflow cost-per-outcome — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicWorkflowCostPerOutcomeResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

const workflowReturnHistoryQueryParams = z
  .object({
    featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug (required downstream)."),
    workflowDynastySlug: z.string().describe("Workflow dynasty (all its versions), the key workflow-cost-per-outcome rows carry (required downstream)."),
  })
  .passthrough();

registry.registerPath({
  method: "get",
  path: "/v1/public/features/leg-workflow-ranking",
  tags: ["Features"],
  summary: "Public fleet ranking of every workflow on one leg",
  description:
    "Every workflow on one leg across every client org: cost per outcome, maturity, conversion, outcomes, spend and return, in the owner's order (the best mature workflow holds the money, learning ones cheaper than it above it). " +
    "Proxied to features-service GET /public/stats/leg-workflow-ranking; query forwarded verbatim (featureSlug and leg are the ones documented today, not a whitelist). " +
    "Response is producer-owned. No authentication required.",
  request: {
    query: z.object({
      featureSlug: z.string().openapi({ description: "Feature slug (required)." }),
      leg: z.string().openapi({ description: "Funnel leg key, e.g. start_to_conversation (required)." }),
    }),
  },
  responses: {
    200: { description: "Leg workflow ranking — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicLegWorkflowRankingResponse") } } },
    400: { description: "Missing or unknown parameters", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/workflow-return-history",
  tags: ["Features"],
  summary: "Public per-workflow return history (billed basis)",
  description:
    "One workflow dynasty's fleet-wide dated spend, value and return on spend across every client org, on the billed basis. " +
    "Proxied to features-service GET /public/stats/workflow-return-history; query forwarded verbatim (featureSlug and workflowDynastySlug are the ones documented today, not a whitelist). " +
    "Response is producer-owned. No authentication required.",
  request: { query: workflowReturnHistoryQueryParams },
  responses: {
    200: { description: "Workflow return history — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicWorkflowReturnHistoryResponse") } } },
    400: { description: "Missing parameters", content: errorContent },
    404: { description: "Feature or workflow dynasty not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/workflow-return-history/actual-cost",
  tags: ["Features"],
  summary: "Per-workflow return history at actual vendor cost (staff only)",
  description:
    "The /v1/public/features/workflow-return-history curve with its spend leg at what vendors actually charged, before markup. " +
    "Reveals margin, so staff-only: platform API key + a STAFF_EMAILS x-email, refused with 403 before any downstream call. Fleet-wide, no org context. " +
    "Transparent proxy to features-service GET /internal/stats/workflow-return-history/actual-cost; query forwarded verbatim; response owned by features-service.",
  security: platformAuth,
  request: { query: workflowReturnHistoryQueryParams },
  responses: {
    200: { description: "Actual-cost workflow return history — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("WorkflowReturnHistoryActualCostResponse") } } },
    400: { description: "Missing parameters", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "Feature or workflow dynasty not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/cost-per-outcome-lifetime",
  tags: ["Features"],
  summary: "Public lifetime cost-per-outcome",
  description:
    "Public lifetime (all-history) cross-org average cost-per-outcome across all optimization objectives for a feature. " +
    "Proxied to features-service GET /public/stats/cost-per-outcome-lifetime. Forwards featureSlug. Response is producer-owned. No authentication required.",
  request: { query: publicCostPerOutcomeLifetimeQueryParams },
  responses: {
    200: { description: "Public lifetime cost-per-outcome — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicCostPerOutcomeLifetimeResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/cost-per-outcome-distribution",
  tags: ["Features"],
  summary: "Public cost-per-outcome distribution",
  description:
    "Public cross-org distribution (histogram + spread) of cost-per-outcome across brands for a feature and one objective. " +
    "Proxied to features-service GET /public/stats/cost-per-outcome-distribution. Forwards featureSlug, objective, and optional buckets. Response is producer-owned. No authentication required.",
  request: { query: publicCostPerOutcomeDistributionQueryParams },
  responses: {
    200: { description: "Public cost-per-outcome distribution — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicCostPerOutcomeDistributionResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/return-on-spend",
  tags: ["Features"],
  summary: "Public median return on spend across client brands",
  description:
    "The median return on spend our clients get — each brand's own realized expected pipeline over its committed spend, taken per brand and then across brands — plus the number of brands that median was taken over and the spread around it. " +
    "Public by design at the producer: the landing that renders it is statically generated for an anonymous visitor, so no identity is required here either. " +
    "Proxied to features-service GET /public/stats/return-on-spend. The caller's query string is forwarded verbatim; the parameters documented below are the ones features-service publishes today, not a whitelist — the spend floor selects the population, so it is never defaulted or dropped here. " +
    "Response is producer-owned and distinguishes a measured figure from the reasons it cannot be stated. No authentication required.",
  request: { query: publicReturnOnSpendQueryParams },
  responses: {
    200: { description: "Fleet median return on spend, or the explicit unmeasurable answer — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicReturnOnSpendResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Unknown feature slug", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/funnel-return-on-spend",
  tags: ["Features"],
  summary: "Public median return on spend per (acquisition channel x sales funnel) pair",
  description:
    "What a dollar through one SALES FUNNEL came back as for our clients: per (acquisition channel x sales funnel), the MEDIAN across brands of each brand's own realized expected pipeline over its committed spend \u2014 the same ratio that brand reads as ROI on its own dashboard \u2014 with the quartiles and the median cost per paying client beside it. " +
    "A median, never a mean, and nothing is pooled across channels or funnels: a pair with too few brands past the spend floor says so rather than borrowing a wider population. " +
    "This is a REALIZED figure and is NOT the projected returnPerDollar on /v1/public/channel-funnel-economics (a pooled unit price through mean declared rates and a mean lifetime revenue); the two answer different questions and both are served. " +
    "Public by design at the producer: the figures describe our clients in aggregate and name no brand, so no identity is required here either. " +
    "Proxied to features-service GET /public/stats/funnel-return-on-spend. The caller's query string is forwarded verbatim; the parameters documented below are the ones features-service publishes today, not a whitelist \u2014 the spend floor selects the population, so it is never defaulted or dropped here. " +
    "Response is producer-owned: every pair in the catalogue is listed, measured or not, and an unmeasured pair names which kind it is. No authentication required.",
  request: { query: publicFunnelReturnOnSpendQueryParams },
  responses: {
    200: { description: "Per-pair median return on spend, each pair measured or explicitly unmeasurable \u2014 pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicFunnelReturnOnSpendResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Unknown acquisition-channel slug", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/showcase-funnels",
  tags: ["Features"],
  summary: "Public funnel counts for the named client brands on our homepage",
  description:
    "The current funnel counts of the named client brands our public homepage states \u2014 how many people were contacted, and how many reached each subsequent step of that client's own funnel \u2014 so a static page renders them without computing anything. " +
    "Takes NO parameter naming a brand, by design at the producer: the brands are a frozen server-side allowlist there, because a caller-supplied identifier would turn an unauthenticated read of clients we agreed to publish into a way to read any brand's funnel with no session. " +
    "Counts only \u2014 no money, no rate. Two funnels share legs, so their chains overlap and must never be summed. " +
    "Proxied to features-service GET /public/stats/showcase-funnels. Response is producer-owned and forwarded field-for-field: a step's peopleReached tells a measured 0 apart from an unknown null, and a brand nothing could be walked for names its own reason. No authentication required.",
  responses: {
    200: { description: "Ordered funnel counts for every allowlisted showcase brand \u2014 pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicShowcaseFunnelsResponse") } } },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/outcome-return-on-spend",
  tags: ["Features"],
  summary: "Public median realized return per (channel x leg) and (channel x outcome)",
  description:
    "The funnel-free twin of /v1/public/features/funnel-return-on-spend: the fleet MEDIAN realized return per (acquisition channel x leg) and (acquisition channel x outcome), taken over brands past the spend floor. " +
    "REALIZED, and NOT the projected returnPerDollar on /v1/public/channel-outcome-economics. Public by design at the producer, so no identity is required here either. " +
    "Proxied to features-service GET /public/stats/outcome-return-on-spend. The caller's query string is forwarded verbatim; the parameters documented below are the ones features-service publishes today, not a whitelist. Response is producer-owned. No authentication required.",
  request: { query: publicOutcomeReturnOnSpendQueryParams },
  responses: {
    200: { description: "Per-leg / per-outcome realized medians \u2014 pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicOutcomeReturnOnSpendResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Unknown acquisition-channel slug", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/features/showcase-outcomes",
  tags: ["Features"],
  summary: "Public per-outcome figures for the named client brands on our homepage",
  description:
    "The funnel-free twin of /v1/public/features/showcase-funnels: the homepage's named clients, one row per outcome, plus one realized return per client. " +
    "Takes NO parameter naming a brand, by design at the producer: the brands are a frozen server-side allowlist there. " +
    "Proxied to features-service GET /public/stats/showcase-outcomes. Response is producer-owned and forwarded field-for-field. No authentication required.",
  responses: {
    200: { description: "Showcase clients per outcome \u2014 pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicShowcaseOutcomesResponse") } } },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/channels",
  tags: ["Features"],
  summary: "Public acquisition-channel catalogue",
  description:
    "The published acquisition-channel catalogue: every channel a customer can book, the commercial terms committed to before anything is measured, the kinds of step it can produce, and the sales funnels that follow. The marketing site is generated from this read, so no customer identity appears anywhere on the path. " +
    "Proxied to features-service GET /public/channels. The caller's query string is forwarded verbatim. Response is producer-owned. No authentication required.",
  responses: {
    200: { description: "Acquisition-channel catalogue — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicChannelCatalogueResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/sourcing-origins",
  tags: ["Features"],
  summary: "Public sourcing-origin catalogue",
  description:
    "The published sourcing-origin catalogue: every place leads can come from (for example Apollo cold filters or LinkedIn engagement signals), the origins the offer sourcing split (GET /v1/offers/{offerId}/sourcing) reports on. " +
    "Proxied to features-service GET /public/sourcing-origins. The caller's query string is forwarded verbatim. Response is producer-owned. No authentication required.",
  responses: {
    200: { description: "Sourcing-origin catalogue — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicSourcingOriginCatalogueResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/outcome-prices",
  tags: ["Features"],
  summary: "Public expected price of one outcome",
  description:
    "The expected price of one outcome (a website visit, a booked meeting) for a brand with no data yet, as shown by the signed-out onboarding. " +
    "Proxied to features-service GET /public/stats/outcome-prices. The caller's query string is forwarded verbatim. Response is producer-owned. No authentication required.",
  responses: {
    200: { description: "Expected outcome prices — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicOutcomePricesResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/channel-funnel-economics",
  tags: ["Features"],
  summary: "Public per-(sales funnel, channel) economics",
  description:
    "One row per (sales funnel, acquisition channel) pair: either the pair's measured economics — cost per step, cost per sale, return per dollar — or an explicit not-enough-data answer naming the missing ingredient. Public by design at the producer, so no identity is required here either. " +
    "Proxied to features-service GET /public/channel-funnel-economics. The caller's query string is forwarded verbatim; the documented parameter below is the one features-service publishes today, not a whitelist. Response is producer-owned. No authentication required.",
  request: { query: publicChannelFunnelEconomicsQueryParams },
  responses: {
    200: { description: "Per-pair economics — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicChannelFunnelEconomicsResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Unknown channel slug", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/channel-outcome-economics",
  tags: ["Features"],
  summary: "Public projected channel economics per outcome and per leg",
  description:
    "The funnel-free twin of /v1/public/channel-funnel-economics: PROJECTED channel economics per outcome and per leg, or an explicit not-enough-data answer. Public by design at the producer, so no identity is required here either. " +
    "Proxied to features-service GET /public/channel-outcome-economics. The caller's query string is forwarded verbatim; the documented parameter below is the one features-service publishes today, not a whitelist. Response is producer-owned. No authentication required.",
  request: { query: publicChannelOutcomeEconomicsQueryParams },
  responses: {
    200: { description: "Per-outcome / per-leg economics \u2014 pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicChannelOutcomeEconomicsResponse") } } },
    400: { description: "Bad request from features-service", content: errorContent },
    404: { description: "Unknown channel slug", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/audit/send-forecast",
  tags: ["Features"],
  summary: "Staff fleet email send forecast (staff only)",
  description:
    "STAFF-ONLY global, cross-org, fleet-wide projection of how many outreach emails will be SENT per calendar day over a past+future window, " +
    "plus a fleet budget summary (total daily budget across all brands, remaining budget today, active brand count). The summary carries " +
    "cross-org fleet financials, so this is gated by platform API key + STAFF_EMAILS x-email (same tier as GET /v1/instantly/audit/*); no org " +
    "context required. Transparent proxy to features-service GET /internal/stats/send-forecast. Forwards optional `days` (1..90). Response is producer-owned.",
  security: platformAuth,
  request: { query: auditSendForecastQueryParams },
  responses: {
    200: { description: "Per-day fleet send forecast + summary — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StaffSendForecastResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/audit/accounts",
  tags: ["Features"],
  summary: "Staff fleet customer accounts + financials (staff only)",
  description:
    "STAFF-ONLY cross-org listing of customer accounts plus fleet financial stats (total daily budget, MRR, ARR). The stats carry " +
    "cross-org fleet financials, so this is gated by platform API key + STAFF_EMAILS x-email (same tier as GET /v1/features/audit/send-forecast); " +
    "no org context required, no query params. Transparent proxy to features-service GET /internal/stats/accounts. Response (rows + stats + asOf) is producer-owned.",
  security: platformAuth,
  responses: {
    200: { description: "Cross-org accounts + fleet financial stats — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StaffAccountsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/audit/active-users",
  tags: ["Features"],
  summary: "Staff fleet active-users history (staff only)",
  description:
    "STAFF-ONLY cross-org, fleet-wide HISTORY of active users (distinct orgs with an active, funded, non-paused cold-email brand) bucketed " +
    "monthly, weekly, and daily, each with a period-over-period growth rate, plus the current live total. Aggregate cross-org fleet data, so this " +
    "is gated by platform API key + STAFF_EMAILS x-email (same tier as GET /v1/features/audit/accounts); no org context required. Forwards optional " +
    "window params `days`/`weeks`/`months`. Transparent proxy to features-service GET /internal/stats/active-users. Response is producer-owned.",
  security: platformAuth,
  request: { query: auditActiveUsersQueryParams },
  responses: {
    200: { description: "Fleet active-users history (currentTotal + monthly/weekly/daily + asOf) — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StaffActiveUsersResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/audit/active-users-by-user",
  tags: ["Features"],
  summary: "Staff fleet per-user active history (staff only)",
  description:
    "STAFF-ONLY cross-org, fleet-wide PER-USER active history: for each user (a distinct org with an active, funded, non-paused cold-email " +
    "brand), that user's active months/weeks/days, first/last active month+week, retention window in weeks, and current-week/current-month " +
    "active flags. This is the per-user companion to GET /v1/features/audit/active-users (the aggregate history). Cross-org fleet data (per-org " +
    "rows), so this is gated by platform API key + STAFF_EMAILS x-email (same tier as GET /v1/features/audit/accounts); no org context required, " +
    "no query params. Transparent proxy to features-service GET /internal/stats/active-users-by-user. Response is producer-owned.",
  security: platformAuth,
  responses: {
    200: { description: "Cross-org per-user active history — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StaffActiveUsersByUserResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/audit/customer-success",
  tags: ["Features"],
  summary: "Staff fleet customer-success health board (staff only)",
  description:
    "STAFF-ONLY cross-org, fleet-wide CUSTOMER-SUCCESS health board: one composed row per ever-active customer (name, CAC, grain, and the rest " +
    "of the health signals the downstream computes). Cross-org fleet data (per-customer rows), so this is gated by platform API key + " +
    "STAFF_EMAILS x-email (same tier as GET /v1/features/audit/active-users-by-user); no org context required, no query params. Transparent " +
    "proxy to features-service GET /internal/stats/customer-health. Response is producer-owned.",
  security: platformAuth,
  responses: {
    200: { description: "Cross-org customer-success health board — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StaffCustomerSuccessResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/audit/revenue",
  tags: ["Features"],
  summary: "Staff fleet realized-revenue history (staff only)",
  description:
    "STAFF-ONLY cross-org, fleet-wide HISTORY of REALIZED REVENUE (the sum of actualized cold-email spend per day — the money twin of " +
    "active-users): total revenue since inception, plus monthly, weekly, and daily revenue buckets each with a period-over-period growth rate, " +
    "and current MRR. Aggregate cross-org fleet financials, so this is gated by platform API key + STAFF_EMAILS x-email (same tier as " +
    "GET /v1/features/audit/active-users); no org context required. Forwards optional window params `days`/`weeks`/`months`. Transparent proxy " +
    "to features-service GET /internal/stats/revenue. Response is producer-owned.",
  security: platformAuth,
  request: { query: auditRevenueQueryParams },
  responses: {
    200: { description: "Fleet realized-revenue history (total + MRR + monthly/weekly/daily + asOf) — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StaffRevenueResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

// ── Staff stated monthly amounts (platform key + STAFF_EMAILS) ──────────────
//
// Transparent CRUD proxy to features-service /internal/stated-monthly-amounts. Request bodies and
// responses are producer-owned passthroughs (rule #8) — this gateway declares no field of them. The
// query object below documents the filters features-service serves TODAY; it is a doc, not a
// whitelist (rule #11), and the caller's query string is forwarded verbatim.
const statedMonthlyAmountsQueryParams = z
  .object({
    orgId: z.string().optional().describe("Restrict to one organization. Optional."),
    brandId: z.string().optional().describe("Restrict to one brand. Optional."),
  })
  .passthrough();

const StatedMonthlyAmountIdParam = z.object({
  id: z.string().describe("Stated monthly amount ID"),
});

const statedAmountConflictContent = {
  "application/json": {
    schema: z.object({}).passthrough().openapi("StatedMonthlyAmountConflict"),
  },
};

registry.registerPath({
  method: "get",
  path: "/v1/features/stated-monthly-amounts",
  tags: ["Features"],
  summary: "List stated monthly amounts (staff only)",
  description:
    "STAFF-ONLY list of what a HUMAN has stated a brand is worth per month, over a date range. Platform-wide staff data, so gated by " +
    "platform API key + STAFF_EMAILS x-email (same tier as GET /v1/features/audit/revenue); no org context is involved. The caller's query " +
    "string is forwarded verbatim — `orgId` and `brandId` are the filters features-service serves today. Transparent proxy to " +
    "features-service GET /internal/stated-monthly-amounts. Response is producer-owned.",
  security: platformAuth,
  request: { query: statedMonthlyAmountsQueryParams },
  responses: {
    200: { description: "Stated monthly amounts — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StatedMonthlyAmountsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/features/stated-monthly-amounts",
  tags: ["Features"],
  summary: "State what a brand is worth per month (staff only)",
  description:
    "STAFF-ONLY create of a stated monthly amount for an (org, brand) pair over a date range. Gated by platform API key + STAFF_EMAILS " +
    "x-email. The body is forwarded verbatim; features-service owns its vocabulary and its validation, including the 409 it raises when the " +
    "range overlaps another stated amount for the same brand — that refusal reaches the caller with its status and its body unchanged, " +
    "reason included. Transparent proxy to features-service POST /internal/stated-monthly-amounts.",
  security: platformAuth,
  request: {
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("StatedMonthlyAmountCreateRequest") } } },
  },
  responses: {
    201: { description: "Created stated monthly amount — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StatedMonthlyAmountResponse") } } },
    400: { description: "Rejected by features-service — body forwarded verbatim", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    409: { description: "Overlaps a stated amount already in force for this brand — features-service's refusal, reason included", content: statedAmountConflictContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/features/stated-monthly-amounts/{id}",
  tags: ["Features"],
  summary: "Edit a stated monthly amount (staff only)",
  description:
    "STAFF-ONLY edit of one stated monthly amount. Gated by platform API key + STAFF_EMAILS x-email. The body is forwarded verbatim — which " +
    "keys are PRESENT is what features-service reads, so an omitted key keeps its stored value while an explicit null opens that bound. A 404 " +
    "for an unknown id and a 409 for an overlapping range both reach the caller unchanged. Transparent proxy to features-service " +
    "PATCH /internal/stated-monthly-amounts/{id}.",
  security: platformAuth,
  request: {
    params: StatedMonthlyAmountIdParam,
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("StatedMonthlyAmountUpdateRequest") } } },
  },
  responses: {
    200: { description: "Updated stated monthly amount — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StatedMonthlyAmountUpdatedResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "No stated monthly amount with this id", content: errorContent },
    409: { description: "Overlaps a stated amount already in force for this brand — features-service's refusal, reason included", content: statedAmountConflictContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/features/stated-monthly-amounts/{id}",
  tags: ["Features"],
  summary: "Delete a stated monthly amount (staff only)",
  description:
    "STAFF-ONLY delete of one stated monthly amount. Gated by platform API key + STAFF_EMAILS x-email. Answers features-service's own 204 on " +
    "success and its 404 when no row carries the id. Transparent proxy to features-service DELETE /internal/stated-monthly-amounts/{id}.",
  security: platformAuth,
  request: { params: StatedMonthlyAmountIdParam },
  responses: {
    204: { description: "Deleted — no content, as features-service answers" },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "No stated monthly amount with this id", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

// Authenticated endpoints — proxied to features-service
registry.registerPath({
  method: "get",
  path: "/v1/workflows/ranked",
  tags: ["Workflows"],
  summary: "Ranked workflows",
  description: "Workflows ranked by performance, scoped to the authenticated org. Proxied to features-service. featureSlug and groupBy are required.",
  security: authed,
  request: { query: rankedQueryParams },
  responses: { ...rankedResponse, 401: { description: "Unauthorized", content: errorContent } },
});

registry.registerPath({
  method: "get",
  path: "/v1/workflows/best",
  tags: ["Workflows"],
  summary: "Hero records",
  description: "Best cost-per-outcome records, scoped to the authenticated org. Proxied to features-service. featureSlug and groupBy are required.",
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
  summary: "Who am I acting as",
  description:
    "Call this first. Returns which user this request acts as, every organization the access can act in (by name, " +
    "each with its brands), and the organization THIS request acts in when one is named or implied. A distribute.you API key " +
    "belongs to its USER and reaches every organization that user is a member of (checked on every request; staff count as " +
    "members of every organization). Each request acts in ONE organization: name a brand (`?brandId=`, `x-brand-id`, or " +
    "`brandId` in a JSON body) or the organization (`?orgId=` or `x-org-id`); a user in exactly one organization needs to name " +
    "nothing. This endpoint answers even when no organization is named. A key never carries staff, admin or beta powers. " +
    "Authenticate with `Authorization: Bearer <key>`. On 401 the body's `code` says why and `fix` says what to do.",
  security: authed,
  responses: {
    200: {
      description: "Current user and org info",
      content: {
        "application/json": {
          schema: z
            .object({
              summary: z.string().describe("Plain sentences: which user, every organization the access reaches (by name, with its brands), and which organization this request acts in, or that each request must name one"),
              user: z
                .object({
                  id: z.string(),
                  email: z.string().nullable(),
                  firstName: z.string().nullable(),
                  lastName: z.string().nullable(),
                })
                .nullable()
                .describe("null when the lookup failed (see lookupErrors)"),
              organizations: z
                .array(
                  z.object({
                    id: z.string(),
                    name: z.string().nullable(),
                    brands: z.array(z.object({ id: z.string(), name: z.string().nullable(), domain: z.string().nullable() })),
                  }),
                )
                .nullable()
                .describe("Every organization this access can act in, each with its brands. For a staff user's key: every organization that holds a brand. null = lookup failed (see lookupErrors)"),
              organization: z
                .object({ id: z.string(), name: z.string().nullable() })
                .nullable()
                .describe("The organization THIS request acts in. null when the request named none and the user belongs to several organizations, or when the lookup failed"),
              brands: z
                .array(z.object({ id: z.string(), name: z.string().nullable(), domain: z.string().nullable() }))
                .nullable()
                .describe("The brands of `organization`. [] = no brand yet; null = no organization targeted, or lookup failed"),
              keyScope: z
                .string()
                .nullable()
                .describe("For a user API key: what the key covers (its user, across that user's organizations; how to name the organization of a request; never staff/admin/beta powers). null for dashboard sessions"),
              lookupErrors: z
                .array(z.object({ source: z.string(), error: z.string() }))
                .describe("Lookups that failed, with the upstream message. Empty when everything resolved"),
              userId: z.string().optional(),
              orgId: z.string().optional(),
              authType: z.enum(["user_key", "admin"]).optional(),
            })
            .openapi("MeResponse"),
        },
      },
    },
    401: { description: "Authentication failed; `code` says why", content: authFailureContent },
    403: { description: "`org_not_member`: the named organization is not one of the key user's; `no_organization`", content: authFailureContent },
    404: { description: "`brand_not_found`: none of the user's organizations holds the named brand", content: authFailureContent },
    503: { description: "`key_validation_unavailable` or `membership_unavailable`: retry", content: authFailureContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// CAMPAIGNS
// ===================================================================

// -- Request schemas --

// The gateway declares ONLY the fields it needs for its own work: the required-field
// check it 400s on, the brandUrls→brandIds upsert, the workflow slug it derives the
// campaign type + tracking header from, and the featureInputs it key-presence-validates
// against features-service. Everything else campaign-service accepts — `offerId`, `legKey`,
// and any field it adds next — rides through `.passthrough()` untouched. A whitelist here
// would silently DROP those fields (the create reaching campaign-service without them),
// which is the gateway owning a downstream shape it does not own (CLAUDE.md rule #8).
// So: never re-declare a field just to let it through, and never validate a downstream
// vocabulary here — campaign-service rejects what it does not accept, and rule #7
// forwards that rejection verbatim.
export const CreateCampaignRequestSchema = z
  .object({
    name: z.string().describe("Campaign name"),
    workflowSlug: z.string().min(1).optional().describe("Exact versioned workflow slug (e.g. 'sales-email-cold-outreach-sienna-v3'). Use for pinning to a specific version. Provide this OR workflowDynastySlug."),
    workflowDynastySlug: z.string().min(1).optional().describe("Stable dynasty slug for the workflow lineage (e.g. 'sales-email-cold-outreach-sienna'). Campaign-service resolves to the latest version automatically. Preferred over workflowSlug for dashboard use."),
    brandUrls: z.array(z.string().min(1)).min(1).optional().describe("Brand website URLs. First URL is the primary brand; additional URLs are secondary brands. Provide this (website path) OR brandIds (no-website path) — exactly one."),
    brandIds: z.array(z.string().min(1)).min(1).optional().describe("Brand UUIDs of already-created brands (no-website path). First id is the primary brand. When provided, api-service skips the brandUrls→brand upsert and forwards these ids straight to campaign-service. Provide this OR brandUrls — exactly one."),
    featureSlug: z.string().min(1).optional().describe("Exact versioned feature slug. Use for pinning to a specific version. Provide this OR featureDynastySlug."),
    featureDynastySlug: z.string().min(1).optional().describe("Stable dynasty slug for the feature lineage (e.g. 'pr-cold-email-outreach'). Campaign-service resolves to the latest version automatically. Preferred over featureSlug for dashboard use."),
    featureInputs: z.record(z.unknown()).describe("Opaque feature inputs. Validated by key-presence against features-service, never inspected by api-service."),
    maxBudgetDailyUsd: z.union([z.string(), z.number()]).optional().describe("Max daily budget in USD"),
    maxBudgetWeeklyUsd: z.union([z.string(), z.number()]).optional().describe("Max weekly budget in USD"),
    maxBudgetMonthlyUsd: z.union([z.string(), z.number()]).optional().describe("Max monthly budget in USD"),
    maxBudgetTotalUsd: z.union([z.string(), z.number()]).optional().describe("Max total budget in USD"),
    maxLeads: z.number().int().optional().describe("Maximum number of leads to contact"),
    endDate: z.string().optional().describe("Campaign end date"),
    // Campaign v2 — per-campaign configuration (owned by campaign-service).
    // Faithful passthrough: types mirror campaign-service's create contract exactly.
    goal: z.string().min(1).nullable().optional().describe("Campaign's own optimization goal. Vocabulary owned by campaign-service — not enumerated here."),
    audienceIds: z.array(z.string().min(1)).min(1).nullable().optional().describe("Subset of the brand's audiences this campaign targets"),
    servicesOffered: z.array(z.string().min(1)).nullable().optional().describe("Services offered by this campaign"),
    clickDestinationUrl: z.string().min(1).nullable().optional().describe("Campaign's click-destination URL"),
  })
  // Forward every other field campaign-service accepts — `offerId` + `legKey` (what a sales
  // campaign sells and the leg it is bought for) and whatever it adds next — byte-identical.
  .passthrough()
  .refine(
    (d) => d.workflowSlug || d.workflowDynastySlug,
    { message: "Either workflowSlug or workflowDynastySlug is required", path: ["workflowSlug"] },
  )
  .refine(
    (d) => d.featureSlug || d.featureDynastySlug,
    { message: "Either featureSlug or featureDynastySlug is required", path: ["featureSlug"] },
  )
  .refine(
    (d) => Boolean(d.brandUrls) !== Boolean(d.brandIds),
    { message: "Provide exactly one of brandUrls (website path) or brandIds (no-website path)", path: ["brandUrls"] },
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

// The customer starts the campaign for a pair they have already funded.
//
// campaign-service's body is `.strict()` ON PURPOSE: a caller reaching for a workflow, a
// campaign name or a per-campaign budget is TOLD no rather than having it silently stripped,
// because each of those is a decision the browser does not own. So this gateway declares the
// fields the customer's own screen knows purely as DOCUMENTATION and carries
// `.passthrough()` — the handler forwards `req.body` byte-identical and never parses against
// this schema. A whitelist here would strip exactly the field campaign-service means to refuse,
// turning its "no" into a silent acceptance of a different request (CLAUDE.md rule #8 corollary).
export const StartFundedPairRequestSchema = z
  .object({
    brandId: z.string().uuid().describe("The brand whose funded pair is being started."),
    offerId: z.string().uuid().nullable().optional().describe("The offer whose money funds this pair. Absent is the pre-offer population."),
    featureSlug: z.string().min(1).describe("The acquisition channel, as a features-service feature slug."),
    legKey: z.string().min(1).nullable().optional().describe("The leg the campaign is bought for, as published on features-service's channel catalogue. Stated together with offerId. Vocabulary owned downstream — not enumerated here."),
  })
  .passthrough()
  .openapi("StartFundedPairRequest", {
    example: {
      brandId: "75d7e3e8-6926-4f85-a557-976895400666",
      offerId: "0f5f2b0a-6f34-4f2a-9a0c-2b53a5b9a111",
      featureSlug: "sales-cold-email-outreach",
      legKey: "visit_to_meeting",
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

// Mirror of runs-service `RunWithOwnCost` (RunSchema + own-cost totals).
// Used by GET /v1/runs (list). One item per run, own-cost totals only;
// per-cost-name breakdown lives on GET /v1/runs/{id}.
const RunWithOwnCostSchema = z
  .object({
    id: z.string().uuid().describe("Run ID"),
    organizationId: z.string().uuid().nullable(),
    userId: z.string().uuid().nullable(),
    brandIds: z.array(z.string()).nullable(),
    campaignId: z.string().nullable(),
    workflowSlug: z.string().nullable(),
    featureSlug: z.string().nullable(),
    serviceName: z.string(),
    taskName: z.string(),
    status: z.string().describe("Run status (e.g. completed, failed)"),
    parentRunId: z.string().uuid().nullable(),
    startedAt: z.string().datetime().describe("ISO timestamp when the run started"),
    completedAt: z.string().datetime().nullable().describe("ISO timestamp when the run completed"),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    ownCostInUsdCents: z.string().describe("Sum of this run's own costs (excludes descendants)"),
    ownActualCostInUsdCents: z.string().describe("Sum of this run's own costs with status='actual'"),
    ownProvisionedCostInUsdCents: z.string().describe("Sum of this run's own costs with status='provisioned'"),
  })
  .openapi("RunWithOwnCost");

// -- Response schemas --

const CampaignSchema = z
  .object({
    id: z.string().describe("Campaign ID"),
    orgId: z.string().describe("Organization ID"),
    createdByUserId: z.string().nullable().describe("User who created the campaign"),
    name: z.string().describe("Campaign name"),
    workflowSlug: z.string().describe("Exact versioned workflow slug used for execution"),
    workflowDynastySlug: z.string().nullable().describe("Stable dynasty slug for the workflow lineage (unversioned)"),
    brandUrls: z.array(z.string()).describe("Brand website URLs (resolved from brandIds via brand-service)"),
    brandIds: z.array(z.string()).describe("Brand IDs"),
    featureSlug: z.string().nullable().describe("Exact versioned feature slug for tracking"),
    featureDynastySlug: z.string().nullable().describe("Stable dynasty slug for the feature lineage (unversioned)"),
    featureInputs: z.record(z.unknown()).nullable().describe("Free-form JSONB inputs for the feature"),
    maxBudgetDailyUsd: z.string().nullable().describe("Max daily budget in USD"),
    maxBudgetWeeklyUsd: z.string().nullable().describe("Max weekly budget in USD"),
    maxBudgetMonthlyUsd: z.string().nullable().describe("Max monthly budget in USD"),
    maxBudgetTotalUsd: z.string().nullable().describe("Max total budget in USD"),
    maxLeads: z.number().nullable().describe("Maximum number of leads"),
    // Campaign v2 — per-campaign configuration (owned by campaign-service, forwarded byte-identical).
    goal: z.enum(["signup", "meetingBooked", "purchase"]).nullable().describe("Campaign's own optimization goal"),
    audienceIds: z.array(z.string()).nullable().describe("Subset of the brand's audiences this campaign targets"),
    servicesOffered: z.array(z.string()).nullable().describe("Services offered by this campaign"),
    clickDestinationUrl: z.string().nullable().describe("Campaign's click-destination URL"),
    startDate: z.string().nullable().describe("Campaign start date"),
    endDate: z.string().nullable().describe("Campaign end date"),
    status: z.string().describe("Campaign status (e.g. 'active', 'stopped')"),
    nextRunAt: z.string().nullable().describe("Scheduled next run time for a gate-blocked campaign"),
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
      featureSlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature slug"),
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
    "Feature inputs are validated by key-presence against features-service (api-service never inspects values).\n\n" +
    "The body is a PASSTHROUGH: the fields below are the ones the gateway itself needs, and every other field " +
    "campaign-service accepts is forwarded unchanged. A sales-outreach campaign states what it sells as `offerId` " +
    "plus the leg it is bought for as `legKey` — that is what the campaign is paced and priced on. The gateway " +
    "neither infers nor defaults either: campaign-service's own 400 comes back verbatim.",
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
  method: "post",
  path: "/v1/campaigns/start-funded-pair",
  tags: ["Campaigns"],
  summary: "Start the campaign for a funded pair",
  description:
    "Start the campaign for a (sales funnel x acquisition channel) pair the customer has already funded.\n\n" +
    "Funding a pair states a ceiling and creates no campaign — money must not start anything on its own. " +
    "This is the half a PERSON performs: the caller states only what its own screen knows (which brand, which " +
    "offer, which sales funnel, which acquisition channel), plus an optional `legKey` when the customer funded " +
    "two legs of the same pair and there are two campaigns to start.\n\n" +
    "It CANNOT state a workflow, a campaign name or a per-campaign budget: the workflow is campaign-service's " +
    "choice and is re-picked every run, the name is derived from the identity, and the money is billing's and is " +
    "already set. campaign-service's body is strict, so a request carrying one of those is refused rather than " +
    "having it stripped — this gateway forwards the body byte-identical and adds nothing.\n\n" +
    "A pair that cannot be started is REFUSED with a sentence written for a person, in `error`, alongside a " +
    "machine-readable `reason` code, under campaign-service's own status (400, 409 or 502). All three reach the " +
    "caller unchanged: \"nothing can run that channel yet\", \"you haven't funded it\" and \"this channel doesn't " +
    "sell that funnel\" are three different answers and the customer is owed the right one.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: StartFundedPairRequestSchema } },
    },
  },
  responses: {
    200: {
      description:
        "The pair's campaign. `started: false, alreadyRunning: true` when it was already live; " +
        "`started: true` when a stopped campaign was started again. Shape owned by campaign-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("StartFundedPairResponse"),
        },
      },
    },
    201: {
      description: "A campaign was created for the pair and started. Shape owned by campaign-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("StartFundedPairCreatedResponse"),
        },
      },
    },
    400: {
      description: "campaign-service's refusal, verbatim: a customer-facing `error` sentence plus a `reason` code.",
      content: errorContent,
    },
    401: { description: "Unauthorized", content: errorContent },
    409: {
      description: "campaign-service's refusal, verbatim: a customer-facing `error` sentence plus a `reason` code.",
      content: errorContent,
    },
    502: {
      description: "campaign-service's refusal, verbatim: a customer-facing `error` sentence plus a `reason` code.",
      content: errorContent,
    },
    500: { description: "Internal error", content: errorContent },
  },
});

// POST /v1/offers/{offerId}/reactive-defaults -> campaign-service POST /offers/{offerId}/reactive-defaults.
// Passthrough: campaign-service owns the strict body and every response.
const ReactiveDefaultsRequestSchema = z
  .object({ brandId: z.string().uuid() })
  .openapi("ReactiveDefaultsRequest");
const ReactiveDefaultsResponseSchema = z
  .object({
    offerId: z.string(),
    basis: z.enum(["stated", "roi_above_1"]),
    tickedCombinationKeys: z.array(z.string()),
    started: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        featureSlug: z.string().nullable(),
        legKey: z.string().nullable(),
      }),
    ),
    alreadyOn: z.array(z.string()),
    keptOff: z.array(z.string()),
    skipped: z.array(z.object({ legKey: z.string(), featureSlug: z.string(), reason: z.string() })),
  })
  .passthrough()
  .openapi("ReactiveDefaultsResponse");

registry.registerPath({
  method: "post",
  path: "/v1/offers/{offerId}/reactive-defaults",
  tags: ["Campaigns"],
  summary: "Switch on the reactive campaigns the offer's ticked sales paths use",
  description:
    "Proxy to campaign-service POST /offers/{offerId}/reactive-defaults. Call after a PERSON saved the offer's " +
    "sales paths (PUT /v1/brands/{id}/offers/{offerId}/selected-sales-paths). Ticked paths = the stated " +
    "combinationKeys, or the paths with roi > 1 when never stated (`basis`). Every reactive leg of a ticked path " +
    "with NO campaign yet is created ON (`started`); one already ON is left (`alreadyOn`); a STOPPED one stays " +
    "stopped (`keptOff`): a person's off is never re-enabled. Nothing is ever stopped. `skipped` names pairs " +
    "nothing can run. Body `{ brandId }` forwarded untouched; brandId also rides `x-brand-id` downstream (a " +
    "different brandId in header/query is a 400). Status and body forwarded verbatim.",
  security: authed,
  request: {
    params: z.object({ offerId: z.string() }),
    body: { content: { "application/json": { schema: ReactiveDefaultsRequestSchema } } },
  },
  responses: {
    200: {
      description: "Applied",
      content: { "application/json": { schema: ReactiveDefaultsResponseSchema } },
    },
    400: { description: "Validation error (e.g. missing brandId), forwarded verbatim", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: { description: "Payment hold, forwarded verbatim", content: errorContent },
    502: {
      description:
        "Sales paths, selected paths or channel catalogue unreadable (`reason: sales_paths_unavailable`); nothing written",
      content: errorContent,
    },
    500: { description: "Internal error", content: errorContent },
  },
});

// GET /v1/offers/{offerId}/trigger-events[/summary] -> campaign-service GET /internal/offers/{offerId}/trigger-events[/summary].
// Passthrough: campaign-service owns the query validation and both bodies.
const OfferTriggerEventsSummaryResponseSchema = z
  .object({})
  .passthrough()
  .openapi("OfferTriggerEventsSummaryResponse");
const OfferTriggerEventsListResponseSchema = z
  .object({})
  .passthrough()
  .openapi("OfferTriggerEventsListResponse");

const triggerEventsDescription =
  "Trigger events (owner 2026-10-09): a REACTIVE leg runs when a trigger fires (a positive reply received, a lead " +
  "requested, a meeting booked...). Each occurrence is recorded with what it did: `ran` (campaigns run) or `skipped` " +
  "with one named reason (e.g. `campaign_off`, `no_campaign`, `unfunded`, `run_in_flight`). The org is the " +
  "authenticated one (never a header/query the caller names). Query forwarded verbatim; campaign-service owns its " +
  "validation (400) and the body. Status and body relayed verbatim.";

registry.registerPath({
  method: "get",
  path: "/v1/offers/{offerId}/trigger-events/summary",
  tags: ["Campaigns"],
  summary: "Per trigger type, over a window: events fired, ran, skipped (by reason), pending",
  description:
    "Proxy to campaign-service GET /internal/offers/{offerId}/trigger-events/summary. " +
    triggerEventsDescription +
    " Groups the offer's events with `occurredAt` in [from, to] (to absent = now) by trigger type; a type with no " +
    "event in the window is absent. `recordedSince` = when recording started: before it, absence means not recorded.",
  security: authed,
  request: {
    params: z.object({ offerId: z.string() }),
    query: z
      .object({
        brandId: z.string().uuid(),
        from: z.string().openapi({ description: "Window start (ISO date-time), required" }),
        to: z.string().optional().openapi({ description: "Window end (ISO date-time); absent = now" }),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "Per-trigger counts",
      content: { "application/json": { schema: OfferTriggerEventsSummaryResponseSchema } },
    },
    400: { description: "Malformed query (e.g. missing brandId/from), forwarded verbatim", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/offers/{offerId}/trigger-events",
  tags: ["Campaigns"],
  summary: "The offer's latest trigger events, newest first",
  description:
    "Proxy to campaign-service GET /internal/offers/{offerId}/trigger-events. " +
    triggerEventsDescription +
    " `limit` 1-200, absent = campaign-service's default (50).",
  security: authed,
  request: {
    params: z.object({ offerId: z.string() }),
    query: z
      .object({
        brandId: z.string().uuid(),
        limit: z.string().optional().openapi({ description: "1-200; absent = downstream default" }),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "The events",
      content: { "application/json": { schema: OfferTriggerEventsListResponseSchema } },
    },
    400: { description: "Malformed query (e.g. missing brandId), forwarded verbatim", content: errorContent },
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
  method: "patch",
  path: "/v1/brands/{brandId}/campaigns/daily-budget",
  tags: ["Campaigns"],
  summary: "Set daily budget for all of a brand's campaigns",
  description:
    "Proxy to campaign-service PATCH /brands/{brandId}/daily-budget. Sets dailyBudgetCents on " +
    "EVERY sales campaign of the brand at once — the brand-page propagation lever: when a customer " +
    "edits their daily budget on the brand page it flows down to the brand's campaign(s). Distinct " +
    "from PATCH /v1/brands/{brandId}/daily-budget (billing-service brand spend cap). Body " +
    "{ dailyBudgetCents } (integer cents >= 0, or null to clear each campaign's own budget so they " +
    "fall back to the brand daily budget). Identity headers (x-org-id, x-user-id, x-run-id) are " +
    "forwarded. Body + response shapes are owned by campaign-service; its 4xx validation errors " +
    "propagate verbatim.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string().uuid().describe("Brand ID") }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              dailyBudgetCents: z
                .number()
                .int()
                .nonnegative()
                .nullable()
                .describe("Daily budget in cents for every sales campaign of the brand; null clears each campaign's own budget"),
            })
            .openapi("SetBrandCampaignsDailyBudgetRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Per-campaign daily budgets updated", content: { "application/json": { schema: z.object({}).passthrough().openapi("SetBrandCampaignsDailyBudgetResponse") } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
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
  path: "/v1/runs",
  tags: ["Runs"],
  summary: "List runs",
  description:
    "Transparent proxy to runs-service GET /v1/runs. " +
    "Supports all runs-service query params: campaignId, brandId, userId, " +
    "workflowSlug, featureSlug, serviceName, taskName, status, parentRunId, " +
    "startedAfter, startedBefore, limit, offset. " +
    "Results are sorted by startedAt DESC (most recent first). " +
    "Each item is a run with own-cost totals only; for the per-cost-name " +
    "breakdown of a single run, call GET /v1/runs/{id}.",
  security: authed,
  request: {
    query: z.object({
      campaignId: z.string().optional(),
      brandId: z.string().optional(),
      userId: z.string().uuid().optional(),
      workflowSlug: z.string().optional(),
      featureSlug: z.string().optional(),
      serviceName: z.string().optional(),
      taskName: z.string().optional(),
      status: z.string().optional(),
      parentRunId: z.string().uuid().optional(),
      startedAfter: z.string().optional(),
      startedBefore: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }).openapi("ListRunsQuery"),
  },
  responses: {
    200: {
      description:
        "List of runs with own-cost totals. One item per run; " +
        "per-cost-name breakdown is on GET /v1/runs/{id}.",
      content: {
        "application/json": {
          schema: z.object({
            runs: z.array(RunWithOwnCostSchema),
            offset: z.number(),
            limit: z.number().optional(),
          }).openapi("ListRunsResponse"),
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
    "Get campaign statistics. `headline` comes first and leads with success (meetings booked, positive replies, " +
    "delivered/sent, cost); figures no service serves yet are null and listed in `headline.notServed`. Failure counts " +
    "(bounces, unsubscribes, negative replies) are repeated last under `failureDetails`. All earlier fields are unchanged " +
    "(leads served/buffered/skipped, emails generated, recipientStats, emailStats, cost breakdown).",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "Aggregated campaign statistics",
      content: {
        "application/json": {
          schema: z
            .object({
              headline: StatsHeadlineSchema,
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
              recipientStats: RecipientStatsSchema,
              emailStats: EmailStatsSchema,
              totalCostInUsdCents: z.string().nullable().optional().describe("Total cost from campaign-service budget tracking"),
              costBreakdown: z.array(z.object({
                costName: z.string(),
                totalCostInUsdCents: z.string(),
                actualCostInUsdCents: z.string(),
                provisionedCostInUsdCents: z.string(),
                totalQuantity: z.string(),
              })).optional().describe("Per-cost-name breakdown from runs-service"),
              failureDetails: StatsFailureDetailsSchema,
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
    "using groupBy=campaignId. Returns one entry per campaign, each starting with a success-first `headline` " +
    "and ending with `failureDetails` (see GET /v1/campaigns/{id}/stats). " +
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
                  headline: StatsHeadlineSchema,
                  campaignId: z.string(),
                  leadsServed: z.number(),
                  leadsContacted: z.number().describe("Count of unique leads that received at least one email"),
                  leadsBuffered: z.number(),
                  leadsSkipped: z.number(),
                  emailsGenerated: z.number(),
                  recipientStats: RecipientStatsSchema,
                  emailStats: EmailStatsSchema,
                  totalCostInUsdCents: z.string().nullable(),
                  runCount: z.number(),
                  failureDetails: StatsFailureDetailsSchema,
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
// BRAND-SCOPED PROVIDER KEYS
//
// The same credential one grain finer — keyed on (org, brand, provider) — so two
// brands of one org can hold different credentials for the same provider. Request
// and response shapes are owned by key-service and forwarded untransformed.
//
// key-service's `/keys/brands/{brandId}/{provider}/decrypt` is NOT proxied and is
// not documented here: it resolves the credential in clear and is service-to-service
// only.
// ===================================================================

const BrandKeyPassthroughResponse = z
  .object({})
  .passthrough()
  .openapi("BrandKeyPassthroughResponse");

const BrandKeyPassthroughRequest = z
  .object({})
  .passthrough()
  .openapi("BrandKeyPassthroughRequest");

const BrandKeyIdParam = z.object({
  brandId: z.string().describe("Brand the credential is scoped to"),
});

const brandKeyErrorResponses = {
  400: { description: "Bad request, forwarded verbatim from key-service", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  500: { description: "Internal error", content: errorContent },
  502: { description: "key-service unreachable / not configured", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/keys/brands/{brandId}",
  tags: ["Keys"],
  summary: "List a brand's third-party keys (masked)",
  description:
    "Proxy to key-service GET /keys/brands/{brandId}. Returns one entry per provider stored for this (org, brand) pair, each carrying a MASKED key — the clear value is never served to a client. Response shape owned by key-service.",
  security: authed,
  request: { params: BrandKeyIdParam },
  responses: {
    200: { description: "Brand keys as returned by key-service", content: { "application/json": { schema: BrandKeyPassthroughResponse } } },
    ...brandKeyErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/keys/brands/{brandId}",
  tags: ["Keys"],
  summary: "Add or update a brand's third-party key",
  description:
    "Proxy to key-service POST /keys/brands/{brandId}. Body (`{ provider, apiKey }`) is forwarded verbatim — key-service owns the provider vocabulary and validates the shape. Upsert keyed on (org, brand, provider): storing one never overwrites another brand's credential, nor the org-wide key.",
  security: authed,
  request: {
    params: BrandKeyIdParam,
    body: { content: { "application/json": { schema: BrandKeyPassthroughRequest } } },
  },
  responses: {
    200: { description: "Saved; the masked key as returned by key-service", content: { "application/json": { schema: BrandKeyPassthroughResponse } } },
    ...brandKeyErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/keys/brands/{brandId}/{provider}",
  tags: ["Keys"],
  summary: "Delete a brand's third-party key",
  description:
    "Proxy to key-service DELETE /keys/brands/{brandId}/{provider}. Removes only this brand's credential for the provider; the org-wide key and other brands' keys are untouched. Response shape owned by key-service.",
  security: authed,
  request: {
    params: BrandKeyIdParam.extend({ provider: z.string().describe("Provider name") }),
  },
  responses: {
    200: { description: "Deletion result as returned by key-service", content: { "application/json": { schema: BrandKeyPassthroughResponse } } },
    404: { description: "No such brand key (forwarded verbatim)", content: errorContent },
    ...brandKeyErrorResponses,
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
      .min(1)
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
  summary: "List your API keys",
  description:
    "List YOUR API keys, across every organization you minted one in (each item carries the `orgId` that was active at creation). " +
    "A key belongs to its user, not to an organization, so no organization context is needed and other members' keys are never listed.",
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
  description:
    "Revoke one of YOUR API keys by ID, whatever organization it was minted in. A key you do not own answers 404 (same as an unknown id).",
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
            id: z.string().optional().describe("Revoked key ID"),
            orgId: z.string().optional().describe("Organization that was active when the key was minted"),
          }).openapi("RevokeApiKeyResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No key with this ID belongs to you", content: errorContent },
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

registry.registerPath({
  method: "get",
  path: "/v1/leads",
  tags: ["Leads"],
  summary: "List leads",
  description:
    "Pass-through to lead-service GET /orgs/leads. Filter by brandId and/or campaignId (at least one required). " +
    "The whole query string is forwarded to lead-service verbatim: the parameters listed here are the ones documented " +
    "today, not a whitelist — any other filter lead-service accepts can be sent and reaches it unchanged. " +
    "Each lead is a LeadDetail with the canonical FullLead payload under `lead` (lead-service v0.13.4+). " +
    "Refer to lead-service openapi.json for the exact query parameters and response shape — api-service forwards both untransformed.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().uuid().optional().openapi({ description: "Brand ID filter" }),
      campaignId: z.string().uuid().optional().openapi({ description: "Campaign ID filter" }),
      limit: z.coerce.number().int().optional().openapi({ description: "Max results to return" }),
      offset: z.coerce.number().int().optional().openapi({ description: "Offset for pagination" }),
      view: z.string().optional().openapi({ description: "Projection view forwarded to lead-service (e.g. `basic` for a slim payload)" }),
    }).passthrough(),
  },
  responses: {
    200: {
      description: "Leads as returned by lead-service GET /orgs/leads (LeadDetail[] under `leads`).",
      content: {
        "application/json": {
          schema: z
            .object({
              leads: z.array(z.record(z.unknown())).describe(
                "Array of LeadDetail objects from lead-service. Each item includes top-level fields " +
                "(id, leadId, email, namespace, apolloPersonId, emailStatus, status, statusReason, statusDetails, " +
                "parentRunId, runId, brandIds, campaignId, orgId, userId, workflowSlug, featureSlug, servedAt, " +
                "contacted, sent, delivered, opened, clicked, bounced, unsubscribed, replied, replyClassification, " +
                "lastDeliveredAt, global, audience: { id, name, avatarUrl } | null) plus a canonical `lead: FullLead | null` payload."
              ),
            })
            .openapi("BrandLeadsResponse"),
        },
      },
    },
    400: { description: "Missing brandId or campaignId", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/leads/stats",
  tags: ["Leads"],
  summary: "Lead counts, without the leads",
  description:
    "Pass-through to lead-service GET /orgs/stats. Returns a brand's (or campaign's, or the whole org's) lead " +
    "counts — the total plus the split by lifecycle state — with no lead rows in the response, so a surface that " +
    "renders a count badge does not have to download the lead list to get one integer. " +
    "The whole query string is forwarded to lead-service verbatim: the parameters listed here are the ones " +
    "documented today, not a whitelist — any other filter or `groupBy` dimension lead-service accepts can be sent " +
    "and reaches it unchanged. Org scope comes from the authenticated identity, not from the query. " +
    "Refer to lead-service openapi.json for the exact parameters and response shape — api-service forwards both untransformed.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().optional().openapi({ description: "Brand ID filter" }),
      campaignId: z.string().optional().openapi({ description: "Campaign ID filter" }),
      groupBy: z.string().optional().openapi({
        description:
          "Return one count row per value of this dimension (e.g. `campaignId`, `brandId`, `audienceId`) instead of a flat total.",
      }),
    }).passthrough(),
  },
  responses: {
    200: {
      description:
        "Lead counts as returned by lead-service GET /orgs/stats. Flat (`totalLeads`, `byOutreachStatus`, " +
        "`repliesDetail`, `buffered`, `skipped`, `claimed`) without `groupBy`, or `{ groups: [...] }` with it. " +
        "lead-service owns this shape; api-service forwards it byte-identical.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadStatsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/leads/{id}",
  tags: ["Leads"],
  summary: "Read one lead's full record",
  description:
    "Pass-through to lead-service GET /orgs/leads/{id}. Returns the full record of a SINGLE lead — the same object " +
    "GET /v1/leads emits for that row — wrapped as `{ leadDetail }` rather than a one-element list. " +
    "`id` is the `id` a row of GET /v1/leads already carries, so a caller needs nothing it did not already receive " +
    "from the list: take the slim list for the table, then ask for depth one row at a time instead of holding the " +
    "full projection for a whole brand. The whole query string is forwarded to lead-service verbatim: the parameters " +
    "listed here are the ones documented today, not a whitelist. `brandId` / `campaignId` mean exactly what they mean " +
    "on the list — which scope the delivery overlay answers for. The read is org-scoped downstream: a lead outside the " +
    "caller's org is a 404, indistinguishable from one that does not exist. " +
    "Because the segment is forwarded without being validated here, the literal paths lead-service registers ahead " +
    "of its own lead-id parameter are reachable through this operation: GET /v1/leads/crm-pairings?brandId=… reads " +
    "a brand's CRM contacts beside the leads we emailed for them, and GET /v1/leads/crm-pairing-counts?brandId=… " +
    "reads that view's summary counts. Both answer their own shapes, documented by lead-service. " +
    "Refer to lead-service openapi.json for the exact response shape — api-service forwards it untransformed.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads. A non-uuid value is a 400 from lead-service.",
      }),
    }),
    query: z.object({
      brandId: z.string().uuid().optional().openapi({
        description: "Delivery-overlay scope, same as on the list. A lead that does not belong to this brand is a 404.",
      }),
      campaignId: z.string().uuid().optional().openapi({
        description: "Campaign scope for the delivery overlay, same as on the list.",
      }),
    }).passthrough(),
  },
  responses: {
    200: {
      description: "The lead's full record as returned by lead-service (`{ leadDetail }`).",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadDetailResponse"),
        },
      },
    },
    400: { description: "Invalid lead id", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org (or brand, when brandId is given)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/leads/crm-pairings/rulings",
  tags: ["Leads"],
  summary: "Accept or deny a proposed pairing between a CRM contact and a lead we emailed",
  description:
    "Pass-through to lead-service POST /orgs/leads/crm-pairings/rulings. A human states that one of the brand's " +
    "own CRM contacts is, or is not, the same person as one of the leads we emailed for them. The statement " +
    "outranks both the matcher's signal and its judgment, survives a re-run of the matcher (it is keyed on the " +
    "pair, not on a matcher run), and is correctable by restating it or by taking it back with the DELETE on the " +
    "same path. " +
    "The pairings themselves and their summary counts are read at GET /v1/leads/crm-pairings?brandId=… and " +
    "GET /v1/leads/crm-pairing-counts?brandId=…, which this gateway forwards through its single-lead read — the " +
    "segment is not validated here and the query string travels verbatim, and lead-service registers both literal " +
    "paths ahead of its own lead-id parameter. " +
    "The body is forwarded VERBATIM: this gateway does not re-declare, narrow or enumerate lead-service's request " +
    "shape, so the `ruling` vocabulary stays authoritative in one place and a verdict it adds needs no release " +
    "here. Its refusals (a missing or non-uuid `brandId`, a missing `crmContactId`, a `leadId` that is not a uuid, " +
    "a `ruling` outside the vocabulary, a non-string `note`) reach the caller with their own status and body. " +
    "The caller's org AND user identity are forwarded, because lead-service records WHO ruled. " +
    "Refer to lead-service openapi.json for the exact request and response shapes.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("CrmPairingRulingRequest"),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The ruling as recorded by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("CrmPairingRulingResponse"),
        },
      },
    },
    400: { description: "Invalid ruling (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead or brand in this caller's org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/leads/crm-pairings/rulings",
  tags: ["Leads"],
  summary: "Take back a ruling somebody made about a CRM-contact-to-lead pairing",
  description:
    "Pass-through to lead-service DELETE /orgs/leads/crm-pairings/rulings — the undo of the POST on the same " +
    "path. Nothing is deleted downstream: the row survives carrying both what was stated and the fact that it was " +
    "withdrawn, and the pairing falls back to whatever the matcher's judgment and signal say. Withdrawing what is " +
    "already withdrawn is a success, not an error; withdrawing something nobody ever ruled on is a 409 carrying " +
    "`code: \"nothing_stated\"`, which reaches the caller field-for-field so a surface can tell it apart from a " +
    "server failure. " +
    "The pair is named in the query string, which is forwarded verbatim and read for nothing here — lead-service " +
    "owns these parameters and raises its own 400 on each, and one it ships later needs no release here. " +
    "The caller's org AND user identity are forwarded, because lead-service records who withdrew the ruling. " +
    "Refer to lead-service openapi.json for the exact response shape.",
  security: authed,
  request: {
    query: z
      .object({
        brandId: z.string().optional().openapi({
          description: "The brand whose CRM the pairing belongs to.",
        }),
        crmContactId: z.string().optional().openapi({
          description: "The contact id as it exists in the brand's own CRM.",
        }),
        leadId: z.string().optional().openapi({
          description: "The `id` of the lead as returned by GET /v1/leads.",
        }),
      })
      .passthrough()
      .openapi({
        description:
          "The parameters lead-service documents today, not a whitelist: the caller's query string is forwarded " +
          "verbatim, so anything it accepts reaches it. It is the one that decides which are required.",
      }),
  },
  responses: {
    200: {
      description:
        "The ruling was withdrawn (or was already withdrawn), as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("CrmPairingRulingWithdrawalResponse"),
        },
      },
    },
    400: { description: "Invalid pair (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: {
      description: "Nobody ruled on this pairing, so there is nothing to withdraw",
      content: errorContent,
    },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/leads/{id}/step-statements",
  tags: ["Leads"],
  summary: "Everything known about every funnel step of one lead",
  description:
    "Pass-through to lead-service GET /orgs/leads/{id}/step-statements. One entry per step of the outcome " +
    "vocabulary, always all of them: each is either an outcome (with the source that reported or stated it), a " +
    "`never` a human stated, or pending. Pending is named by lead-service rather than inferred from an absent " +
    "count — an outcome that has not arrived and a lead that is dead at that step used to read the same. " +
    "`id` is the `id` a row of GET /v1/leads already carries, so the panel listing the lead needs nothing new. " +
    "The read is org-scoped downstream. " +
    "Refer to lead-service openapi.json for the exact response shape — api-service forwards it untransformed.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
    }),
  },
  responses: {
    200: {
      description: "Per-step state for this lead, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadStepStatementsResponse"),
        },
      },
    },
    400: { description: "Invalid lead id", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/leads/{id}/step-statements",
  tags: ["Leads"],
  summary: "State by hand what happened to one lead at one funnel step (or that it never will)",
  description:
    "Pass-through to lead-service POST /orgs/leads/{id}/step-statements. Records, by hand, what happened to this " +
    "lead at one step of its campaign's sales funnel. An `outcome` is written to the same conversion ledger every " +
    "consumer already counts, so the brand's outcome counts move on the next read with nothing to change " +
    "downstream; a `never` goes to a store no count reads, so it can never move a number — it exists so a reader " +
    "can tell a lead that is DEAD at a step from one still PENDING. " +
    "The body is forwarded VERBATIM: this gateway does not re-declare or narrow lead-service's request shape, and " +
    "lead-service owns which statements are legal, including its refusals (a `never` on a step that already " +
    "happened, a value attached to a `never`, an unparseable timestamp). Those refusals reach the caller with " +
    "their own status and body so a surface can say WHY a statement was refused. " +
    "The caller's org AND user identity are forwarded, because lead-service records who stated the fact and " +
    "attributes the statement to the caller's own campaign row. " +
    "Refer to lead-service openapi.json for the exact request and response shapes.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadStepStatementRequest"),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The statement as recorded by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadStepStatementResponse"),
        },
      },
    },
    400: { description: "Invalid statement (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
    409: { description: "The statement contradicts one already recorded for this step", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/leads/{id}/step-statements/{step}",
  tags: ["Leads"],
  summary: "Take back a statement somebody made by hand about one funnel step of one lead",
  description:
    "Pass-through to lead-service DELETE /orgs/leads/{id}/step-statements/{step} — the undo of the POST on the " +
    "same path. A statement made by mistake (wrong lead, wrong step, a misread reply) is TAKEN BACK, so the step " +
    "reads exactly as it did before anybody spoke and the outcome stops counting in the brand's figures. Nothing " +
    "is deleted: what somebody stated and the fact they later withdrew it both stay readable. Withdrawing what " +
    "is already withdrawn is a success, not an error. " +
    "`id` and `step` are the ones the caller already holds, and neither is validated here: lead-service owns the " +
    "step vocabulary and this gateway does not enumerate it, so a step it ships later needs no release here. " +
    "Its refusals reach the caller with their own status and body, `code` included — a step nobody stated and " +
    "only READS as reached because the funnel implies it, an outcome the tracker reported rather than a person, " +
    "a pair outside this org — so a surface can tell each apart from a server failure. " +
    "Refer to lead-service openapi.json for the exact response shape.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
      step: z.string().openapi({
        description:
          "The funnel step whose statement is being taken back. lead-service owns this vocabulary and is the " +
          "only place it is authoritative — refer to its openapi.json rather than to this line, which cannot be " +
          "kept in lockstep across a deploy boundary.",
        example: "meeting_booked",
      }),
    }),
  },
  responses: {
    200: {
      description:
        "The statement was withdrawn (or was already withdrawn), with every step re-derived, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadStepStatementWithdrawalResponse"),
        },
      },
    },
    400: { description: "Invalid lead id or step (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
    409: {
      description:
        "Nothing a person stated to withdraw: the step was reported by the tracker or measured by the delivery " +
        "layer, or nobody stated it and it only reads as reached or dead because the funnel implies it. " +
        "lead-service names which in `code`.",
      content: errorContent,
    },
    500: { description: "Internal error", content: errorContent },
    502: { description: "lead-service could not reach a service it needs to answer", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/leads/{id}/followups",
  tags: ["Leads"],
  summary: "Read what we owe one lead next",
  description:
    "Pass-through to lead-service GET /orgs/leads/{id}/followups. What we owe this person on this campaign: " +
    "when the next follow-up is due, whether a worker currently holds them, how many have gone out, and why the " +
    "schedule is empty when it is. An empty due date is stated rather than implied, so \"nobody has scheduled " +
    "anything\" and \"somebody stopped it\" do not read the same. " +
    "`id` is the `id` a row of GET /v1/leads already carries, so the panel listing the lead needs nothing new. " +
    "The read is org-scoped downstream from the authenticated identity, never from the caller's query. " +
    "Refer to lead-service openapi.json for the exact response shape — api-service forwards it untransformed.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
    }),
  },
  responses: {
    200: {
      description: "This lead's follow-up state, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadFollowupResponse"),
        },
      },
    },
    400: { description: "Invalid lead id", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/leads/{id}/followups",
  tags: ["Leads"],
  summary: "State when the next follow-up to one lead is owed",
  description:
    "Pass-through to lead-service POST /orgs/leads/{id}/followups. States what was done for this person and when " +
    "the next action is due — which is how a customer looking at a lead whose next answer is days away can say " +
    "it is owed NOW: the write sets the due date and releases any claim, so the campaign picks that person up on " +
    "its next turn instead of waiting the schedule out. The response IS the resulting state, so a caller never " +
    "has to ask what its write did. " +
    "`id` is the `id` a row of GET /v1/leads already carries — the same one the detail panel used to read the " +
    "lead — so no identity field about the person is re-supplied. " +
    "The body is forwarded VERBATIM: this gateway does not re-declare, narrow or enumerate lead-service's " +
    "request shape, and lead-service owns which statements are legal, including its refusals (a date outside the " +
    "accepted range, an unparseable one, a missing reason on a stop, a lead outside this org). Those refusals " +
    "reach the caller with their own status and body, `code` included, so a surface can say WHY the request was " +
    "refused rather than showing a generic failure. " +
    "The caller's org AND user identity are forwarded; the org boundary is the authenticated one and is never " +
    "read from the body or query. " +
    "Refer to lead-service openapi.json for the exact request and response shapes.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadFollowupRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The resulting follow-up state, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadFollowupWriteResponse"),
        },
      },
    },
    400: {
      description:
        "Invalid id or kind, a missing reason on a stop, or a due date that is unparseable or outside the " +
        "accepted range. lead-service names which in `code` and carries the bounds where they apply.",
      content: errorContent,
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/leads/crm-evidence/sync",
  tags: ["Leads"],
  summary: "Reflect a brand's own CRM onto its leads' funnels now",
  description:
    "Pass-through to lead-service POST /orgs/leads/crm-evidence/sync. Reads the meetings booked, meetings attended " +
    "and sales the brand's own CRM records against its paired leads and stores them as CRM evidence now, rather " +
    "than on lead-service's periodic sweep. The query string is forwarded verbatim; lead-service owns the 400 on a " +
    "missing or invalid `brandId` and the 502 naming a sibling it could not read. Scoped to the authenticated org. " +
    "Refer to lead-service openapi.json for the exact response shape.",
  security: authed,
  request: {
    query: z
      .object({
        brandId: z.string().openapi({ description: "The brand whose CRM is reflected (uuid)." }),
      })
      .passthrough()
      .openapi("LeadCrmEvidenceSyncQuery"),
  },
  responses: {
    200: {
      description: "What the sync read and stored, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadCrmEvidenceSyncResponse"),
        },
      },
    },
    400: { description: "Missing or invalid brandId", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "A service lead-service reads the CRM through could not answer", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/leads/{id}/crm-attribution",
  tags: ["Leads"],
  summary: "Whose win each step the customer's own CRM evidences on one lead was",
  description:
    "Pass-through to lead-service GET /orgs/leads/{id}/crm-attribution. For every funnel step the customer's own " +
    "CRM evidences on this lead (meeting booked, meeting attended, sale): the evidence, the default rule's answer " +
    "on whether our outreach caused it, a person's override if one was stated, and which one stands. " +
    "The query string is forwarded verbatim; the read is org-scoped downstream on the authenticated org. " +
    "Refer to lead-service openapi.json for the exact response shape.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
    }),
    query: z
      .object({
        brandId: z.string().optional().openapi({
          description: "Which brand the lead is read under — the same scoping GET /v1/leads/{id} takes.",
        }),
      })
      .passthrough()
      .openapi("LeadCrmAttributionQuery"),
  },
  responses: {
    200: {
      description: "Per CRM-evidenced step attribution for this lead, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadCrmAttributionResponse"),
        },
      },
    },
    400: { description: "Invalid lead id", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/leads/{id}/crm-attribution/{step}",
  tags: ["Leads"],
  summary: "State whether a CRM-evidenced step should be credited to our outreach",
  description:
    "Pass-through to lead-service PUT /orgs/leads/{id}/crm-attribution/{step}. A person states whether the meeting " +
    "or sale the customer's own CRM records on this lead was caused by our outreach; the statement outranks the " +
    "default rule until withdrawn through the DELETE on the same path. The body is forwarded VERBATIM and the step " +
    "vocabulary is not enumerated here. Refusals reach the caller with their own status and body, `code` included — " +
    "notably 409 `no_crm_evidence` when the CRM evidences no such step on this lead. The caller's org AND user are " +
    "forwarded because lead-service records who stated it. Refer to lead-service openapi.json for the exact shapes.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
      step: z.string().openapi({
        description:
          "A CRM-evidenced funnel step. lead-service owns this vocabulary and answers 400 naming the steps it " +
          "accepts — refer to its openapi.json rather than to this line.",
        example: "meeting_booked",
      }),
    }),
    query: z
      .object({
        brandId: z.string().optional().openapi({
          description: "Which brand the lead is read under — the same scoping GET /v1/leads/{id} takes.",
        }),
      })
      .passthrough()
      .openapi("LeadCrmAttributionWriteQuery"),
    body: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadCrmAttributionRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The step's attribution after the statement, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadCrmAttributionStepResponse"),
        },
      },
    },
    400: { description: "Invalid step or body (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
    409: { description: "The customer's CRM evidences no such step on this lead (`code: no_crm_evidence`)", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/leads/{id}/crm-attribution/{step}",
  tags: ["Leads"],
  summary: "Withdraw a statement about a CRM-evidenced step",
  description:
    "Pass-through to lead-service DELETE /orgs/leads/{id}/crm-attribution/{step} — the undo of the PUT on the same " +
    "path, so the default rule's answer stands again. Withdrawing what is already withdrawn is a success " +
    "(`alreadyWithdrawn: true`). Refusals reach the caller with their own status and body. " +
    "Refer to lead-service openapi.json for the exact response shape.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
      step: z.string().openapi({
        description:
          "A CRM-evidenced funnel step. lead-service owns this vocabulary and answers 400 naming the steps it " +
          "accepts — refer to its openapi.json rather than to this line.",
        example: "meeting_booked",
      }),
    }),
    query: z
      .object({
        brandId: z.string().optional().openapi({
          description: "Which brand the lead is read under — the same scoping GET /v1/leads/{id} takes.",
        }),
      })
      .passthrough()
      .openapi("LeadCrmAttributionWithdrawQuery"),
  },
  responses: {
    200: {
      description: "The step's attribution after the withdrawal, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadCrmAttributionWithdrawalResponse"),
        },
      },
    },
    400: { description: "Invalid step (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/leads/{id}/history",
  tags: ["Leads"],
  summary: "Everything that happened to one person, in order, in one place",
  description:
    "Pass-through to lead-service GET /orgs/leads/{id}/history. Both directions of every exchange WITH the " +
    "message bodies, what was sent and when it was delivered, what the person did, what somebody recorded by " +
    "hand and who recorded it, and what it converted into — one ordered, de-duplicated list a consumer renders " +
    "without merging anything. lead-service asks each fact of the service that owns it; api-service forwards " +
    "the answer untransformed and aggregates nothing. " +
    "`id` is the `id` a row of GET /v1/leads already carries, so the panel listing the lead needs nothing new. " +
    "The read distinguishes a source it could NOT read (`sources[].status: \"unavailable\"`, `complete: false`) " +
    "from a fact that did not happen, and says so in the body — this gateway forwards that body byte-for-byte " +
    "rather than flattening it, because \"we could not read your mailbox\" and \"your prospect said nothing\" are " +
    "different answers. The query parameters below are the ones lead-service documents today, not a whitelist: " +
    "the caller's query string is forwarded verbatim, so any parameter it accepts later reaches it unchanged. " +
    "The read is org-scoped downstream on the authenticated org. " +
    "Refer to lead-service openapi.json for the exact response shape.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
    }),
    query: z
      .object({
        scope: z.string().optional().openapi({
          description:
            "`campaign` (lead-service's default): what this campaign did. `brand`: the roll-up across every " +
            "campaign of the brand this person is in. The vocabulary is lead-service's and is not enumerated " +
            "here — it answers the refusal on a value it does not accept.",
          example: "campaign",
        }),
        brandId: z.string().optional().openapi({
          description:
            "Which brand the history is about — the same scoping GET /v1/leads/{id} takes. A brand this row is " +
            "not part of answers 404, exactly as an absent row does.",
        }),
      })
      .passthrough()
      .openapi("LeadHistoryQuery"),
  },
  responses: {
    200: {
      description: "The person's history, ordered oldest first, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadHistoryResponse"),
        },
      },
    },
    400: {
      description: "Invalid lead id, or a `scope` lead-service does not accept (it states which)",
      content: errorContent,
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org (or for the requested brand scope)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/leads/{id}/timeline",
  tags: ["Leads"],
  summary: "One person's stored timeline for a brand, every item labelled, with the conversation's tags",
  description:
    "Pass-through to lead-service GET /orgs/leads/{id}/timeline. The person's stored timeline for one brand " +
    "(and optionally one offer): every item carries the fact it records, and `tags` states the conversation's " +
    "last word and the furthest step reached, flagged attributable to our outreach or not. lead-service builds " +
    "and stores it; api-service forwards the answer untransformed and aggregates nothing. " +
    "`id` is the `id` a row of GET /v1/leads already carries, exactly as on GET /v1/leads/{id}/history. " +
    "The query parameters below are the ones lead-service documents today, not a whitelist: the caller's query " +
    "string is forwarded verbatim. The read is org-scoped downstream on the authenticated org. " +
    "Refer to lead-service openapi.json for the exact response shape.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
    }),
    query: z
      .object({
        brandId: z.string().optional().openapi({
          description:
            "Which brand the timeline is about. Required by lead-service (it answers 400 without it); a brand " +
            "this row is not part of answers 404, exactly as an absent row does.",
        }),
        offerId: z.string().optional().openapi({
          description: "Narrow the timeline to one offer of the brand.",
        }),
      })
      .passthrough()
      .openapi("LeadTimelineQuery"),
  },
  responses: {
    200: {
      description: "The person's labelled timeline and the conversation's tags, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadTimelineResponse"),
        },
      },
    },
    400: { description: "No brandId, or an invalid lead id (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org, or a brand the row is not part of", content: errorContent },
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


// Passthrough — brand-service owns this shape. A brand may have NO website:
// callers send `name` (identity source) instead of `url`, and may include a
// large free-form business-context field. Both are forwarded as-is; the
// route handler enforces "at least one of url/name" (fail loud).
export const BrandUpsertRequestSchema = z
  .object({
    url: z.string().min(1).optional().describe("Brand website URL (omit for a no-website brand)"),
    name: z.string().min(1).optional().describe("Brand name — identity source when no URL is provided"),
  })
  .passthrough()
  .openapi("BrandUpsertRequest");

// Passthrough — brand-service owns this shape. Per CLAUDE.md "Response schema policy",
// no field re-declaration here. Field renames downstream do not require an api-service edit.
const BrandSummarySchema = z.object({}).passthrough().openapi("BrandSummary");

const ExtractFieldRequestSchema = z.object({
  key: z.string().describe("Field key (e.g. 'industry', 'valueProposition')"),
  description: z.string().describe("Description of what to extract"),
}).openapi("ExtractFieldRequest");

registry.registerPath({
  method: "post",
  path: "/v1/scraping/scrape",
  tags: ["Scraping"],
  summary: "Scrape a URL",
  description:
    "Transparent proxy to scraping-service POST /scrape. Body is forwarded as-is.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            url: z.string().min(1).describe("URL to scrape"),
            skipCache: z.boolean().optional().describe("Skip cached results and force re-scrape"),
            provider: z.enum(["scrape-do", "firecrawl"]).optional().describe("Scraping provider (default: scrape-do)"),
          }).passthrough().openapi("ScrapeRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Scrape result",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ScrapeResponse"),
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
  path: "/v1/scraping/scrape/by-url",
  tags: ["Scraping"],
  summary: "Get scrape result by URL",
  description: "Transparent proxy to scraping-service GET /scrape/by-url",
  security: authed,
  request: {
    query: z.object({
      url: z.string().describe("URL to look up"),
    }),
  },
  responses: {
    200: {
      description: "Cached scrape result",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ScrapeByUrlResponse"),
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
  path: "/v1/brands/by-ids",
  tags: ["Brand"],
  summary: "Batch lookup brands by ID",
  description:
    "Resolve multiple brands in a single round-trip. Pass UUIDs as a comma-separated list in the `ids` query param. " +
    "Proxies to brand-service `GET /internal/brands?ids=...`. Missing ids are silently omitted from the response. " +
    "If the caller exceeds the upstream per-request cap, brand-service returns 400 and the error is propagated verbatim.",
  security: authed,
  request: {
    query: z.object({
      ids: z.string().min(1).describe("Comma-separated UUIDs"),
    }).openapi("BatchBrandsByIdsQuery"),
  },
  responses: {
    200: {
      description: "Batch brand lookup result (passthrough — brand-service owns the shape)",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("BatchBrandsByIdsResponse"),
        },
      },
    },
    400: { description: "Missing ids query param or upstream cap exceeded", content: errorContent },
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
          schema: z.object({ brand: BrandSummarySchema }).openapi("GetBrandResponse"),
        },
      },
    },
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
    "Multi-brand field extraction. Pass brandIds in the request body — api-service sets x-brand-id header and proxies to brand-service. " +
    "Send fields you want with a key and description, and brand-service extracts them via AI. " +
    "Results are cached 30 days per field per brand. " +
    "Pass brandIds in the request body — api-service sets x-brand-id header and proxies to brand-service.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            brandIds: z.array(z.string()).min(1).describe("Brand UUIDs to extract fields for"),
            fields: z.array(ExtractFieldRequestSchema).describe("Fields to extract"),
            resetCache: z.boolean().optional().describe("When true, bypass all cache layers (URL maps, page scrapes, field extractions, consolidated fields) and force a full re-extraction"),
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
          schema: z.object({}).passthrough().openapi("ExtractFieldsFromHeaderResponse"),
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
          schema: z.object({}).passthrough().openapi("ExtractedFieldsResponse"),
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

registry.registerPath({
  method: "post",
  path: "/v1/brands/extract-images",
  tags: ["Brand"],
  summary: "Extract images from brand(s)",
  description:
    "Multi-brand image extraction. Pass brandIds in the request body — api-service sets x-brand-id header and proxies to brand-service. " +
    "Pass brandIds in the request body — api-service sets x-brand-id header and proxies to brand-service.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            brandIds: z.array(z.string()).min(1).describe("Brand UUIDs to extract images for"),
            categories: z.array(ExtractImageCategorySchema).describe("Image categories to extract"),
          }).openapi("ExtractImagesFromHeaderRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Extracted image results",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ExtractImagesMultiBrandResponse"),
        },
      },
    },
    400: { description: "Validation error or Anthropic API key not configured", content: errorContent },
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
          schema: z.object({}).passthrough().openapi("ExtractedImagesResponse"),
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
          schema: z.object({}).passthrough().openapi("UpsertBrandResponse"),
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

// Brand – Leg rates + per-offer economics (proxy to brand-service)
// Funnel-free model: org > brand > offer > outcome > leg. A leg moves a lead from one
// step to another; brand-service owns the leg vocabulary, rate bounds and both shapes.
const LegRatesResponseSchema = z.object({}).passthrough().openapi("LegRatesResponse");
const LegRatesRequestSchema = z.object({}).passthrough().openapi("LegRatesRequest");
const OfferEconomicsResponseSchema = z.object({}).passthrough().openapi("OfferEconomicsResponse");
const OfferEconomicsRequestSchema = z.object({}).passthrough().openapi("OfferEconomicsRequest");
const BrandOfferParam = z.object({
  id: z.string().describe("Brand ID"),
  offerId: z.string().describe("Offer ID"),
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/leg-rates",
  tags: ["Brand"],
  summary: "Get a brand's conversion rate per leg",
  description:
    "Proxy to brand-service GET /orgs/brands/{id}/leg-rates. Returns the brand's conversion rate for each leg " +
    "(a leg moves a lead from one step to another). Response shape is owned by the downstream service.",
  security: authed,
  request: {
    params: BrandIdParam,
  },
  responses: {
    200: { description: "Downstream body, untouched", content: { "application/json": { schema: LegRatesResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/leg-rates",
  tags: ["Brand"],
  summary: "Save a brand's conversion rates per leg",
  description:
    "Proxy to brand-service PUT /orgs/brands/{id}/leg-rates. Body + response shapes, the leg vocabulary and " +
    "rate bounds are owned by the downstream service; its 4xx errors propagate verbatim.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: LegRatesRequestSchema } } },
  },
  responses: {
    200: { description: "Downstream body, untouched", content: { "application/json": { schema: LegRatesResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/economics",
  tags: ["Brand"],
  summary: "Get one offer's economics",
  description:
    "Proxy to brand-service GET /orgs/brands/{id}/offers/{offerId}/economics. Returns the offer's economics " +
    "(e.g. lifetime revenue per customer). Response shape is owned by the downstream service.",
  security: authed,
  request: {
    params: BrandOfferParam,
  },
  responses: {
    200: { description: "Downstream body, untouched", content: { "application/json": { schema: OfferEconomicsResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/offers/{offerId}/economics",
  tags: ["Brand"],
  summary: "Save one offer's economics",
  description:
    "Proxy to brand-service PUT /orgs/brands/{id}/offers/{offerId}/economics. Body + response shapes are " +
    "owned by the downstream service; its 4xx errors propagate verbatim.",
  security: authed,
  request: {
    params: BrandOfferParam,
    body: { content: { "application/json": { schema: OfferEconomicsRequestSchema } } },
  },
  responses: {
    200: { description: "Downstream body, untouched", content: { "application/json": { schema: OfferEconomicsResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ===================================================================
// Brand – Offer proposals + confirm (proxy to brand-service
// /orgs/brands/:brandId/offers/{proposals,confirm}). Downstream owns both shapes.
// ===================================================================
const OfferProposalsResponseSchema = z.object({}).passthrough().openapi("OfferProposalsResponse");
const OfferConfirmResponseSchema = z.object({}).passthrough().openapi("OfferConfirmResponse");
const OfferPassthroughBody = z.object({}).passthrough();

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/offers/proposals",
  tags: ["Brand"],
  summary: "Propose offers for a brand from a free-text description",
  description:
    "Proxy to brand-service POST /orgs/brands/{brandId}/offers/proposals. Persists nothing. One LLM " +
    "call plus a typed judgment, so it can take up to a minute. Request + response shapes are owned by " +
    "brand-service. A 422 (the description names nothing to sell) and a 502 (LLM error) reach the caller " +
    "with their body intact.",
  security: authed,
  request: {
    params: z.object({ id: z.string().describe("Brand ID") }),
    body: { content: { "application/json": { schema: OfferPassthroughBody } } },
  },
  responses: {
    200: { description: "Proposed offers (brand-service shape)", content: { "application/json": { schema: OfferProposalsResponseSchema } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such brand (forwarded verbatim)", content: errorContent },
    422: { description: "The description names nothing to sell (forwarded verbatim)", content: errorContent },
    502: { description: "LLM error (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/offers/confirm",
  tags: ["Brand"],
  summary: "Create the offers the customer kept from a proposal",
  description:
    "Proxy to brand-service POST /orgs/brands/{brandId}/offers/confirm. Request + response shapes are " +
    "owned by brand-service; downstream status and body are forwarded verbatim.",
  security: authed,
  request: {
    params: z.object({ id: z.string().describe("Brand ID") }),
    body: { content: { "application/json": { schema: OfferPassthroughBody } } },
  },
  responses: {
    200: { description: "Created offers (brand-service shape)", content: { "application/json": { schema: OfferConfirmResponseSchema } } },
    201: { description: "Created offers (brand-service shape)", content: { "application/json": { schema: OfferConfirmResponseSchema } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such brand (forwarded verbatim)", content: errorContent },
    409: { description: "Conflict (forwarded verbatim)", content: errorContent },
  },
});

// ===================================================================
// Brand – Offer image (proxy to brand-service /orgs/brands/:id/offers/:offerId/image)
// The offer READS carry the image already, because this gateway does not
// re-declare offer response shapes. The WRITE is this route, and it is what the
// dashboard's "Regenerate with AI" button presses.
//
// Downstream owns the body and the response — passthrough only, and its 402 is
// the one refusal a consumer must be able to branch on: it means the org cannot
// afford the generation, and the dashboard opens its recharge modal on exactly
// that status. respondUpstreamError forwards it with its body (CLAUDE.md #7).
// ===================================================================
const OfferImageRequestSchema = z
  .object({
    prompt: z.string().min(1).optional().openapi({
      description:
        "Optional prompt override. Omit it (or send {}) to let brand-service build the " +
        "prompt from the offer's own descriptors — the gateway supplies no default.",
      example: "A brass compass resting on a folded map",
    }),
  })
  .passthrough()
  .openapi("OfferImageRequest");

const OfferImageResponseSchema = z.object({}).passthrough().openapi("OfferImageResponse");

const BrandOfferParams = z.object({
  id: z.string().describe("Brand ID"),
  offerId: z.string().describe("Offer ID"),
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/offers/{offerId}/image",
  tags: ["Brand"],
  summary: "(Re)generate an offer's image",
  description:
    "Proxy to brand-service POST /orgs/brands/{brandId}/offers/{offerId}/image. Generates " +
    "the picture that stands for this offer and stores the hosted URL on it; regenerating " +
    "REPLACES whatever was there, since there is one image per offer. Answers { offer } — " +
    "the same offer the reads serve, with `imageUrl` set. " +
    "Send {} to generate from the offer's own descriptors, or { prompt } to say what to " +
    "draw; the gateway invents neither. " +
    "COST: chat-service is the terminal caller and owns both the image-gen spend and the " +
    "affordability gate, billed to the REQUESTING ORG — the gateway declares nothing and " +
    "only forwards the caller's identity. A 402 means that org cannot afford it and reaches " +
    "you AS a 402 with its body; it is never swallowed and never a silent no-op.",
  security: authed,
  request: {
    params: BrandOfferParams,
    body: { content: { "application/json": { schema: OfferImageRequestSchema } } },
  },
  responses: {
    200: { description: "The offer, with the freshly generated image on it", content: { "application/json": { schema: OfferImageResponseSchema } } },
    400: { description: "Invalid brand or offer ID format (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    402: { description: "The org cannot afford the image generation (forwarded verbatim)", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "No such brand, or no such offer on it (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
    502: { description: "Image generation failed (forwarded verbatim)", content: errorContent },
  },
});

// ===================================================================
// Brand – Offer sales path (proxy to brand-service
// /orgs/brands/:id/offers/:offerId/sales-path). Passthrough: brand-service owns the body.
// ===================================================================
const OfferSalesPathSchema = z
  .object({
    offerId: z.string().uuid(),
    stated: z.boolean(),
    steps: z.array(z.string()).nullable(),
    legKeys: z.array(z.string()).nullable(),
    statedAt: z.string().nullable(),
  })
  .passthrough()
  .openapi("OfferSalesPath");

const PutOfferSalesPathBodySchema = z
  .object({
    steps: z.array(z.string()),
    legKeys: z.array(z.string()),
  })
  .passthrough()
  .openapi("PutOfferSalesPathBody");

const OFFER_SALES_PATH_NOTE =
  "How an offer sells, as the customer states it: the funnel steps it goes through and the legs " +
  "between them that apply (features-service step keys and leg keys, stored as given). " +
  "stated: false (steps and legKeys null) = never stated, distinct from stated: true with empty lists.";

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/sales-path",
  tags: ["Brand"],
  summary: "Read the funnel steps and legs selected for an offer",
  description: "Proxy to brand-service GET /orgs/brands/{brandId}/offers/{offerId}/sales-path. " + OFFER_SALES_PATH_NOTE,
  security: authed,
  request: { params: BrandOfferParams },
  responses: {
    200: { description: "The selection (or not stated)", content: { "application/json": { schema: OfferSalesPathSchema } } },
    400: { description: "Invalid brand or offer ID format (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "No such brand, or no such offer on it (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/offers/{offerId}/sales-path",
  tags: ["Brand"],
  summary: "Replace the funnel steps and legs selected for an offer",
  description:
    "Proxy to brand-service PUT /orgs/brands/{brandId}/offers/{offerId}/sales-path. Replaces the whole " +
    "selection (both lists required, may be empty) and answers it as read back. " + OFFER_SALES_PATH_NOTE,
  security: authed,
  request: {
    params: BrandOfferParams,
    body: { content: { "application/json": { schema: PutOfferSalesPathBodySchema } } },
  },
  responses: {
    200: { description: "The selection, as read after the write", content: { "application/json": { schema: OfferSalesPathSchema } } },
    400: { description: "Invalid ID or body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "No such brand, or no such offer on it (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ===================================================================
// Brand – Offer channels (proxy to brand-service
// /orgs/brands/:id/offers/:offerId/channels). Passthrough:
// brand-service owns every body.
// ===================================================================
const OfferChannelsSchema = z.object({}).passthrough().openapi("OfferChannels");
const PutOfferChannelsBodySchema = z
  .object({ channelSlugs: z.array(z.string()) })
  .passthrough()
  .openapi("PutOfferChannelsBody");

const OFFER_CHANNELS_NOTE =
  "The channels an offer accepts (features-service channel slugs, stored as given). " +
  "stated: false (channelSlugs null) = never stated, distinct from stated: true with an empty list.";

const offerProxyErrors = {
  400: { description: "Invalid ID or body (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
  404: { description: "No such brand, or no such offer on it (forwarded verbatim)", content: errorContent },
  500: { description: "Upstream error", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/channels",
  tags: ["Brand"],
  summary: "Read the channels an offer accepts",
  description: "Proxy to brand-service GET /orgs/brands/{brandId}/offers/{offerId}/channels. " + OFFER_CHANNELS_NOTE,
  security: authed,
  request: { params: BrandOfferParams },
  responses: {
    200: { description: "The channels (or not stated)", content: { "application/json": { schema: OfferChannelsSchema } } },
    ...offerProxyErrors,
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/offers/{offerId}/channels",
  tags: ["Brand"],
  summary: "Replace the channels an offer accepts",
  description:
    "Proxy to brand-service PUT /orgs/brands/{brandId}/offers/{offerId}/channels. Replaces the whole list " +
    "(may be empty; a slug twice is a 400) and answers it as read back. " + OFFER_CHANNELS_NOTE,
  security: authed,
  request: {
    params: BrandOfferParams,
    body: { content: { "application/json": { schema: PutOfferChannelsBodySchema } } },
  },
  responses: {
    200: { description: "The channels, as read after the write", content: { "application/json": { schema: OfferChannelsSchema } } },
    ...offerProxyErrors,
  },
});

// ===================================================================
// Brand – Offer selected sales paths (proxy to brand-service
// /orgs/brands/:id/offers/:offerId/selected-sales-paths). Passthrough:
// brand-service owns every body.
// ===================================================================
const OfferSelectedSalesPathsSchema = z.object({}).passthrough().openapi("OfferSelectedSalesPaths");
const PutOfferSelectedSalesPathsBodySchema = z
  .object({ combinationKeys: z.array(z.string()) })
  .passthrough()
  .openapi("PutOfferSelectedSalesPathsBody");

const OFFER_SELECTED_SALES_PATHS_NOTE =
  "The sales paths the customer selected on an offer (features-service combinationKeys, stored as given; " +
  "several may share a campaign, no money). stated: false (combinationKeys null) = never stated, distinct " +
  "from stated: true with an empty list.";

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/selected-sales-paths",
  tags: ["Brand"],
  summary: "Read the sales paths selected on an offer",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/offers/{offerId}/selected-sales-paths. " +
    OFFER_SELECTED_SALES_PATHS_NOTE,
  security: authed,
  request: { params: BrandOfferParams },
  responses: {
    200: {
      description: "The selected paths (or not stated)",
      content: { "application/json": { schema: OfferSelectedSalesPathsSchema } },
    },
    ...offerProxyErrors,
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/offers/{offerId}/selected-sales-paths",
  tags: ["Brand"],
  summary: "Replace the sales paths selected on an offer",
  description:
    "Proxy to brand-service PUT /orgs/brands/{brandId}/offers/{offerId}/selected-sales-paths. Replaces the " +
    "whole list (may be empty; a key twice is a 400) and answers it as read back. " +
    OFFER_SELECTED_SALES_PATHS_NOTE,
  security: authed,
  request: {
    params: BrandOfferParams,
    body: { content: { "application/json": { schema: PutOfferSelectedSalesPathsBodySchema } } },
  },
  responses: {
    200: {
      description: "The selected paths, as read after the write",
      content: { "application/json": { schema: OfferSelectedSalesPathsSchema } },
    },
    ...offerProxyErrors,
  },
});

// ===================================================================
// Brand – Offer archive / unarchive (proxy to brand-service
// /orgs/brands/:id/offers/:offerId/archive|unarchive). Passthrough: brand-service owns
// the { offer } body (with `status` + `archivedAt`) and the 409 refusal.
// ===================================================================
const OfferArchiveResponseSchema = z.object({}).passthrough().openapi("OfferArchiveResponse");

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/offers/{offerId}/archive",
  tags: ["Brand"],
  summary: "Archive an offer",
  description:
    "Proxy to brand-service POST /orgs/brands/{brandId}/offers/{offerId}/archive. Retires an " +
    "offer the org no longer sells: it leaves the default offer listing " +
    "(GET /v1/brands/{id}/offers; pass includeArchived=true to see it). Nothing is deleted and " +
    "unarchive restores it. Answers { offer } with status \"archived\" and archivedAt. " +
    "Refused 409 with reason \"offer_has_ongoing_campaign\" and campaignIds while a campaign " +
    "on the offer is ongoing (forwarded verbatim).",
  security: authed,
  request: { params: BrandOfferParams },
  responses: {
    200: { description: "The archived offer", content: { "application/json": { schema: OfferArchiveResponseSchema } } },
    400: { description: "Invalid brand or offer ID format (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "No such brand, or no such offer on it (forwarded verbatim)", content: errorContent },
    409: { description: "An ongoing campaign runs on this offer: reason offer_has_ongoing_campaign (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
    502: { description: "campaign-service could not be asked (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/offers/{offerId}/unarchive",
  tags: ["Brand"],
  summary: "Unarchive an offer",
  description:
    "Proxy to brand-service POST /orgs/brands/{brandId}/offers/{offerId}/unarchive. Brings an " +
    "archived offer back into the default listing. Answers { offer } with status \"active\".",
  security: authed,
  request: { params: BrandOfferParams },
  responses: {
    200: { description: "The active offer", content: { "application/json": { schema: OfferArchiveResponseSchema } } },
    400: { description: "Invalid brand or offer ID format (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "No such brand, or no such offer on it (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ===================================================================
// Brand – Click Destination (proxy to brand-service /orgs/brands/:id/click-destination)
// Downstream owns body + response shapes — passthrough only. No gateway
// re-validation, so brand-service's 4xx errors propagate verbatim.
// ===================================================================
const ClickDestinationRequestSchema = z
  .object({
    clickDestinationUrl: z.string().openapi({
      description: "Page outreach clicks should land on. Must be a valid http(s) URL.",
      example: "https://acme.com/welcome",
    }),
  })
  .openapi("ClickDestinationRequest");
const ClickDestinationResponseSchema = z
  .object({ clickDestinationUrl: z.string() })
  .openapi("ClickDestinationResponse");

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/click-destination",
  tags: ["Brand"],
  summary: "Set a brand's outreach click-destination URL",
  description:
    "Proxy to brand-service PUT /orgs/brands/{id}/click-destination. " +
    "Sets the per-brand page outreach clicks should land on (default = brand domain, " +
    "user-overridable). Body + response shapes are owned by the downstream service; its " +
    "4xx validation errors (incl. 400 on a non-http(s)/invalid URL) propagate verbatim.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: ClickDestinationRequestSchema } } },
  },
  responses: {
    200: { description: "Click destination saved", content: { "application/json": { schema: ClickDestinationResponseSchema } } },
    400: { description: "Invalid click-destination URL (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand not in caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ===================================================================
// Brand – Sales Rep Phone (proxy to brand-service /orgs/brands/{brandId}/sales-rep-phone)
// The one number to ring when a prospect replies interested. Downstream owns the
// body + response shapes and what counts as a valid number — passthrough only,
// so its refusals propagate verbatim with their own status (CLAUDE.md #7, #8).
// ===================================================================
const SalesRepPhoneRequestSchema = z
  .object({})
  .passthrough()
  .openapi("SalesRepPhoneRequest");
const SalesRepPhoneResponseSchema = z
  .object({})
  .passthrough()
  .openapi("SalesRepPhoneResponse");

const salesRepPhoneErrors = {
  400: { description: "Invalid brand ID, or a number brand-service refuses (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Brand not in caller's org (forwarded verbatim)", content: errorContent },
  404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
  500: { description: "Upstream error", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/sales-rep-phone",
  tags: ["Brand"],
  summary: "Read a brand's sales rep phone",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/sales-rep-phone. " +
    "The one number to ring when a prospect replies to one of this brand's campaigns saying " +
    "they are interested, or null when the brand never stated one — \"nobody to ring\" is a " +
    "first-class answer, not a 404. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "The saved number, or null when unset", content: { "application/json": { schema: SalesRepPhoneResponseSchema } } },
    ...salesRepPhoneErrors,
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/sales-rep-phone",
  tags: ["Brand"],
  summary: "Set a brand's sales rep phone",
  description:
    "Proxy to brand-service PUT /orgs/brands/{brandId}/sales-rep-phone. " +
    "States (or changes) the one number to ring when a sales interest lands on this brand. " +
    "Body + response shapes, and what counts as a valid number, are owned by the downstream " +
    "service; it normalizes what it accepts and refuses the rest with a 400 that propagates verbatim.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: SalesRepPhoneRequestSchema } } },
  },
  responses: {
    200: { description: "The saved number", content: { "application/json": { schema: SalesRepPhoneResponseSchema } } },
    ...salesRepPhoneErrors,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{id}/sales-rep-phone",
  tags: ["Brand"],
  summary: "Remove a brand's sales rep phone",
  description:
    "Proxy to brand-service DELETE /orgs/brands/{brandId}/sales-rep-phone. " +
    "The brand goes back to having nobody to ring. Response shape is owned by the downstream " +
    "service, which treats removing a number that was never stated as a success rather than a 404.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "Removed — the brand now has no number to ring", content: { "application/json": { schema: SalesRepPhoneResponseSchema } } },
    ...salesRepPhoneErrors,
  },
});

// ===================================================================
// Brand – own LinkedIn page (proxy to brand-service /orgs/brands/{brandId}/linkedin-page)
// Customer surface (any member of the brand's org, no staff gate). Passthrough:
// brand-service owns every body and what counts as a company page.
// ===================================================================
const BrandLinkedinPageSchema = z.object({}).passthrough().openapi("BrandLinkedinPage");
const SetBrandLinkedinPageBodySchema = z
  .object({ linkedinUrl: z.string() })
  .passthrough()
  .openapi("SetBrandLinkedinPageBody");

const BRAND_LINKEDIN_PAGE_NOTE =
  "The brand's own LinkedIn company page. Answers { brandId, status: not_computed | found | not_found, " +
  "linkedinUrl (https://www.linkedin.com/company/<slug>/ or null), discoveredAt, noneFoundReason, provenance: " +
  "{ method: brand_website_link | apollo_company_lookup | set_by_user, source: brand_website | apollo | user | null, " +
  "setBy: { userId, orgId, at } | null, foundOnUrl, pagesRead, runId, apollo: { asked, askedAt, outcome, linkedinUrl } } " +
  "| null }. not_computed = nothing decided yet (provenance null). A page a person set (source user) wins over every " +
  "automatic source and no later discovery overwrites it.";

const brandLinkedinPageErrors = {
  400: { description: "Invalid brand ID, or not a LinkedIn company page: { error, reason } (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Brand not in caller's org (forwarded verbatim)", content: errorContent },
  404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
  500: { description: "Upstream error", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/linkedin-page",
  tags: ["Brand"],
  summary: "Read the brand's own LinkedIn company page",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/linkedin-page. Reads what is stored: never starts a " +
    "discovery, never spends. " + BRAND_LINKEDIN_PAGE_NOTE,
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "The stored answer (or not_computed)", content: { "application/json": { schema: BrandLinkedinPageSchema } } },
    ...brandLinkedinPageErrors,
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/linkedin-page",
  tags: ["Brand"],
  summary: "Set the brand's own LinkedIn company page",
  description:
    "Proxy to brand-service PUT /orgs/brands/{brandId}/linkedin-page. Body { linkedinUrl } as pasted (no scheme, a " +
    "country subdomain or a trailing /about/ are fine); stored as https://www.linkedin.com/company/<slug>/ with " +
    "provenance.source user. Not a company page = 400 { error, reason: empty | not_a_url | not_linkedin | " +
    "personal_profile | not_company_page }, error is a sentence to show as is; nothing stored. " + BRAND_LINKEDIN_PAGE_NOTE,
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: SetBrandLinkedinPageBodySchema } } },
  },
  responses: {
    200: { description: "The page as stored", content: { "application/json": { schema: BrandLinkedinPageSchema } } },
    ...brandLinkedinPageErrors,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{id}/linkedin-page",
  tags: ["Brand"],
  summary: "Clear a LinkedIn page a person set",
  description:
    "Proxy to brand-service DELETE /orgs/brands/{brandId}/linkedin-page. Removes a page a person set: the brand is " +
    "back to not_computed and the next discovery decides automatically. An automatic answer is left as is. " +
    BRAND_LINKEDIN_PAGE_NOTE,
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "The stored answer after clearing", content: { "application/json": { schema: BrandLinkedinPageSchema } } },
    ...brandLinkedinPageErrors,
  },
});

// ===================================================================
// Brand – Sales Rep (proxy to brand-service /orgs/brands/{brandId}/sales-rep)
// The one person to reach when a sales interest lands on this brand: the address
// to copy on the prospect's thread and the number to ring. Downstream owns the
// body + response shapes and what counts as a valid rep — passthrough only, so
// its refusals propagate verbatim with their own status (CLAUDE.md #7, #8).
// ===================================================================
const SalesRepRequestSchema = z
  .object({})
  .passthrough()
  .openapi("SalesRepRequest");
const SalesRepResponseSchema = z
  .object({})
  .passthrough()
  .openapi("SalesRepResponse");

const salesRepErrors = {
  400: { description: "Invalid brand ID, or a rep brand-service refuses (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Brand not in caller's org (forwarded verbatim)", content: errorContent },
  404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
  500: { description: "Upstream error", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/sales-rep",
  tags: ["Brand"],
  summary: "Read a brand's sales rep",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/sales-rep. " +
    "The one person to reach when a prospect replies to one of this brand's campaigns saying " +
    "they are interested. A brand that never stated a rep still answers 200 — \"nobody to " +
    "reach\" is a first-class answer, not a 404, and either fact can be absent independently. " +
    "Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "The saved rep, or the unset answer when the brand never stated one", content: { "application/json": { schema: SalesRepResponseSchema } } },
    ...salesRepErrors,
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/sales-rep",
  tags: ["Brand"],
  summary: "Set a brand's sales rep",
  description:
    "Proxy to brand-service PUT /orgs/brands/{brandId}/sales-rep. " +
    "States (or changes) the whole rep in one write. Body + response shapes, and what counts " +
    "as a valid rep — including brand-service's rule that a phone may not be stated without an " +
    "email — are owned by the downstream service; it normalizes what it accepts and refuses the " +
    "rest with a 400 whose status and sentence propagate verbatim.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: SalesRepRequestSchema } } },
  },
  responses: {
    200: { description: "The saved rep", content: { "application/json": { schema: SalesRepResponseSchema } } },
    ...salesRepErrors,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{id}/sales-rep",
  tags: ["Brand"],
  summary: "Remove a brand's sales rep",
  description:
    "Proxy to brand-service DELETE /orgs/brands/{brandId}/sales-rep. " +
    "The brand goes back to having nobody to reach. Response shape is owned by the downstream " +
    "service, which treats removing a rep that was never stated as a success rather than a 404.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "Removed — the brand now has nobody to reach", content: { "application/json": { schema: SalesRepResponseSchema } } },
    ...salesRepErrors,
  },
});

// ===================================================================
// Brand – Business Context (proxy to brand-service /orgs/brands/:id/business-context)
// The free-form business context field-extraction reads from when a brand has no
// website. Downstream owns body + response shapes — passthrough only.
// GET returns { content: string | null }; PUT body { content: string }.
// ===================================================================
const BusinessContextResponseSchema = z
  .object({ content: z.string().nullable() })
  .openapi("BusinessContextResponse");
const BusinessContextRequestSchema = z
  .object({
    content: z.string().openapi({
      description: "Free-form business context field-extraction reads from for a no-website brand. Large bodies (~up to 1MB) accepted.",
      example: "Acme Corp is a B2B SaaS selling AI-powered analytics to mid-market retailers...",
    }),
  })
  .openapi("BusinessContextRequest");

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/business-context",
  tags: ["Brand"],
  summary: "Get a no-website brand's pasted business context",
  description:
    "Proxy to brand-service GET /orgs/brands/{id}/business-context. " +
    "Returns { content: string | null } — the free-form business context used as the " +
    "field-extraction source for a no-website brand, or null when unset. " +
    "Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "Business context (or null when unset)", content: { "application/json": { schema: BusinessContextResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/business-context",
  tags: ["Brand"],
  summary: "Save a no-website brand's business context",
  description:
    "Proxy to brand-service PUT /orgs/brands/{id}/business-context. " +
    "Saves the free-form business context field-extraction reads from when the brand " +
    "has no website (idempotent on brand_id). Large bodies (~up to 1MB) are accepted. " +
    "Body { content } + response shapes are owned by the downstream service; its 4xx " +
    "validation errors propagate verbatim.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: BusinessContextRequestSchema } } },
  },
  responses: {
    200: { description: "Business context saved", content: { "application/json": { schema: BusinessContextResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ===================================================================
// Brand – Attach Website (proxy to brand-service PATCH /orgs/brands/:id)
// Attaches a website to an existing no-website brand (sets url + domain).
// Downstream owns body { url } + response shapes — passthrough only.
// ===================================================================
const AttachBrandWebsiteRequestSchema = z
  .object({
    url: z.string().openapi({
      description: "The website URL to attach to the no-website brand. Must be a valid http(s) URL.",
      example: "https://acme.com",
    }),
  })
  .openapi("AttachBrandWebsiteRequest");
const AttachBrandWebsiteResponseSchema = z
  .object({})
  .passthrough()
  .openapi("AttachBrandWebsiteResponse");

registry.registerPath({
  method: "patch",
  path: "/v1/brands/{id}",
  tags: ["Brand"],
  summary: "Attach a website to an existing no-website brand",
  description:
    "Proxy to brand-service PATCH /orgs/brands/{id}. " +
    "Attaches a website to an existing no-website brand (sets brands.url + domain); the " +
    "next post-cache-expiry field extraction re-sources from the site automatically. " +
    "Body { url } + response shape ({ brandId, domain, name, url }) are owned by the " +
    "downstream service; its 4xx validation errors and 409 domain-conflict propagate verbatim.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: AttachBrandWebsiteRequestSchema } } },
  },
  responses: {
    200: { description: "Website attached", content: { "application/json": { schema: AttachBrandWebsiteResponseSchema } } },
    400: { description: "Invalid URL (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    409: { description: "Domain already in use by another brand (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ===================================================================
// Brand – Conversion Tracking Token (proxy to lead-service
// /orgs/brands/:id/conversion-token[/rotate]). Per-brand publishable token +
// ingest URL for the website conversion snippet. Downstream owns the response
// shape — passthrough only ({ token, ingestUrl }).
// ===================================================================
const ConversionTokenResponseSchema = z.object({}).passthrough().openapi("ConversionTokenResponse");

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/conversion-token",
  tags: ["Brand"],
  summary: "Get a brand's conversion-tracking token",
  description:
    "Proxy to lead-service GET /orgs/brands/{id}/conversion-token. " +
    "Returns the brand's per-brand conversion-tracking publishable token and ingest " +
    "URL ({ token, ingestUrl }) for the website snippet that fires Signup / Meeting " +
    "Booked events. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "Conversion token + ingest URL", content: { "application/json": { schema: ConversionTokenResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/conversion-token/rotate",
  tags: ["Brand"],
  summary: "Rotate a brand's conversion-tracking token",
  description:
    "Proxy to lead-service POST /orgs/brands/{id}/conversion-token/rotate. " +
    "Rotates the brand's per-brand conversion-tracking token and returns the new " +
    "{ token, ingestUrl }. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "Rotated conversion token + ingest URL", content: { "application/json": { schema: ConversionTokenResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ===================================================================
// Brand – Share Token (proxy to brand-service
// /orgs/brands/:id/share-token[/rotate] + /internal/share-tokens/resolve).
// The credential someone OUTSIDE the org presents to open a read-only view of
// one brand. Downstream owns the response shape — passthrough only.
// ===================================================================
const BrandShareTokenResponseSchema = z.object({}).passthrough().openapi("BrandShareTokenProxyResponse");

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/share-token",
  tags: ["Brand"],
  summary: "Get a brand's public share credential",
  description:
    "Proxy to brand-service GET /orgs/brands/{id}/share-token. Returns the credential " +
    "currently letting someone outside the org open a read-only view of this brand, or " +
    "{ token: null } when the brand has never been shared. A READ: it does NOT mint one, so " +
    "opening a share menu cannot accidentally start sharing a brand. Response shape is owned " +
    "by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "Current share credential (token null when unshared)", content: { "application/json": { schema: BrandShareTokenResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/share-token",
  tags: ["Brand"],
  summary: "Start sharing a brand, returning its credential",
  description:
    "Proxy to brand-service POST /orgs/brands/{id}/share-token. Mints the credential that lets " +
    "someone outside the org open a read-only view of this brand. Idempotent: a brand already " +
    "shared gets its EXISTING token back rather than a fresh one, so pressing share twice " +
    "cannot silently invalidate a link the customer already sent. Response shape is owned by " +
    "the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "Share credential", content: { "application/json": { schema: BrandShareTokenResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/share-token/rotate",
  tags: ["Brand"],
  summary: "Rotate a brand's public share credential",
  description:
    "Proxy to brand-service POST /orgs/brands/{id}/share-token/rotate. Replaces the credential, " +
    "so the previous link stops working immediately — this is how a customer takes back a link " +
    "already in someone else's hands. Downstream 404s a brand that was never shared rather than " +
    "minting one, and that propagates verbatim. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "New share credential", content: { "application/json": { schema: BrandShareTokenResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "Brand not found, or brand is not shared (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{id}/share-token",
  tags: ["Brand"],
  summary: "Stop sharing a brand",
  description:
    "Proxy to brand-service DELETE /orgs/brands/{id}/share-token. Revokes the credential so the " +
    "public link stops resolving. Idempotent — a brand that was not shared is already in the " +
    "requested end state. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "Whether a link existed and was removed", content: { "application/json": { schema: BrandShareTokenResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/share-tokens/resolve",
  tags: ["Brand"],
  summary: "Resolve a brand share credential",
  description:
    "Proxy to brand-service POST /internal/share-tokens/resolve. Present the credential alone " +
    "and learn which brand it refers to, plus that brand's public-safe payload. Authenticated but " +
    "NOT org-scoped, uniquely among the brand routes: the caller is a trusted server-side renderer " +
    "holding a platform key that has no org context YET, and resolving the credential is precisely " +
    "how it learns which brand it is rendering, so requiring one here would make the route " +
    "unusable for its only purpose. The credential travels in the BODY, matching downstream: a " +
    "share credential in a URL lands in access logs and proxy traces. Downstream 404s unknown, " +
    "revoked and rotated-away credentials alike, and that propagates verbatim. Response shape is " +
    "owned by the downstream service.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ shareToken: z.string() }).openapi("ResolveShareTokenProxyRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "The brand the credential refers to", content: { "application/json": { schema: BrandShareTokenResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Share token not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ===================================================================
// Brand – ICP Suggest
// Transparent proxies to brand-service /orgs/brands/:id/{icp/suggest,user-fields}.
// Downstream owns body + response shapes — passthrough only. No gateway
// re-validation, so brand-service's 4xx errors propagate verbatim.
// ===================================================================
const IcpSuggestRequestSchema = z.object({}).passthrough().openapi("IcpSuggestRequest");
const IcpSuggestResponseSchema = z.object({}).passthrough().openapi("IcpSuggestResponse");
const BrandUserFieldsResponseSchema = z.object({}).passthrough().openapi("BrandUserFieldsResponse");
const BrandUserFieldsRequestSchema = z.object({}).passthrough().openapi("BrandUserFieldsRequest");

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/icp/suggest",
  tags: ["Brand"],
  summary: "Suggest one natural-language ICP for a brand",
  description:
    "Proxy to brand-service POST /orgs/brands/{id}/icp/suggest. " +
    "Returns one short, plain-language ICP line ({ icp }). Optional body " +
    "{ existingIcps?: string[] } makes it return a distinct, complementary ICP. " +
    "Body + response shapes are owned by the downstream service — passthrough only.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: IcpSuggestRequestSchema } } },
  },
  responses: {
    200: { description: "ICP suggestion", content: { "application/json": { schema: IcpSuggestResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    402: { description: "Insufficient credits (forwarded verbatim)", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    422: { description: "Empty brand profile (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/user-fields",
  tags: ["Brand"],
  summary: "Get a brand's confirmed user-facing fields",
  description:
    "Proxy to brand-service GET /orgs/brands/{id}/user-fields. " +
    "Returns { fields: { <key>: { value, provenance } } } for the 7 user-facing keys " +
    "(confirmed value wins with provenance `confirmed`, else the most-recent non-expired " +
    "auto-extract prefill with provenance `suggested`). Response shape is owned by the " +
    "downstream service — passthrough only. Any query string is forwarded verbatim.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "User-facing fields with provenance", content: { "application/json": { schema: BrandUserFieldsResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/user-fields",
  tags: ["Brand"],
  summary: "Confirm (upsert) a brand's user-facing fields",
  description:
    "Proxy to brand-service PUT /orgs/brands/{id}/user-fields. Body { fields: { <key>: value } } " +
    "upserts confirmed (durable) values; returns the updated view in the same shape as GET. " +
    "Body + response shapes are owned by the downstream service; its 4xx (incl. 400 on an " +
    "unknown key) propagate verbatim — passthrough only.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: BrandUserFieldsRequestSchema } } },
  },
  responses: {
    200: { description: "Updated user-facing fields with provenance", content: { "application/json": { schema: BrandUserFieldsResponseSchema } } },
    400: { description: "Validation error / unknown key (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/transfer",
  tags: ["Brand"],
  summary: "Transfer a brand to another org",
  description:
    "Transfer a brand and all its associated solo-brand data to a different organization. " +
    "The requesting user must be a member of both the source and target orgs. " +
    "Brand-service orchestrates the transfer across all services. " +
    "Co-branding rows (multiple brand IDs) are not transferred.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            targetOrgId: z.string().describe("Clerk org ID (e.g. org_xxx) of the target organization — resolved to internal UUID server-side"),
          }).openapi("TransferBrandRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Transfer completed",
      content: {
        "application/json": {
          schema: z.object({
            brandId: z.string().describe("Brand ID that was transferred"),
            sourceOrgId: z.string().describe("Original organization ID"),
            targetOrgId: z.string().describe("New organization ID"),
            serviceResults: z.record(
              z.string(),
              z.union([
                z.object({ updatedTables: z.record(z.string(), z.number()) }),
                z.object({ error: z.string() }),
              ]),
            ).describe("Per-service transfer results: updated table counts or error"),
          }).openapi("TransferBrandResponse"),
        },
      },
    },
    400: { description: "Missing targetOrgId", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "User is not a member of the target org", content: errorContent },
    404: { description: "Brand not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/transfers",
  tags: ["Brand"],
  summary: "Get transfer history for a brand",
  description: "Returns the audit log of all transfers for a given brand, including per-service results.",
  security: authed,
  request: {
    params: BrandIdParam,
  },
  responses: {
    200: {
      description: "Transfer history",
      content: {
        "application/json": {
          schema: z.object({
            transfers: z.array(
              z.object({
                id: z.string().uuid(),
                brandId: z.string().uuid(),
                sourceOrgId: z.string().uuid(),
                targetOrgId: z.string().uuid(),
                initiatedByUserId: z.string().uuid(),
                serviceResults: z.record(
                  z.string(),
                  z.union([
                    z.object({ updatedTables: z.array(z.object({ tableName: z.string(), count: z.number() })) }),
                    z.object({ error: z.string() }),
                    z.object({ skipped: z.literal(true) }),
                  ]),
                ),
                createdAt: z.string(),
              }),
            ),
          }).openapi("BrandTransferHistoryResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

const brandTransferHistorySchema = z.object({
  transfers: z.array(
    z.object({
      id: z.string().uuid(),
      brandId: z.string().uuid(),
      sourceOrgId: z.string().uuid(),
      targetOrgId: z.string().uuid(),
      initiatedByUserId: z.string().uuid(),
      serviceResults: z.record(
        z.string(),
        z.union([
          z.object({ updatedTables: z.array(z.object({ tableName: z.string(), count: z.number() })) }),
          z.object({ error: z.string() }),
          z.object({ skipped: z.literal(true) }),
        ]),
      ),
      createdAt: z.string(),
    }),
  ),
});

registry.registerPath({
  method: "get",
  path: "/v1/brand-transfers/outgoing",
  tags: ["Brand"],
  summary: "Get outgoing brand transfers for the current org",
  description: "Returns transfers where the current org is the source (brand was transferred out).",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().uuid().optional().describe("Filter by brand ID"),
    }),
  },
  responses: {
    200: {
      description: "Outgoing transfer history",
      content: {
        "application/json": {
          schema: brandTransferHistorySchema.openapi("OutgoingBrandTransferResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brand-transfers/incoming",
  tags: ["Brand"],
  summary: "Get incoming brand transfers for the current org",
  description: "Returns transfers where the current org is the target (brand was transferred in).",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().uuid().optional().describe("Filter by brand ID"),
    }),
  },
  responses: {
    200: {
      description: "Incoming transfer history",
      content: {
        "application/json": {
          schema: brandTransferHistorySchema.openapi("IncomingBrandTransferResponse"),
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
    "Get broadcast delivery statistics from email-gateway. Filter by brandId, campaignId, workflowSlugs, featureSlugs, workflowDynastySlug, or featureDynastySlug.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().optional().describe("Filter by brand ID"),
      campaignId: z.string().optional().describe("Filter by campaign ID"),
      workflowSlugs: z.string().optional().describe("Filter by workflow slugs (comma-separated, e.g. 'slug-v1,slug-v2')"),
      featureSlugs: z.string().optional().describe("Filter by feature slugs (comma-separated, e.g. 'feature-v1,feature-v2')"),
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
              recipientStats: RecipientStatsSchema,
              emailStats: EmailStatsSchema,
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
    "Get cost statistics grouped by a dimension. Supports groupBy=brandId, costName, campaignId, serviceName, workflowDynastySlug. Filter by brandId, campaignId, taskName, workflowSlug, featureSlug, featureSlugs (comma-separated, matches any), workflowDynastySlug, startedAfter, startedBefore.",
  security: authed,
  request: {
    query: z.object({
      groupBy: z.string().describe("Grouping dimension: brandId, costName, campaignId, serviceName, workflowDynastySlug"),
      brandId: z.string().optional().describe("Filter by brand ID"),
      campaignId: z.string().optional().describe("Filter by campaign ID"),
      taskName: z.string().optional().describe("Filter by task name (e.g. lead-serve)"),
      workflowSlug: z.string().optional().describe("Filter by exact workflow slug"),
      featureSlug: z.string().optional().describe("Filter by exact feature slug"),
      featureSlugs: z.string().optional().describe("Comma-separated feature slugs; matches runs whose feature slug is any of them (e.g. a channel slug plus its sourcing origin slugs)"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
      startedAfter: z.string().optional().describe("Filter by run startedAt >= this ISO date-time"),
      startedBefore: z.string().optional().describe("Filter by run startedAt < this ISO date-time"),
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
  path: "/v1/runs/stats/run-outcomes",
  tags: ["Runs"],
  summary: "How the org's runs ended and how long they took, per group",
  description:
    "Proxies runs-service GET /v1/stats/run-outcomes for the authenticated org. Per group (default one per campaignId): runCount, completedCount, failedCount, runningCount, successRate, medianDurationMs (null when no completed run), minStartedAt, maxStartedAt. The query string is forwarded verbatim; the parameters below are the ones runs-service documents today, not a whitelist. The org always comes from the caller's authentication, never from the query.",
  security: authed,
  request: {
    query: z
      .object({
        groupBy: z.string().optional().describe("Comma-separated: campaignId, workflowSlug, featureSlug, serviceName, taskName. Default campaignId."),
        scope: z.string().optional().describe("entry (default): runs the agent started. all: every matching run."),
        brandId: z.string().optional().describe("Runs where this brand is in brandIds"),
        campaignId: z.string().optional().describe("Filter by campaign ID"),
        campaignIds: z.string().optional().describe("Comma-separated campaign ids (a campaign family), at most 500"),
        workflowSlug: z.string().optional(),
        featureSlug: z.string().optional(),
        serviceName: z.string().optional(),
        taskName: z.string().optional(),
        startedAfter: z.string().optional().describe("Inclusive lower bound on run startedAt (ISO date-time)"),
        startedBefore: z.string().optional().describe("Inclusive upper bound on run startedAt (ISO date-time)"),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "Run outcome groups, forwarded unchanged from runs-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("RunOutcomesResponse"),
        },
      },
    },
    400: { description: "Invalid groupBy, scope, campaignIds or date (runs-service error forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/runs/stats/costs/timeseries",
  tags: ["Runs"],
  summary: "The org's run counts and spend per day, week or month",
  description:
    "Proxies runs-service GET /v1/stats/costs/timeseries for the authenticated org: run counts and spend per dated bucket in the caller's timezone, optionally per campaign. One call replaces one GET /v1/runs/stats/costs per day. The query string is forwarded verbatim; the parameters below are the ones runs-service documents today, not a whitelist. The org always comes from the caller's authentication, never from the query.",
  security: authed,
  request: {
    query: z
      .object({
        interval: z.string().optional().describe("day (default), week or month"),
        tz: z.string().optional().describe("IANA timezone the buckets are cut in. Default UTC."),
        groupBy: z.string().optional().describe("campaignId: one series per campaign inside each bucket"),
        brandId: z.string().optional(),
        campaignId: z.string().optional(),
        campaignIds: z.string().optional().describe("Comma-separated campaign ids"),
        featureSlug: z.string().optional(),
        featureSlugs: z.string().optional().describe("Comma-separated feature slugs"),
        workflowSlug: z.string().optional(),
        serviceName: z.string().optional(),
        taskName: z.string().optional(),
        startedAfter: z.string().optional().describe("Lower bound on run startedAt (ISO date-time)"),
        startedBefore: z.string().optional().describe("Upper bound on run startedAt (ISO date-time)"),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "Dated buckets, forwarded unchanged from runs-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("RunsCostTimeseriesResponse"),
        },
      },
    },
    400: { description: "Invalid interval, tz, groupBy or date (runs-service error forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/runs/{id}",
  tags: ["Runs"],
  summary: "One run by id, with its cost roll-up and its descendant runs",
  description:
    "Proxies runs-service GET /v1/runs/{id} for the authenticated org and forwards its body unchanged: the run, its own costs, the rolled-up cost totals over its whole tree, and its descendant runs. A run belonging to another organization is answered 404 \"Run not found\", identical to an unknown id.",
  security: authed,
  request: {
    params: z.object({ id: z.string().describe("Run id") }),
  },
  responses: {
    200: {
      description: "The run, forwarded unchanged from runs-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("RunDetailResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No run with this id in the caller's organization", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// RUN EVENTS
// ===================================================================

const RunEventSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    service: z.string(),
    event: z.string(),
    detail: z.string().nullable(),
    level: z.enum(["info", "warn", "error"]),
    data: z.unknown().nullable().optional(),
    orgId: z.string().uuid().nullable(),
    userId: z.string().uuid().nullable(),
    brandIds: z.string().nullable(),
    campaignId: z.string().uuid().nullable(),
    workflowSlug: z.string().nullable(),
    featureSlug: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("RunEvent");

registry.registerPath({
  method: "get",
  path: "/v1/events",
  tags: ["Runs"],
  summary: "List run events for the authenticated org",
  description:
    "Transparent proxy to runs-service GET /v1/events. orgId is injected from the auth context — never trusted from client query. " +
    "Use this endpoint to render per-campaign log views in the dashboard. Events are ordered by createdAt DESC.",
  security: authed,
  request: {
    query: z.object({
      campaignId: z.string().uuid().optional().describe("Filter to a single campaign"),
      brandId: z.string().optional().describe("Filter by brand ID (single UUID)"),
      level: z.enum(["info", "warn", "error"]).optional().describe("Filter by event severity"),
      service: z.string().optional().describe("Filter by emitting service name"),
      workflowSlug: z.string().optional().describe("Filter by workflow slug"),
      featureSlug: z.string().optional().describe("Filter by feature slug"),
      event: z.string().optional().describe("Filter by event slug(s) — comma-separated, e.g. send-start,generate-start"),
      limit: z.string().optional().describe("Page size — forwarded as-is to runs-service"),
      offset: z.string().optional().describe("Page offset — forwarded as-is to runs-service"),
    }).openapi("ListEventsQuery"),
  },
  responses: {
    200: {
      description: "List of run events for the org, newest first",
      content: {
        "application/json": {
          schema: z.object({
            events: z.array(RunEventSchema),
          }).openapi("ListEventsResponse"),
        },
      },
    },
    400: { description: "Organization context required", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/scraping/scrape/{id}",
  tags: ["Scraping"],
  summary: "Get scrape result by ID",
  description: "Transparent proxy to scraping-service GET /scrape/:id",
  security: authed,
  request: {
    params: z.object({ id: z.string().describe("Scrape ID") }),
  },
  responses: {
    200: {
      description: "Scrape result",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ScrapeResultResponse"),
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
      featureSlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature slug"),
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

export const CreateWorkflowRequestSchema = z
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
  })
  .openapi("CreateWorkflowRequest");

export const UpgradeWorkflowRequestSchema = z
  .object({
    workflowDynastySlug: z
      .string()
      .min(1)
      .describe("Stable dynasty slug (constant across all versions of the dynasty). The route resolves it to the currently-active row, so callers do not need to track which version is active after prior upgrades."),
    description: z
      .string()
      .min(10)
      .optional()
      .describe(
        "Natural language description of the upgrade. Required when `dag` is not provided (LLM regenerates the DAG from this description). Optional when `dag` is provided; if present, replaces the stored description on the resulting row."
      ),
    dag: z
      .object({
        nodes: z.array(z.unknown()).min(1).describe("DAG nodes — at least one required. Full shape owned by workflow-service."),
        edges: z.array(z.unknown()).describe("DAG edges. Full shape owned by workflow-service."),
      })
      .passthrough()
      .optional()
      .describe(
        "Optional client-supplied DAG. When provided, workflow-service skips the LLM and applies the same in-place / new-version branching as the LLM path. Full node/edge shape owned by workflow-service (see its OpenAPI). Use for surgical fixes (e.g. patch a single script node) without re-running generation."
      ),
    hints: z
      .object({})
      .passthrough()
      .optional()
      .describe(
        "Optional hints to guide the upgrade. Shape owned by workflow-service (see its OpenAPI for known keys). Ignored when `dag` is provided."
      ),
  })
  .refine((data) => data.dag !== undefined || data.description !== undefined, {
    message: "Either 'dag' or 'description' must be provided",
  })
  .openapi("UpgradeWorkflowRequest");

const generateWorkflowResponse = z
  .object({
    workflow: z.object({
      id: z.string().describe("Workflow ID"),
      name: z.string().describe("Auto-generated workflow slug"),
      featureSlug: z.string().describe("Feature slug this workflow belongs to"),
      signature: z.string().describe("SHA-256 hash of the canonical DAG"),
      workflowDynastySignatureName: z.string().describe("Human-readable name for this DAG variant within the dynasty"),
      action: z.enum(["created", "updated"]).describe("Whether the workflow was created or updated"),
      humanId: z.string().nullable().describe("Human ID if styled after an expert"),
    }),
    dag: z.object({
      nodes: z.array(z.any()).describe("DAG nodes"),
      edges: z.array(z.any()).describe("DAG edges"),
    }),
    generatedDescription: z.string().describe("AI-generated description of the workflow"),
  });

registry.registerPath({
  method: "post",
  path: "/v1/workflows/create",
  tags: ["Workflows"],
  summary: "Create a workflow dynasty",
  description:
    "Uses AI to generate a new workflow DAG from a natural language description. The generated workflow is validated and deployed as a new dynasty.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: CreateWorkflowRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Created and deployed workflow",
      content: {
        "application/json": {
          schema: generateWorkflowResponse.openapi("CreateWorkflowResponse"),
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

registry.registerPath({
  method: "post",
  path: "/v1/workflows/upgrade",
  tags: ["Workflows"],
  summary: "Upgrade a workflow within its dynasty",
  description:
    "Uses AI to upgrade an existing workflow identified by workflowSlug. The upgrade is validated and deployed as a new revision within the same dynasty.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: UpgradeWorkflowRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Upgraded workflow",
      content: {
        "application/json": {
          schema: generateWorkflowResponse.openapi("UpgradeWorkflowResponse"),
        },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Workflow slug not found", content: errorContent },
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
          { id: "fetch-lead", type: "http.call", config: { service: "lead", method: "POST", path: "/orgs/buffer/next" }, inputMapping: { "body.campaignId": "$ref:flow_input.campaignId" } },
          { id: "send-email", type: "http.call", config: { service: "email-gateway", method: "POST", path: "/send" }, inputMapping: { "body.to": "$ref:fetch-lead.output.lead.email" }, retries: 0 },
        ],
        edges: [{ from: "fetch-lead", to: "send-email" }],
      },
    },
  });

export const WorkflowDynastyStatusRequestSchema = z
  .object({
    status: z.enum(["active", "deprecated"]).describe("New lifecycle status for the workflow dynasty."),
  })
  .openapi("WorkflowDynastyStatusRequest", { example: { status: "deprecated" } });

const workflowPromptEditDescription =
  "STAFF ONLY: requires the platform API key AND an x-email in the STAFF_EMAILS allowlist, on top of " +
  "the usual org + user identity — an `upgrade` changes what every campaign on the dynasty sends, for " +
  "every client. Body `{ action: \"upgrade\" | \"fork\", prompt }` is forwarded verbatim to workflow-service " +
  "and the response (201 + the new `workflow`) and every refusal (400 / 404 / 409 / 422 / 502) come back " +
  "with the producer's status and body byte-for-byte. A 422 means the edited prompt adds or removes a " +
  "{{variable}}: its readable `error` sentence and droppedVariables / addedVariables / requiredVariables " +
  "reach the caller intact.";

const workflowPromptEditResponses = {
  201: {
    description: "Upgraded or forked — pass-through from workflow-service",
    content: { "application/json": { schema: z.object({}).passthrough().openapi("WorkflowPromptEditResponse") } },
  },
  400: { description: "Invalid body, prompt unchanged or invalid DAG (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Not staff", content: errorContent },
  404: { description: "Workflow / dynasty not found (forwarded verbatim)", content: errorContent },
  409: { description: "Upgrade on a superseded version, no fixed template, or duplicate (forwarded verbatim)", content: errorContent },
  422: { description: "Edited prompt breaks the {{variable}} contract (forwarded verbatim)", content: errorContent },
  502: { description: "Upstream failure (forwarded verbatim)", content: errorContent },
};

const WorkflowPromptEditRequestSchema = z
  .object({
    action: z.string().describe("\"upgrade\" (new version of the same dynasty) or \"fork\" (new dynasty). Validated by workflow-service."),
    prompt: z.string().describe("The full edited prompt template text."),
  })
  .passthrough()
  .openapi("WorkflowPromptEditRequest");

registry.registerPath({
  method: "post",
  path: "/v1/workflows/{id}/prompt-edit",
  tags: ["Workflows"],
  summary: "Upgrade or fork a workflow version with an edited prompt (staff only)",
  description:
    "Transparent proxy to workflow-service POST /workflows/{id}/prompt-edit. `fork` branches from exactly " +
    "this version; `upgrade` requires it to be the dynasty's active version (409 otherwise). " +
    workflowPromptEditDescription,
  security: platformAuth,
  request: {
    params: z.object({ id: z.string().uuid().describe("Workflow version id") }),
    body: { content: { "application/json": { schema: WorkflowPromptEditRequestSchema } } },
  },
  responses: workflowPromptEditResponses,
});

registry.registerPath({
  method: "post",
  path: "/v1/workflows/dynasty/{workflowDynastySlug}/prompt-edit",
  tags: ["Workflows"],
  summary: "Upgrade or fork a workflow dynasty with an edited prompt (staff only)",
  description:
    "Transparent proxy to workflow-service POST /workflows/dynasty/{workflowDynastySlug}/prompt-edit. " +
    "The dynasty slug resolves to its currently-active version, which both actions build on. " +
    workflowPromptEditDescription,
  security: platformAuth,
  request: {
    params: z.object({ workflowDynastySlug: z.string().describe("Stable dynasty slug") }),
    body: { content: { "application/json": { schema: WorkflowPromptEditRequestSchema } } },
  },
  responses: workflowPromptEditResponses,
});

registry.registerPath({
  method: "put",
  path: "/v1/workflows/dynasty/{workflowDynastySlug}/status",
  tags: ["Workflows"],
  summary: "Set workflow dynasty status",
  description:
    "Activate or deprecate a workflow dynasty by its stable dynasty slug. Proxied verbatim to workflow-service. " +
    "Deprecating hides the dynasty from selection; reactivating restores it.",
  security: authed,
  request: {
    params: z.object({
      workflowDynastySlug: z.string().openapi({ example: "sales-email-cold-outreach-sienna" }).describe("Stable dynasty slug"),
    }),
    body: {
      content: {
        "application/json": { schema: WorkflowDynastyStatusRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated dynasty status — pass-through from workflow-service",
      content: {
        "application/json": { schema: z.object({}).passthrough().openapi("WorkflowDynastyStatusResponse") },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Workflow dynasty not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/workflows/dynasties",
  tags: ["Workflows"],
  summary: "List workflow dynasties with their versioned slugs",
  description:
    "Every workflow dynasty with the versioned workflow slugs that belong to it, DEPRECATED versions included. " +
    "This is the only read here that can name a superseded version: every other workflow read filters to active " +
    "versions, so a campaign pinned to an old versioned slug can be resolved to its dynasty only through this one. " +
    "Transparent proxy to workflow-service GET /workflows/dynasties — the caller's query string is forwarded " +
    "verbatim, so any filter workflow-service accepts is reachable without a gateway release. The parameters below " +
    "are the ones it documents today, not a whitelist. Response is producer-owned.",
  security: authed,
  request: {
    query: z
      .object({
        featureSlug: z
          .string()
          .optional()
          .describe(
            "Restrict to the dynasties of this feature. Omitted, the listing is fleet-wide — the whole internal " +
            "codename catalogue, which a customer-facing consumer should never receive. Pass it.",
          ),
        workflowSlug: z
          .string()
          .optional()
          .describe(
            "Restrict to the single dynasty this versioned workflow slug belongs to, including when the slug names " +
            "a superseded or deprecated version. An unknown slug answers an empty list, not a 404.",
          ),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "Dynasties with their versioned workflow slugs — pass-through from workflow-service",
      content: {
        "application/json": { schema: z.object({}).passthrough().openapi("WorkflowDynastiesResponse") },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

export const WorkflowStatusRequestSchema = z
  .object({
    status: z.string().min(1).describe(
      "New per-version lifecycle status, e.g. 'active' or 'deprecated'. The vocabulary is " +
      "workflow-service's; the gateway forwards the body verbatim and does not validate it.",
    ),
  })
  .passthrough()
  .openapi("WorkflowStatusRequest", { example: { status: "deprecated" } });

registry.registerPath({
  method: "put",
  path: "/v1/workflows/{id}/status",
  tags: ["Workflows"],
  summary: "Set one workflow version's status",
  description:
    "Retire (or un-retire) a SINGLE workflow version by id, as opposed to the whole lineage " +
    "(`PUT /v1/workflows/dynasty/{workflowDynastySlug}/status`). Proxied verbatim to workflow-service. " +
    "Deprecating stops that version running and stops it being offered to the pickers; the dynasty's " +
    "other versions are untouched. Re-activating is refused with 409 when another version of the same " +
    "dynasty is already active — the upstream body carries `existingWorkflowId` / `existingWorkflowSlug` " +
    "and reaches the caller field-for-field.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }).describe("Workflow version id"),
    }),
    body: {
      content: {
        "application/json": { schema: WorkflowStatusRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated workflow — pass-through from workflow-service",
      content: {
        "application/json": { schema: z.object({}).passthrough().openapi("WorkflowStatusResponse") },
      },
    },
    400: { description: "Invalid request", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: { description: "Another version of the dynasty is already active", content: errorContent },
    404: { description: "Workflow not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
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
      featureSlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature slug"),
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

// Passthrough per CLAUDE.md rule #8 — content-generation owns the prompt response shape
// (including variables: Array<{name, description}>); api-service forwards bytes via res.json().
// Mirrors PlatformPromptResponseSchema (DIS-62).
export const PromptResponseSchema = z.object({}).passthrough().openapi("PromptResponse");

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
    // Mirrors content-generation PUT /prompts contract (DIS-52): variables are objects, not strings.
    // Caller decides the JSON shape per variable name at render time.
    variables: z
      .array(
        z.object({
          name: z.string().describe("Variable name as referenced in the prompt body via {{name}}."),
          description: z
            .string()
            .describe(
              "Free-form description of what the caller should put for this variable. Caller decides the JSON shape — string, array, object, whatever fits the template."
            ),
        })
      )
      .describe(
        "Inputs the template expects. Each entry is { name, description }; the caller decides the JSON shape per name."
      ),
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

// ── Session history (read) ──────────────────────────────────────────────────

const SessionIdParam = z.object({
  sessionId: z.string().describe("UUID of the chat session to read"),
});

// Passthrough: chat-service owns the response shape (session metadata + ordered
// conversation turns). api-service forwards bytes; do not re-declare fields.
export const SessionHistoryResponseSchema = z
  .object({})
  .passthrough()
  .openapi("SessionHistoryResponse");

const LatestSessionQuery = z
  .object({
    configKey: z
      .string()
      .describe(
        "Chat config key (e.g. the key the chat panel sends as `configKey` on POST /v1/chat). " +
          "Required: chat-service answers 400 without it.",
      ),
  })
  .passthrough();

registry.registerPath({
  method: "get",
  path: "/v1/chat/sessions/latest",
  tags: ["Chat"],
  summary: "Get the latest chat session for a config key",
  description:
    "Read the caller's most recently active chat session for one chat config key, with its " +
    "full stored history (same body as GET /v1/chat/sessions/{sessionId}). Scoped to the " +
    "authenticated org AND user, so a chat panel shows the same conversation on any device. " +
    "Read-only. 404 means this user has no session for that key in this org yet (a normal " +
    "first visit), not a failure. The query string is forwarded verbatim; `configKey` is the " +
    "parameter documented today, not a whitelist.",
  security: authed,
  request: { query: LatestSessionQuery },
  responses: {
    200: {
      description: "Session metadata and the full ordered conversation.",
      content: {
        "application/json": { schema: SessionHistoryResponseSchema },
      },
    },
    400: { description: "configKey missing", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: {
      description: "No session for this config key for this user in this org",
      content: errorContent,
    },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/chat/sessions/{sessionId}",
  tags: ["Chat"],
  summary: "Get chat session history",
  description:
    "Read a chat session's stored conversation history by session ID. Lets a client " +
    '(e.g. the dashboard "Edit with AI" panel) restore the visible chat after a page ' +
    "refresh. Read-only — no run tracking, no cost, no writes. Org-scoped: a session " +
    "that does not exist or belongs to another org returns 404 (existence not leaked " +
    "across orgs).",
  security: authed,
  request: { params: SessionIdParam },
  responses: {
    200: {
      description: "Session metadata and the full ordered conversation.",
      content: {
        "application/json": { schema: SessionHistoryResponseSchema },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: {
      description: "Session not found (invalid, expired, or belonging to another org)",
      content: errorContent,
    },
    500: { description: "Internal error", content: errorContent },
  },
});

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
    variables: z
      .array(
        z.object({
          name: z.string().describe("Variable name as referenced in the prompt body via {{name}}."),
          description: z
            .string()
            .describe(
              "Free-form description of what the caller should put for this variable. Caller decides the JSON shape — string, array, object, whatever fits the template."
            ),
        })
      )
      .describe(
        "Inputs the template expects. Each entry is { name, description }; the caller decides the JSON shape per name."
      ),
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
          schema: z.object({}).passthrough().openapi("PlatformPromptResponse"),
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
    thinkingLevel: z
      .enum(["minimal", "low", "medium", "high"])
      .optional()
      .describe("Per-config thinking/reasoning level applied by chat-service (e.g. raise Gemini chat thinking to medium)"),
  })
  // Passthrough: this is a transparent gateway proxy to chat-service PUT /platform-config.
  // Unknown keys (provider, model, and any future config field) MUST survive into parsed.data
  // and forward verbatim — the gateway does not own the downstream config shape (CLAUDE.md #8).
  // The 3 required-field guards above still 400 when missing.
  .passthrough()
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

// billing-service stores cents as numeric(16,10) and returns full-precision
// decimal strings (e.g. "100.4200000000"). Inbound endpoints accept either
// integer or decimal string. See billing-service PR #83.
const DECIMAL_CENTS_REGEX = /^\d+(\.\d+)?$/;
const decimalCentsString = z.string().regex(DECIMAL_CENTS_REGEX);
const inboundCents = z.union([z.number(), decimalCentsString]);

export const ConfigureAutoTopupRequestSchema = z
  .object({
    topup_amount_cents: inboundCents.describe(
      "Auto-topup amount in cents (integer or decimal string)",
    ),
    topup_threshold_cents: inboundCents.describe(
      "Balance threshold in cents that triggers auto-topup (integer or decimal string)",
    ),
  })
  .openapi("ConfigureAutoTopupRequest");

export const CreateCheckoutSessionRequestSchema = z
  .object({
    ui_mode: z.literal("embedded").optional().describe(
      "Set to 'embedded' for Stripe Embedded Checkout (in-app modal). Returns an inline client_secret instead of a redirect URL, so success_url/cancel_url do not apply. Always payment-only (requires topup_amount_cents).",
    ),
    success_url: z.string().url().optional().describe(
      "URL to redirect after successful payment. Required for hosted checkout; omit for embedded (ui_mode='embedded').",
    ),
    cancel_url: z.string().url().optional().describe(
      "URL to redirect on cancellation. Required for hosted checkout; omit for embedded (ui_mode='embedded').",
    ),
    mode: z.enum(["payment", "setup"]).optional().describe(
      "Stripe checkout mode. Setup mode stores a payment method and does not require a top-up amount.",
    ),
    topup_amount_cents: inboundCents.optional().describe(
      "Amount to top up in cents (integer or decimal string)",
    ),
  })
  .openapi("CreateCheckoutSessionRequest");

export const ChargeSavedPaymentMethodRequestSchema = z
  .object({
    amountCents: inboundCents.describe(
      "Amount to charge in cents. Must be at least Stripe's minimum charge amount — billing-service answers 400 below it. No cap or floor is re-stated here.",
    ),
    idempotencyKey: z
      .string()
      .describe(
        "Caller-supplied key that makes a retry of the SAME charge safe. Owned by billing-service.",
      ),
  })
  .passthrough()
  .openapi("ChargeSavedPaymentMethodRequest");

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
      description: "Billing account data — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("BillingAccountResponse"),
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
    "Quick check of available funds and depletion status — pass-through from billing-service.",
  security: authed,
  responses: {
    200: {
      description: "Balance info — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("BalanceResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

export const CardSetupRequestSchema = z
  .object({
    return_url: z
      .string()
      .url()
      .optional()
      .describe("Where the acquirer sends the customer back once the card is saved"),
    currency: z.string().optional().describe("ISO currency the acquirer should set the order up in"),
  })
  .passthrough()
  .openapi("CardSetupRequest");

registry.registerPath({
  method: "post",
  path: "/v1/billing/accounts/card_setup",
  tags: ["Billing"],
  summary: "What the browser needs to render this org's card form",
  description:
    "Asks billing-service how THIS org's acquirer saves a card and passes the descriptor through untouched: " +
    "`hosted_redirect` (send the customer to `url`) or `embedded_widget` (load `script_url`, initialise with the " +
    "per-order PUBLIC `token`, mount the card field). No merchant credential is included — the card is typed in an " +
    "iframe the acquirer hosts and never touches the page or this gateway. Nobody is charged for adding a card. " +
    "Request body is forwarded verbatim; the fields documented here are the ones billing accepts today, not a whitelist.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: CardSetupRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Card-setup descriptor — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("CardSetupResponse"),
        },
      },
    },
    400: { description: "Invalid request — propagated verbatim", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Billing account not found", content: errorContent },
    502: { description: "Card setup could not be described", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/saved_payment_method",
  tags: ["Billing"],
  summary: "Does this org have a saved, chargeable card?",
  description:
    "Read live from whichever acquirer holds the org's cards. THREE answers, kept apart on purpose: " +
    "200 `{saved:true, method}` there is one; 200 `{saved:false, reason}` the acquirer answered and there is none; " +
    "502 we could not ask at all. A caller that collapses the last two would either tell a customer to re-enter a " +
    "card we already hold, or arm a recurring charge off a timeout — so the gateway forwards the downstream status " +
    "and body as they are.",
  security: authed,
  responses: {
    200: {
      description: "The acquirer answered — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("SavedPaymentMethodResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Billing account not found", content: errorContent },
    502: { description: "Could not ask the acquirer — NOT the same as 'no card saved'", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/billing/accounts/saved_payment_method",
  tags: ["Billing"],
  summary: "Stop holding this org's card",
  description:
    "Removes the calling org's saved card. billing-service collects what is owed FIRST, on the card that is about " +
    "to go, then removes it whatever that collection did — the gateway adds no ordering, no pre-check and no retry. " +
    "Refused for nobody: no balance, no debt state and no failed charge blocks it, and an org with no card is not " +
    "an error. Nothing is forgiven — a debt that could not be collected stays owed. The org is the authenticated " +
    "one; a caller cannot name someone else's. Response is billing-service's, forwarded field-for-field.",
  security: authed,
  responses: {
    200: {
      description: "The card is gone — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("RemoveSavedPaymentMethodResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Billing account not found", content: errorContent },
    502: {
      description: "The removal could not be performed — retry; it is safe to repeat",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/billing/accounts/auto_topup",
  tags: ["Billing"],
  summary: "Configure auto-topup",
  description: "Enable or update auto-topup settings for the billing account. Requires a payment method on file.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: ConfigureAutoTopupRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Auto-topup configured — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ConfigureAutoTopupResponse"),
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
  path: "/v1/billing/accounts/auto_topup",
  tags: ["Billing"],
  summary: "Disable auto-topup",
  description: "Disable auto-topup for the billing account",
  security: authed,
  responses: {
    200: {
      description: "Auto-topup disabled — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("DisableAutoTopupResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// Promo codes (staff-only) — re-price grant amounts (e.g. welcome credit gift).
// Both routes gated platform/admin (X-API-Key); transparent proxy to
// billing-service /internal/promo-codes/:code. Responses passthrough (CLAUDE.md #8).
// ---------------------------------------------------------------------------
const PromoCodeParam = z.object({
  code: z.string().openapi({ description: "Promo code", example: "welcome" }),
});

registry.registerPath({
  method: "get",
  path: "/v1/promo-codes/{code}",
  tags: ["Promo codes"],
  summary: "Get a promo code's grant amount (staff only)",
  description:
    "Read the credit-grant amount for a promo code (e.g. the new-signup welcome gift). " +
    "Staff-only (platform API key). Pass-through from billing-service.",
  security: platformAuth,
  request: { params: PromoCodeParam },
  responses: {
    200: {
      description: "Promo code — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("PromoCodeResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Promo code not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/promo-codes/{code}",
  tags: ["Promo codes"],
  summary: "Set a promo code's grant amount (staff only)",
  description:
    "Update the credit-grant amount for a promo code. Staff-only (platform API key). " +
    "Body forwarded as-is to billing-service, which owns value validation.",
  security: platformAuth,
  request: {
    params: PromoCodeParam,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              amountCents: z
                .number()
                .openapi({ description: "New grant amount in cents (non-negative integer)", example: 1000 }),
            })
            .passthrough()
            .openapi("PromoCodeUpdateRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated promo code — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("PromoCodeUpdateResponse"),
        },
      },
    },
    400: { description: "Invalid amount", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Promo code not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// Credit grants (staff-only) — grant arbitrary free credit + read grants ledger.
// Gated by requireStaff (platform API key + x-email in the STAFF_EMAILS allowlist);
// a customer can never reach these. Transparent proxy to billing-service. Responses
// passthrough (CLAUDE.md #8); body forwarded as-is (CLAUDE.md #4).
// ---------------------------------------------------------------------------
const CreditGrantRequestSchema = z
  .object({
    amountCents: z.number().openapi({ description: "Credit amount to grant, in cents (non-negative integer)", example: 5000 }),
    note: z.string().optional().openapi({ description: "Optional human note recorded with the grant", example: "Goodwill credit" }),
    idempotencyKey: z.string().openapi({ description: "Idempotency key to dedupe retried grants", example: "grant-2026-06-23-abc" }),
  })
  .passthrough()
  .openapi("CreditGrantRequest");

registry.registerPath({
  method: "post",
  path: "/v1/billing/credits/grant",
  tags: ["Billing"],
  summary: "Grant free credit to an org (staff only)",
  description:
    "Grant an arbitrary free-credit amount to the org in context. Staff-only: requires the " +
    "platform API key AND an x-email in the STAFF_EMAILS allowlist. Transparent proxy to " +
    "billing-service POST /v1/credits/grant; body { amountCents, note?, idempotencyKey } " +
    "forwarded as-is, response owned by the downstream service.",
  security: platformAuth,
  request: { body: { content: { "application/json": { schema: CreditGrantRequestSchema } } } },
  responses: {
    200: { description: "Grant recorded — pass-through from billing-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CreditGrantResponse") } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/credits/grants",
  tags: ["Billing"],
  summary: "Get the org's own credit-grants ledger",
  description:
    "List the credit grants (welcome credit, first-deposit match, staff bonuses, referral " +
    "credits) for the org in context — powers the customer dashboard 'Gifts received' section. " +
    "Normal org auth (same tier as GET /v1/billing/accounts); billing-service scopes the response " +
    "to the caller's x-org-id, so an org reads only its own grants. Transparent proxy to " +
    "billing-service GET /v1/credits/grants; response owned by the downstream service.",
  security: authed,
  responses: {
    200: { description: "Org grants ledger — pass-through from billing-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CreditGrantsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/free-credit-promises",
  tags: ["Billing"],
  summary: "Free credits this org is still waiting on",
  description:
    "Every outstanding free-credit promise for the org in context: the welcome remainder, " +
    "plus a promise for each converting referral. Each carries what it is worth, the level of " +
    "cumulative payments that unlocks it, how far along the org is, and — when the promise " +
    "exists because someone this org referred converted — which org that was, which the " +
    "dashboard resolves to a brand through brand-service. An outstanding promise is a promise, " +
    "not money: it is not part of credited, balance or spendable. Normal org auth (same tier as " +
    "GET /v1/billing/credits/grants); billing-service scopes the response to the caller's " +
    "x-org-id, so an org reads only its own promises and the client never names an org. " +
    "Transparent proxy to billing-service GET /v1/free-credit-promises; response owned by the " +
    "downstream service.",
  security: authed,
  responses: {
    200: { description: "Outstanding promises — pass-through from billing-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("FreeCreditPromisesResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/credits/grants/all",
  tags: ["Billing"],
  summary: "Get the platform-wide credit-grants ledger (staff only)",
  description:
    "List credit grants across ALL orgs (cross-org platform ledger). Staff-only (platform API " +
    "key + STAFF_EMAILS x-email); no org context required. Transparent proxy to billing-service " +
    "GET /internal/credits/grants; response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Platform grants ledger — pass-through from billing-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PlatformCreditGrantsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

const CreditDebitRequestSchema = z
  .object({
    amountCents: z.number().openapi({ description: "Amount to take off the org's balance, in cents (positive integer)", example: 14319 }),
    note: z.string().openapi({ description: "Why — mandatory, stored with the debit", example: "Spend on the brand under the agency org before the handover" }),
    idempotencyKey: z.string().openapi({ description: "Idempotency key: a retry with the same key debits once", example: "debit-2026-09-27-abc" }),
  })
  .passthrough()
  .openapi("CreditDebitRequest");

registry.registerPath({
  method: "post",
  path: "/v1/billing/credits/debit",
  tags: ["Billing"],
  summary: "Take credit off an org's balance, with a note (staff only)",
  description:
    "The mirror of the staff grant: removes an amount from the org in context's balance with a " +
    "mandatory note, recorded against the staff member. Never charges a card. Staff-only: requires " +
    "the platform API key AND an x-email in the STAFF_EMAILS allowlist. Transparent proxy to " +
    "billing-service POST /v1/credits/debit; body forwarded as-is, response owned by the downstream service.",
  security: platformAuth,
  request: { body: { content: { "application/json": { schema: CreditDebitRequestSchema } } } },
  responses: {
    200: { description: "Debit recorded — pass-through from billing-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CreditDebitResponse") } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    409: { description: "idempotencyKey reused with a different amount (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/credits/debits",
  tags: ["Billing"],
  summary: "Get the org's own staff debits",
  description:
    "Every staff debit on the org in context (amount, note, who, when), newest first. Normal org " +
    "auth; billing-service scopes the response to the caller's x-org-id. Transparent proxy to " +
    "billing-service GET /v1/credits/debits.",
  security: authed,
  responses: {
    200: { description: "Org debits — pass-through from billing-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CreditDebitsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/credits/debits/all",
  tags: ["Billing"],
  summary: "Get the platform-wide staff debits ledger (staff only)",
  description:
    "Staff debits across ALL orgs. Staff-only (platform API key + STAFF_EMAILS x-email); no org " +
    "context. Transparent proxy to billing-service GET /internal/credits/debits.",
  security: platformAuth,
  responses: {
    200: { description: "Platform debits ledger — pass-through from billing-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PlatformCreditDebitsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// Payment mode (prepaid | postpaid). The customer reads/sets its own org's mode;
// staff read/set a GIVEN org's mode (orgId in path). Transparent proxy to
// billing-service: body forwarded as-is (billing owns the vocabulary), responses
// passthrough (CLAUDE.md #8), refusals forwarded field-for-field (CLAUDE.md #7).
// ---------------------------------------------------------------------------
const SetPaymentModeRequestSchema = z
  .object({
    payment_mode: z.string().openapi({ description: "\"prepaid\", \"postpaid\" or \"subscription\". Validated downstream (400 on anything else) — the gateway does not enumerate the vocabulary.", example: "prepaid" }),
  })
  .passthrough()
  .openapi("SetPaymentModeRequest");

const PaymentModeResponseSchema = z.object({}).passthrough().openapi("PaymentModeResponse");
const SetPaymentModeResponseSchema = z.object({}).passthrough().openapi("SetPaymentModeResponse");

const paymentModeSettleRefusal = {
  description:
    "A postpaid org that owes money could not settle before switching to prepaid. Body { error, code, owed_cents } " +
    "forwarded field-for-field from billing-service (customer-facing).",
  content: errorContent,
};

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/payment_mode",
  tags: ["Billing"],
  summary: "Read this org's payment mode (prepaid or postpaid)",
  description:
    "Transparent proxy to billing-service GET /v1/accounts/payment_mode for the authenticated org. " +
    "Response { org_id, payment_mode } owned by the downstream service.",
  security: authed,
  responses: {
    200: { description: "Payment mode — pass-through from billing-service", content: { "application/json": { schema: PaymentModeResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/billing/accounts/payment_mode",
  tags: ["Billing"],
  summary: "Set this org's payment mode (prepaid or postpaid)",
  description:
    "Transparent proxy to billing-service PUT /v1/accounts/payment_mode for the authenticated org; body forwarded as-is. " +
    "Switching a postpaid org that owes money to prepaid settles the debt first; if that settle fails billing answers " +
    "409 and the org stays postpaid. Status and body forwarded unchanged.",
  security: authed,
  request: { body: { content: { "application/json": { schema: SetPaymentModeRequestSchema } } } },
  responses: {
    200: { description: "Mode set — { org_id, payment_mode, settled_cents, auto_topup_enabled }, pass-through", content: { "application/json": { schema: SetPaymentModeResponseSchema } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: paymentModeSettleRefusal,
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/by-org/{orgId}/payment-mode",
  tags: ["Billing"],
  summary: "Read a given org's payment mode (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email). Transparent proxy to billing-service " +
    "GET /internal/accounts/by-org/{orgId}/payment-mode. Response { org_id, payment_mode } owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ orgId: z.string().openapi({ description: "Internal org UUID" }) }) },
  responses: {
    200: { description: "Payment mode — pass-through from billing-service", content: { "application/json": { schema: PaymentModeResponseSchema } } },
    400: { description: "Invalid orgId (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "Org has no billing account", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/billing/accounts/by-org/{orgId}/payment-mode",
  tags: ["Billing"],
  summary: "Set a given org's payment mode (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email). Transparent proxy to billing-service " +
    "PUT /internal/accounts/by-org/{orgId}/payment-mode; body forwarded as-is, status and body forwarded unchanged.",
  security: platformAuth,
  request: {
    params: z.object({ orgId: z.string().openapi({ description: "Internal org UUID" }) }),
    body: { content: { "application/json": { schema: SetPaymentModeRequestSchema } } },
  },
  responses: {
    200: { description: "Mode set — pass-through from billing-service", content: { "application/json": { schema: SetPaymentModeResponseSchema } } },
    400: { description: "Invalid orgId or body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "Org has no billing account", content: errorContent },
    409: paymentModeSettleRefusal,
    502: { description: "Upstream error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// Subscription payment mode ($99/month, 3-day free trial, card required).
// Transparent proxy to billing-service: bodies forwarded as-is (billing owns the
// fields and their validation), responses passthrough (CLAUDE.md #8), refusals
// {error, code} forwarded field-for-field (CLAUDE.md #7).
// ---------------------------------------------------------------------------
const SubscriptionResponseSchema = z.object({}).passthrough().openapi("SubscriptionResponse");
const SubscriptionCheckoutResponseSchema = z.object({}).passthrough().openapi("SubscriptionCheckoutResponse");
const SubscriptionActionResponseSchema = z.object({}).passthrough().openapi("SubscriptionActionResponse");

const SubscriptionCheckoutRequestSchema = z
  .object({
    monthly_amount_cents: z.number().optional().openapi({ description: "The plan picked, in cents. Any whole-dollar amount from $29 (2900 cents); validated downstream: below 2900 → 400 {error, code: \"amount_below_minimum\"}, not a multiple of 100 → 400 {error, code: \"amount_not_whole_dollars\"}. Default 9900 ($99) when omitted.", example: 9900 }),
    ui_mode: z.string().optional().openapi({ description: "How the card form is presented, as POST card_setup: \"embedded\" (default) or \"hosted\". Validated downstream.", example: "embedded" }),
    return_url: z.string().optional().openapi({ description: "Where a hosted card form returns to. Required downstream when ui_mode is hosted." }),
  })
  .passthrough()
  .openapi("SubscriptionCheckoutRequest");

const StartSubscriptionRequestSchema = z
  .object({
    monthly_amount_cents: z.number().optional().openapi({ description: "Optional plan override, in cents. Any whole-dollar amount from $29 (2900 cents); validated downstream: below 2900 → 400 {error, code: \"amount_below_minimum\"}, not a multiple of 100 → 400 {error, code: \"amount_not_whole_dollars\"}. Default 9900 ($99) when omitted.", example: 9900 }),
  })
  .passthrough()
  .openapi("StartSubscriptionRequest");

const RaiseSubscriptionRequestSchema = z
  .object({
    monthly_amount_cents: z.number().openapi({ description: "New monthly amount in cents. Any whole-dollar amount from $29 (2900 cents); validated downstream: below 2900 → 400 {error, code: \"amount_below_minimum\"}, not a multiple of 100 → 400 {error, code: \"amount_not_whole_dollars\"}.", example: 19900 }),
  })
  .passthrough()
  .openapi("RaiseSubscriptionRequest");

// Cancel stops sending at once (the plan still ends at period end, no further
// charge); resume restarts it. Both fields are pass-through from billing-service.
const subscriptionSendingNote = (action: "cancel" | "resume") =>
  (action === "cancel"
    ? "Cancel stops sending at once; the plan still ends at period end and is not charged again. "
    : "Resume restarts sending. ") +
  "The response carries sending_stopped (bool) and sending_stopped_reason (\"plan_canceled\" | \"plan_paused\" | null) " +
  "at top level, and each plan view carries sending_stopped. ";

const subscriptionRefusal = {
  description: "Refused by billing-service — body { error, code } forwarded field-for-field.",
  content: errorContent,
};

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/subscription",
  tags: ["Billing"],
  summary: "Read this org's subscription",
  description:
    "Transparent proxy to billing-service GET /v1/accounts/subscription for the authenticated org. " +
    "Response owned by the downstream service.",
  security: authed,
  responses: {
    200: { description: "Subscription — pass-through from billing-service", content: { "application/json": { schema: SubscriptionResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/accounts/subscription/checkout_session",
  tags: ["Billing"],
  summary: "Prepare the subscription: record the plan and get the card form (no charge)",
  description:
    "Transparent proxy to billing-service POST /v1/accounts/subscription/checkout_session for the authenticated org; " +
    "body forwarded as-is (an empty body is valid: $99 plan, embedded card form). Billing records the plan and returns " +
    "{monthly_amount_cents, currency, trial_days, card_required, card_setup}, where card_setup is the card form of " +
    "whichever acquirer holds the org (same descriptor as POST /v1/billing/accounts/card_setup). Nothing is charged. " +
    "Once the card is saved (or when card_required is false) call POST /v1/billing/accounts/subscription/start. " +
    "Status and body forwarded unchanged.",
  security: authed,
  request: { body: { content: { "application/json": { schema: SubscriptionCheckoutRequestSchema } } } },
  responses: {
    200: { description: "Checkout session — pass-through from billing-service", content: { "application/json": { schema: SubscriptionCheckoutResponseSchema } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: subscriptionRefusal,
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/accounts/subscription/start",
  tags: ["Billing"],
  summary: "Start the subscription once the card is saved",
  description:
    "Transparent proxy to billing-service POST /v1/accounts/subscription/start for the authenticated org; " +
    "body forwarded as-is (an empty body is valid). First subscription: 3-day free trial, nothing charged; an org " +
    "that already had its trial is charged the first month now. Returns the same body as GET " +
    "/v1/billing/accounts/subscription. 409 {error, code} (card_required, first_charge_declined, subscription_exists, " +
    "existing_paying_org) and 400 forwarded field-for-field. Status and body forwarded unchanged.",
  security: authed,
  request: { body: { content: { "application/json": { schema: StartSubscriptionRequestSchema } } } },
  responses: {
    200: { description: "Started — pass-through from billing-service", content: { "application/json": { schema: SubscriptionResponseSchema } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: subscriptionRefusal,
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/billing/accounts/subscription",
  tags: ["Billing"],
  summary: "Change this org's monthly subscription amount",
  description:
    "Transparent proxy to billing-service PATCH /v1/accounts/subscription for the authenticated org; body forwarded as-is. " +
    "Status and body forwarded unchanged.",
  security: authed,
  request: { body: { content: { "application/json": { schema: RaiseSubscriptionRequestSchema } } } },
  responses: {
    200: { description: "Subscription updated — pass-through from billing-service", content: { "application/json": { schema: SubscriptionActionResponseSchema } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: subscriptionRefusal,
    502: { description: "Upstream error", content: errorContent },
  },
});

for (const action of ["cancel", "resume"] as const) {
  registry.registerPath({
    method: "post",
    path: `/v1/billing/accounts/subscription/${action}`,
    tags: ["Billing"],
    summary: action === "cancel" ? "Cancel this org's subscription" : "Resume this org's cancelled subscription",
    description:
      `Transparent proxy to billing-service POST /v1/accounts/subscription/${action} for the authenticated org. ` +
      "No body. " + subscriptionSendingNote(action) + "Status and body forwarded unchanged.",
    security: authed,
    responses: {
      200: { description: "Subscription updated — pass-through from billing-service", content: { "application/json": { schema: SubscriptionActionResponseSchema } } },
      401: { description: "Unauthorized", content: errorContent },
      409: subscriptionRefusal,
      502: { description: "Upstream error", content: errorContent },
    },
  });
}

const PauseSubscriptionRequestSchema = z
  .object({
    months: z.number().openapi({ description: "How many months to pause: 1, 2 or 3. Validated downstream (400 otherwise).", example: 1 }),
  })
  .passthrough()
  .openapi("PauseSubscriptionRequest");

const pauseRefusal = {
  description:
    "Refused by billing-service — body { error, code } forwarded field-for-field. Codes: subscription_paused, " +
    "subscription_not_paused, subscription_ended, subscription_not_active, subscription_cancel_pending.",
  content: errorContent,
};

const pauseNotFound = {
  description: "No subscription — body { error, code: \"no_subscription\" } forwarded field-for-field.",
  content: errorContent,
};

for (const action of ["pause", "unpause"] as const) {
  registry.registerPath({
    method: "post",
    path: `/v1/billing/accounts/subscription/${action}`,
    tags: ["Billing"],
    summary: action === "pause" ? "Pause this org's monthly plan for 1-3 months" : "Unpause this org's paused monthly plan",
    description:
      `Transparent proxy to billing-service POST /v1/accounts/subscription/${action} for the authenticated org. ` +
      (action === "pause" ? "Body {months: 1|2|3} forwarded as-is. " : "No body. ") +
      "Returns the same body as cancel/resume ({org_id, subscription, credits_remaining_cents}); the subscription view " +
      "carries paused, paused_at, pause_ends_at, can_pause, can_unpause. Status and body forwarded unchanged.",
    security: authed,
    ...(action === "pause"
      ? { request: { body: { content: { "application/json": { schema: PauseSubscriptionRequestSchema } } } } }
      : {}),
    responses: {
      200: { description: "Subscription updated — pass-through from billing-service", content: { "application/json": { schema: SubscriptionActionResponseSchema } } },
      400: { description: "Invalid months (forwarded verbatim)", content: errorContent },
      401: { description: "Unauthorized", content: errorContent },
      404: pauseNotFound,
      409: pauseRefusal,
      502: { description: "Upstream error", content: errorContent },
    },
  });
}

const StartPlanRequestSchema = z
  .object({
    brand_id: z.string().openapi({ description: "Brand the plan is for. Validated downstream." }),
    offer_id: z.string().openapi({ description: "Offer of that brand the plan is for. Validated downstream." }),
    monthly_amount_cents: z.number().openapi({ description: "Monthly amount in cents. Any whole-dollar amount from $29 (2900 cents); validated downstream: below 2900 → 400 {error, code: \"amount_below_minimum\"}, not a multiple of 100 → 400 {error, code: \"amount_not_whole_dollars\"}.", example: 9900 }),
  })
  .passthrough()
  .openapi("StartPlanRequest");

const PlansResponseSchema = z.object({}).passthrough().openapi("PlansResponse");
const PlanResponseSchema = z.object({}).passthrough().openapi("PlanResponse");

const subscriptionIdParams = z.object({
  subscriptionId: z.string().openapi({ description: "Plan id, as listed by GET /v1/billing/accounts/subscriptions" }),
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/subscriptions",
  tags: ["Billing"],
  summary: "List every plan of this org (one per brand x offer)",
  description:
    "Transparent proxy to billing-service GET /v1/accounts/subscriptions for the authenticated org. " +
    "Response owned by the downstream service.",
  security: authed,
  responses: {
    200: { description: "Plans — pass-through from billing-service", content: { "application/json": { schema: PlansResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/accounts/subscriptions",
  tags: ["Billing"],
  summary: "Start a plan for one brand x offer (no trial, first month charged now)",
  description:
    "Transparent proxy to billing-service POST /v1/accounts/subscriptions for the authenticated org; body " +
    "{brand_id, offer_id, monthly_amount_cents} forwarded as-is. 4xx {error, code} (plan_exists_for_offer, card_required, " +
    "first_charge_declined, charge_unavailable, offer_not_found, existing_paying_org, ...) forwarded field-for-field. " +
    "Status and body forwarded unchanged.",
  security: authed,
  request: { body: { content: { "application/json": { schema: StartPlanRequestSchema } } } },
  responses: {
    200: { description: "Plan started — pass-through from billing-service", content: { "application/json": { schema: PlanResponseSchema } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: subscriptionRefusal,
    409: subscriptionRefusal,
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/billing/accounts/subscriptions/{subscriptionId}",
  tags: ["Billing"],
  summary: "Change one plan's monthly amount",
  description:
    "Transparent proxy to billing-service PATCH /v1/accounts/subscriptions/{subscriptionId} for the authenticated org; " +
    "body forwarded as-is. Status and body forwarded unchanged.",
  security: authed,
  request: {
    params: subscriptionIdParams,
    body: { content: { "application/json": { schema: RaiseSubscriptionRequestSchema } } },
  },
  responses: {
    200: { description: "Plan updated — pass-through from billing-service", content: { "application/json": { schema: PlanResponseSchema } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: subscriptionRefusal,
    409: subscriptionRefusal,
    502: { description: "Upstream error", content: errorContent },
  },
});

for (const action of ["cancel", "resume"] as const) {
  registry.registerPath({
    method: "post",
    path: `/v1/billing/accounts/subscriptions/{subscriptionId}/${action}`,
    tags: ["Billing"],
    summary: action === "cancel" ? "Cancel one plan" : "Resume one cancelled plan",
    description:
      `Transparent proxy to billing-service POST /v1/accounts/subscriptions/{subscriptionId}/${action} for the authenticated org. ` +
      "No body. " + subscriptionSendingNote(action) + "Status and body forwarded unchanged.",
    security: authed,
    request: { params: subscriptionIdParams },
    responses: {
      200: { description: "Plan updated — pass-through from billing-service", content: { "application/json": { schema: PlanResponseSchema } } },
      401: { description: "Unauthorized", content: errorContent },
      404: subscriptionRefusal,
      409: subscriptionRefusal,
      502: { description: "Upstream error", content: errorContent },
    },
  });
}

for (const action of ["pause", "unpause"] as const) {
  registry.registerPath({
    method: "post",
    path: `/v1/billing/accounts/subscriptions/{subscriptionId}/${action}`,
    tags: ["Billing"],
    summary: action === "pause" ? "Pause one plan for 1-3 months" : "Unpause one paused plan",
    description:
      `Transparent proxy to billing-service POST /v1/accounts/subscriptions/{subscriptionId}/${action} for the authenticated org. ` +
      (action === "pause" ? "Body {months: 1|2|3} forwarded as-is. " : "No body. ") +
      "Status and body forwarded unchanged.",
    security: authed,
    request: {
      params: subscriptionIdParams,
      ...(action === "pause"
        ? { body: { content: { "application/json": { schema: PauseSubscriptionRequestSchema } } } }
        : {}),
    },
    responses: {
      200: { description: "Plan updated — pass-through from billing-service", content: { "application/json": { schema: PlanResponseSchema } } },
      400: { description: "Invalid months (forwarded verbatim)", content: errorContent },
      401: { description: "Unauthorized", content: errorContent },
      404: pauseNotFound,
      409: pauseRefusal,
      502: { description: "Upstream error", content: errorContent },
    },
  });
}

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/by-org/{orgId}/subscription",
  tags: ["Billing"],
  summary: "Read a given org's subscription (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email). Transparent proxy to billing-service " +
    "GET /internal/accounts/by-org/{orgId}/subscription. Response owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ orgId: z.string().openapi({ description: "Internal org UUID" }) }) },
  responses: {
    200: { description: "Subscription — pass-through from billing-service", content: { "application/json": { schema: SubscriptionResponseSchema } } },
    400: { description: "Invalid orgId (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "Org has no billing account", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

export const BillingRevenueResponseSchema = z.object({}).passthrough().openapi("BillingRevenueResponse");

const revenueQuery = z
  .object({
    cashHorizonDays: z.string().optional().openapi({ description: "Cash-flow horizon in days (billing-service validates the range). Documented today, not a whitelist: the query string is forwarded verbatim." }),
  })
  .passthrough();

registry.registerPath({
  method: "get",
  path: "/v1/billing/revenue/fleet",
  tags: ["Billing"],
  summary: "Fleet revenue: recurring, prepaid run-out and cash flow (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email). Byte passthrough to billing-service " +
    "GET /internal/revenue/fleet; query string forwarded verbatim, status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: revenueQuery },
  responses: {
    200: { description: "Fleet revenue — pass-through from billing-service", content: { "application/json": { schema: BillingRevenueResponseSchema } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/revenue/by-org/{orgId}",
  tags: ["Billing"],
  summary: "One org's revenue: recurring, prepaid run-out and cash flow (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email). Byte passthrough to billing-service " +
    "GET /internal/revenue/by-org/{orgId}; query string forwarded verbatim, status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    params: z.object({ orgId: z.string().openapi({ description: "Internal org UUID" }) }),
    query: revenueQuery,
  },
  responses: {
    200: { description: "Org revenue — pass-through from billing-service", content: { "application/json": { schema: BillingRevenueResponseSchema } } },
    400: { description: "Invalid orgId or query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "Not found (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/runs/stats/costs/vendor",
  tags: ["Runs"],
  summary: "Fleet cost stats on the vendor-cost basis (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to runs-service GET /internal/stats/costs/vendor: grouped committed cost at what vendors charged before markup, plus the billed amount of rows whose vendor cost is unknown. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ groupBy: z.string().openapi({ description: "Comma-separated grouping keys (runs-service validates them)" }) }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("FleetVendorCostStatsResponse") } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/runs/stats/costs/margin",
  tags: ["Runs"],
  summary: "Platform-billed spend with vendor cost and margin (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide unless runs-service's own `orgId` query parameter is sent. " +
    "Byte passthrough to runs-service GET /internal/stats/costs/margin. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ orgId: z.string().optional().openapi({ description: "Internal org UUID; absent = whole fleet" }) }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("FleetCostMarginStatsResponse") } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/runs/stats/costs/margin/timeseries",
  tags: ["Runs"],
  summary: "Monthly platform-billed spend with vendor cost and margin, per provider (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide unless runs-service's own `orgId` query parameter is sent. " +
    "Byte passthrough to runs-service GET /internal/stats/costs/margin/timeseries: the margin read split into UTC calendar months, every provider in one response. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ orgId: z.string().optional().openapi({ description: "Internal org UUID; absent = whole fleet" }) }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("FleetCostMarginTimeseriesResponse") } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/provider-payment-sources",
  tags: ["Costs"],
  summary: "Which of our payment accounts pays each provider (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email). " +
    "Byte passthrough to costs-service GET /internal/provider-payment-sources: one entry per catalogue provider with the accounts that pay it, read live from the bank ledger (unmatched providers marked so; a ledger failure is a 502). Status and body owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("ProviderPaymentSourcesResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/subscription-costs",
  tags: ["Costs"],
  summary: "Real cost per credit of each vendor subscription, over time (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to costs-service GET /internal/subscription-costs: the series of what one credit of each vendor subscription really costs us. Before its first refresh the downstream answers 503 with { error, lastRefresh }, forwarded as-is. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("SubscriptionCostsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Not computed yet (forwarded verbatim from the downstream)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/real-costs",
  tags: ["Costs"],
  summary: "Real cost of every cost name (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide. " +
    "Byte passthrough to costs-service GET /internal/real-costs. Optional ?day=YYYY-MM-DD. Before its first refresh the downstream answers 503 with { error, lastRefresh }, forwarded as-is. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RealCostsResponse") } } },
    400: { description: "Bad query (forwarded verbatim from the downstream)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Not computed yet (forwarded verbatim from the downstream)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/real-costs/{costName}",
  tags: ["Costs"],
  summary: "Real cost of one cost name (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide. " +
    "Byte passthrough to costs-service GET /internal/real-costs/{costName}. Before its first refresh the downstream answers 503 with { error, lastRefresh }, forwarded as-is. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ costName: z.string() }), query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RealCostResponse") } } },
    400: { description: "Bad query (forwarded verbatim from the downstream)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "Unknown cost name (forwarded verbatim from the downstream)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Not computed yet (forwarded verbatim from the downstream)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/price-lists",
  tags: ["Costs"],
  summary: "Catalogue or proposed price list at a date (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide. " +
    "Byte passthrough to costs-service GET /internal/price-lists. Query: source=catalogue|proposed, date=YYYY-MM-DD. Before its first refresh the downstream answers 503 with { error, lastRefresh }, forwarded as-is. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PriceListsResponse") } } },
    400: { description: "Bad query (forwarded verbatim from the downstream)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Not computed yet (forwarded verbatim from the downstream)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/price-comparison",
  tags: ["Costs"],
  summary: "Comparison of two price lists (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide. " +
    "Byte passthrough to costs-service GET /internal/price-comparison. Query: list1/list2=<source>:<date>, optional orgId, brandId, interval=day|week|month. Before its first refresh the downstream answers 503 with { error, lastRefresh }, forwarded as-is. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PriceComparisonResponse") } } },
    400: { description: "Bad query (forwarded verbatim from the downstream)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Not computed yet (forwarded verbatim from the downstream)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/email-send-price",
  tags: ["Costs"],
  summary: "Price of one cold email sent to a lead, over time (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to costs-service GET /internal/email-send-price: the series of what one cold email sent to a lead costs us, computed from the bank ledger. Before its first refresh the downstream answers 503 with { error, lastRefresh }, forwarded as-is. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("EmailSendPriceResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Not computed yet (forwarded verbatim from the downstream)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/costs/vendor-costs",
  tags: ["Costs"],
  summary: "Every price version per cost name with its vendor cost (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to costs-service GET /internal/vendor-costs: billed unit price and vendor unit cost for every price version, all plans and dates. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ names: z.string().optional().openapi({ description: "Comma-separated cost names to restrict to" }) }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("VendorCostVersionsResponse") } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

// Agent catalogue (staff) — features-service /internal/catalogue/* (PR #1482)
registry.registerPath({
  method: "get",
  path: "/v1/catalogue/steps",
  tags: ["Features"],
  summary: "List catalogue steps (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/steps: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: q, limit (1..25, default 10); not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueStepsListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/steps/{id}",
  tags: ["Features"],
  summary: "Read one catalogue step (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/steps/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ id: z.string().openapi({ description: "a step key or label" }) }), query: z.object({  }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueStepsDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/sales-paths",
  tags: ["Features"],
  summary: "List catalogue sales paths (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/sales-paths: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: containsSteps, q, limit; not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ containsSteps: z.string().optional().openapi({ description: "Comma list of step keys or labels: the paths containing at least one" }), q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueSalesPathsListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/sales-paths/{id}",
  tags: ["Features"],
  summary: "Read one catalogue sales path (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/sales-paths/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ id: z.string().openapi({ description: "a sales path id (leg keys joined by `+`, sent as `%2B`)" }) }), query: z.object({  }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueSalesPathsDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/channels",
  tags: ["Features"],
  summary: "List catalogue channels (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/channels: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: forPaths, legKeys, q, limit; not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ forPaths: z.string().optional().openapi({ description: "Comma list of sales path ids" }), legKeys: z.string().optional(), q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueChannelsListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/channels/{id}",
  tags: ["Features"],
  summary: "Read one catalogue channel (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/channels/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ id: z.string().openapi({ description: "a channel slug" }) }), query: z.object({  }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueChannelsDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/pipes",
  tags: ["Features"],
  summary: "List catalogue pipes (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/pipes: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: paths, channels, legKeys, q, limit; not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ paths: z.string().optional().openapi({ description: "Comma list of sales path ids" }), channels: z.string().optional().openapi({ description: "Comma list of channel slugs" }), legKeys: z.string().optional(), q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CataloguePipesListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/pipes/{id}",
  tags: ["Features"],
  summary: "Read one catalogue pipe (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/pipes/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ id: z.string().openapi({ description: "a pipe id `<channel slug>|<leg key>`" }) }), query: z.object({  }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CataloguePipesDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/sales-funnels",
  tags: ["Features"],
  summary: "List catalogue sales funnels (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/sales-funnels: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: paths, containsChannels, q, limit; not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ paths: z.string().optional().openapi({ description: "Comma list of sales path ids" }), containsChannels: z.string().optional().openapi({ description: "Comma list of channel slugs: funnels containing at least one" }), q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueSalesFunnelsListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/sales-funnels/{id}",
  tags: ["Features"],
  summary: "Read one catalogue sales funnel (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/sales-funnels/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ id: z.string().openapi({ description: "a sales funnel id" }) }), query: z.object({  }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueSalesFunnelsDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/workflows",
  tags: ["Features"],
  summary: "List catalogue workflows (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/workflows: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: pipe (required), q, limit; not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ pipe: z.string().optional().openapi({ description: "A pipe id (required by the downstream)" }), q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueWorkflowsListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/workflows/{id}",
  tags: ["Features"],
  summary: "Read one catalogue workflow (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/workflows/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ id: z.string().openapi({ description: "a workflow dynasty slug (needs `pipe`)" }) }), query: z.object({ pipe: z.string().optional().openapi({ description: "A pipe id (required by the downstream)" }), q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueWorkflowsDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/catalogue/faces/{file}",
  tags: ["Features"],
  summary: "A sales funnel name's face (SVG)",
  description:
    "Byte passthrough to features-service GET /public/catalogue/faces/{file}: a 128 x 128 SVG drawn from the name alone (`<URL-encoded name>.svg`). No authentication required.",
  request: { params: z.object({ file: z.string().openapi({ description: "`<URL-encoded name>.svg`" }) }) },
  responses: {
    200: { description: "The SVG image", content: { "image/svg+xml": { schema: z.string().openapi("CatalogueFaceSvg") } } },
    404: { description: "Unknown file (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

// Copilot skill tree + staff requests (staff) — chat-service /internal/skills, /internal/staff-requests
const CopilotSkillSlugParams = z.object({ slug: z.string().openapi({ description: "Skill slug (stable id). The root is `index`." }) });

registry.registerPath({
  method: "get",
  path: "/v1/chat/skills",
  tags: ["Chat"],
  summary: "List the Copilot skill tree (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to chat-service GET /internal/skills: every skill of the dashboard Copilot (slug, parent, title, description, position, version, updatedBy, updatedAt), no content. Status and body owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CopilotSkillListResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/chat/skills/{slug}",
  tags: ["Chat"],
  summary: "Read one Copilot skill with its markdown (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to chat-service GET /internal/skills/{slug}. Status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: CopilotSkillSlugParams },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CopilotSkillResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown skill or version (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/chat/skills/{slug}",
  tags: ["Chat"],
  summary: "Create or update a Copilot skill (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Passthrough to chat-service PUT /internal/skills/{slug}. The body is forwarded as sent EXCEPT `editedBy`, which the gateway always sets to the signed-in staff email (any value the caller sends is replaced). A new version is recorded when the content changes. Safe to call every few seconds (autosave): no extra rate limit applies. Status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    params: CopilotSkillSlugParams,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              content: z.string().openapi({ description: "Markdown body." }),
              title: z.string().optional(),
              description: z.string().optional(),
              parentSlug: z.string().optional(),
              position: z.number().int().optional(),
            })
            .passthrough()
            .openapi("CopilotSkillWriteRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CopilotSkillWriteResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown skill or version (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/chat/skills/{slug}/versions",
  tags: ["Chat"],
  summary: "List a Copilot skill's versions (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to chat-service GET /internal/skills/{slug}/versions. To restore a version, PUT its content back to /v1/chat/skills/{slug}. Status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: CopilotSkillSlugParams },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CopilotSkillVersionListResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown skill or version (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/chat/skills/{slug}/versions/{version}",
  tags: ["Chat"],
  summary: "Read one version of a Copilot skill (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to chat-service GET /internal/skills/{slug}/versions/{version}. Status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    params: z.object({
      slug: z.string().openapi({ description: "Skill slug (stable id). The root is `index`." }),
      version: z.string().openapi({ description: "Version number (1 = first)." }),
    }),
  },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CopilotSkillVersionResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown skill or version (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/chat/staff-requests",
  tags: ["Chat"],
  summary: "List the Copilot's staff requests (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to chat-service GET /internal/staff-requests: requests the dashboard Copilot escalated to staff, newest first. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z
      .object({
        orgId: z.string().optional().openapi({ description: "Restrict to one organization (internal UUID)" }),
        limit: z.string().optional().openapi({ description: "Max rows (downstream default 50)" }),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CopilotStaffRequestListResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/social/brands/{brandId}/linkedin-posts",
  tags: ["Social"],
  summary: "A brand's own LinkedIn company page posts, LinkedIn-card shaped (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), no org scoping: fetching spends platform money. " +
    "Byte passthrough to social-service GET /internal/brands/{brandId}/linkedin-posts: the page brand-service names for the brand, its posts newest first (text, media, quote/repost, reactions per type, comments). " +
    "`status` is ready | pending (first fetch running: poll) | failed | no_linkedin_page | linkedin_page_unresolved. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    params: z.object({ brandId: z.string().openapi({ description: "Brand UUID" }) }),
    query: z
      .object({
        limit: z.string().optional().openapi({ description: "Posts per page (social-service: 1-50, default 10)" }),
        cursor: z.string().optional().openapi({ description: "`nextCursor` of the previous page" }),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandLinkedinPostsResponse") } } },
    400: { description: "Invalid brand id or query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "Unknown brand (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/social/me/linkedin-posts",
  tags: ["Social"],
  summary: "The signed-in user's own LinkedIn profile posts, LinkedIn-card shaped (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email, refused with 403 before any identity resolution or downstream call): fetching spends platform money. " +
    "The user is the one authenticated (x-user-id or x-external-org-id + x-external-user-id resolved by the gateway), never named in the path. " +
    "Byte passthrough to social-service GET /internal/users/{userId}/linkedin-posts with the authenticated internal user id: the profile client-service names for the user, its posts newest first, the same card and paging as /v1/social/brands/{brandId}/linkedin-posts. " +
    "`status` is ready | pending (first fetch running: poll) | failed | no_linkedin_profile | linkedin_profile_unresolved. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z
      .object({
        limit: z.string().optional().openapi({ description: "Posts per page (social-service: 1-50, default 10)" }),
        cursor: z.string().optional().openapi({ description: "`nextCursor` of the previous page" }),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("UserLinkedinPostsResponse") } } },
    400: { description: "Missing identity headers or invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "Unknown user (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/stats",
  tags: ["Instantly"],
  summary: "Fleet-wide email counters since inception (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org scoping. " +
    "Byte passthrough to instantly-service GET /public/stats: emails sent, opened, replied and the rest, across every org. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyFleetStatsResponse") } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// Per-org platform-usage discount (staff-only) — set / read / remove an org's
// usage-discount percentage. Gated by requireStaff (platform API key + x-email
// in the STAFF_EMAILS allowlist); a customer can never reach these. Transparent
// proxy to billing-service. Responses passthrough (CLAUDE.md #8); body forwarded
// as-is (CLAUDE.md #4).
// ---------------------------------------------------------------------------
const SetUsageDiscountRequestSchema = z
  .object({
    discountPct: z.number().openapi({ description: "Platform-usage discount percentage (integer 0–100). Validated downstream — out-of-range rejected 400, no clamp.", example: 50 }),
  })
  .passthrough()
  .openapi("SetUsageDiscountRequest");

registry.registerPath({
  method: "get",
  path: "/v1/billing/usage-discount",
  tags: ["Billing"],
  summary: "Read an org's platform-usage discount (staff only)",
  description:
    "Read the usage-discount percentage for the org in context. Staff-only: requires the platform " +
    "API key AND an x-email in the STAFF_EMAILS allowlist. Transparent proxy to billing-service " +
    "GET /v1/usage-discount; response { orgId, discountPct, setBy, setAt } (discountPct null when " +
    "unset) owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Usage discount — pass-through from billing-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("UsageDiscountResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/billing/usage-discount",
  tags: ["Billing"],
  summary: "Set / replace an org's platform-usage discount (staff only)",
  description:
    "Set or replace the usage-discount percentage for the org in context. Staff-only (platform API " +
    "key + STAFF_EMAILS x-email); the staff x-email is recorded as setBy. Transparent proxy to " +
    "billing-service PUT /v1/usage-discount; body { discountPct } forwarded as-is (downstream owns " +
    "value validation: integer 0–100, fail-loud 400, no clamp), response owned by the downstream service.",
  security: platformAuth,
  request: { body: { content: { "application/json": { schema: SetUsageDiscountRequestSchema } } } },
  responses: {
    200: { description: "Discount set — pass-through from billing-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("SetUsageDiscountResponse") } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/billing/usage-discount",
  tags: ["Billing"],
  summary: "Remove an org's platform-usage discount (staff only)",
  description:
    "Remove the usage-discount for the org in context (→ discountPct null). Staff-only (platform API " +
    "key + STAFF_EMAILS x-email). Idempotent. Transparent proxy to billing-service " +
    "DELETE /v1/usage-discount; response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Discount removed — pass-through from billing-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RemoveUsageDiscountResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/conversations",
  tags: ["Conversations"],
  summary: "Read the messages exchanged with a lead on a campaign",
  description:
    "Pass-through to instantly-service GET /orgs/conversations. Returns what the prospect wrote and what " +
    "we sent for one (campaign, lead email) pair, oldest first, each message carrying direction, from, to, " +
    "timestamp, subject and markup-stripped text. Covers both transports (Instantly Unibox and our own " +
    "SMTP/IMAP self-send) behind one response shape. The org boundary is the authenticated org: a " +
    "conversation belonging to another org is a 404. The whole query string is forwarded verbatim — the " +
    "parameters listed here are the ones documented today, not a whitelist. Three refusals stay distinct " +
    "and must not be collapsed: 404 `campaign_not_found` (no record of this conversation), 200 with an " +
    "empty `messages` (the sequence exists, nothing exchanged yet), 502 `thread_unavailable` (the thread " +
    "exists but could not be read). Upstream error bodies are forwarded field-for-field, `code` included. " +
    "Declares no cost — it sends nothing.",
  security: authed,
  request: {
    query: z.object({
      campaign_id: z.string().openapi({ description: "Logical campaign id — the same key POST /orgs/replies takes" }),
      email: z.string().openapi({ description: "The lead whose conversation to read" }),
    }).passthrough(),
  },
  responses: {
    200: {
      description: "The conversation as returned by instantly-service, oldest first (possibly empty)",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("ConversationResponse") } },
    },
    400: { description: "Missing or invalid query parameters", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No conversation in this org for that (campaign, email) — `code: campaign_not_found`", content: errorContent },
    502: { description: "The sequence exists but its thread could not be read — `code: thread_unavailable`", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/sending-schedule",
  tags: ["Conversations"],
  summary: "When we may email one lead (weekdays, local hours, timezone)",
  description:
    "Pass-through to instantly-service GET /orgs/sending-schedule. Returns the weekdays and the local " +
    "start/end hour we may email this lead in, the lead's timezone (`timezoneIsDefault` when we hold no " +
    "zone for them) and whether a sequence exists. Never a 404: a lead this org holds nothing for reads as " +
    "the default schedule. The org boundary is the authenticated org. `brand_id` is also forwarded as the " +
    "`x-brand-id` identity header. The whole query string is forwarded verbatim — the parameters listed " +
    "here are the ones documented today, not a whitelist. Upstream error bodies are forwarded " +
    "field-for-field. Declares no cost — it sends nothing.",
  security: authed,
  request: {
    query: z.object({
      email: z.string().openapi({ description: "The lead's email" }),
      brand_id: z.string().optional().openapi({ description: "Optional brand id (uuid) to scope the lookup" }),
    }).passthrough(),
  },
  responses: {
    200: {
      description: "The lead's sending schedule as returned by instantly-service",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("SendingScheduleResponse") } },
    },
    400: { description: "Missing or invalid query parameters", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/audit/sending-forecast",
  tags: ["Instantly"],
  summary: "Get the platform sending-forecast audit (staff only)",
  description:
    "Fleet-wide Instantly sending-forecast audit (cross-org sending infrastructure ops data, " +
    "NOT customer data) — powers the staff 'Audit → Instantly' ops page. Staff-only (platform API " +
    "key + STAFF_EMAILS x-email); no org context required. Transparent proxy to instantly-service " +
    "GET /internal/audit/sending-forecast; response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Sending forecast — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlySendingForecastResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/audit/account-health",
  tags: ["Instantly"],
  summary: "Get the platform per-account deliverability health audit (staff only)",
  description:
    "Fleet-wide Instantly per-sending-account deliverability health (identity, sending config, " +
    "daily send limit, allowed-to-send / blocked state) across all cold-email accounts (cross-org " +
    "sending infrastructure ops data, NOT customer data) — powers the staff 'Audit → Instantly' ops " +
    "page. Staff-only (platform API key + STAFF_EMAILS x-email); no org context required. Transparent " +
    "proxy to instantly-service GET /internal/audit/account-health; response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Per-account health — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyAccountHealthResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/audit/account-detail",
  tags: ["Instantly"],
  summary: "Get the full raw Instantly config for one account (staff only)",
  description:
    "Full raw Instantly account object for ONE cold-email sending account (all provider config: " +
    "identity, sending settings, warmup, tracking, limits) — powers the account drilldown right-panel " +
    "on the staff 'Audit → Instantly' ops page (cross-org sending infrastructure ops data, NOT " +
    "customer data). Staff-only (platform API key + STAFF_EMAILS x-email); no org context required. " +
    "Transparent proxy to instantly-service GET /internal/audit/account-detail; response owned by the " +
    "downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      email: z.string().describe("Email of the Instantly account to fetch (forwarded to instantly-service)"),
    }),
  },
  responses: {
    200: { description: "Raw account object — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyAccountDetailResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/audit/capacity-history",
  tags: ["Instantly"],
  summary: "Get the platform sending-capacity-over-time audit (staff only)",
  description:
    "Fleet-wide Instantly sending-capacity history: a time series of in-production sending accounts " +
    "and daily sending capacity, so staff can chart how the cold-email fleet's capacity evolves " +
    "(cross-org sending infrastructure ops data, NOT customer data) — powers the staff 'Audit → " +
    "Instantly' ops page. Staff-only (platform API key + STAFF_EMAILS x-email); no org context " +
    "required. Transparent proxy to instantly-service GET /internal/audit/capacity-history; response " +
    "owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      days: z.coerce.number().int().optional().describe("Number of days of history to return (forwarded to instantly-service)"),
    }),
  },
  responses: {
    200: { description: "Sending-capacity history — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyCapacityHistoryResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/audit/reconcile",
  tags: ["Instantly"],
  summary: "Get the platform local-vs-Instantly reconciliation audit (staff only)",
  description:
    "Fleet-wide Instantly reconciliation audit: for each countable fact, our LOCAL number vs " +
    "INSTANTLY's number plus the delta, so staff can spot cold-email data drift (cross-org ops " +
    "data, NOT customer data) — powers the staff 'Audit → Instantly' ops page. Staff-only " +
    "(platform API key + STAFF_EMAILS x-email); no org context required. Transparent proxy to " +
    "instantly-service GET /internal/audit/reconcile; response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Reconciliation audit — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyReconcileResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/lifecycle-rules",
  tags: ["Instantly"],
  summary: "Get the sending lifecycle rules as data (staff only)",
  description:
    "Platform-scoped staff read from instantly-service's unified sending model (cross-org ops "
    + "data, NOT customer data) — powers the rebuilt staff 'Audit → Instantly' page. Staff-only "
    + "(platform API key + STAFF_EMAILS x-email); no org context. "
    + "Transparent byte passthrough to instantly-service GET /internal/ops/lifecycle-rules: bars and "
    + "limits per lifecycle state, ramp, placement cadence and warmup. Response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Lifecycle rules — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsLifecycleRulesResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/domains",
  tags: ["Instantly"],
  summary: "Get one row per (provider, domain) with DNS, delivery, volume and cost (staff only)",
  description:
    "Platform-scoped staff read from instantly-service's unified sending model (cross-org ops "
    + "data, NOT customer data) — powers the rebuilt staff 'Audit → Instantly' page. Staff-only "
    + "(platform API key + STAFF_EMAILS x-email); no org context. "
    + "Transparent byte passthrough to instantly-service GET /internal/ops/domains: purchase and renewal, "
    + "the latest SPF / DMARC / DKIM / MX photograph, pooled placement delivery, addresses by lifecycle, real "
    + "mailboxes, 30-day volume and estimated cost paid to date. Response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Domains — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsDomainsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/mailboxes",
  tags: ["Instantly"],
  summary: "Get one row per real mailbox with cap, ramp, volume and cost (staff only)",
  description:
    "Platform-scoped staff read from instantly-service's unified sending model (cross-org ops "
    + "data, NOT customer data) — powers the rebuilt staff 'Audit → Instantly' page. Staff-only "
    + "(platform API key + STAFF_EMAILS x-email); no org context. "
    + "Transparent byte passthrough to instantly-service GET /internal/ops/mailboxes: vendor, pool, "
    + "subscription, dates, aliases, cap and ramp projection, volume, delivery and cost. Response owned by "
    + "the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Mailboxes — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsMailboxesResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/addresses",
  tags: ["Instantly"],
  summary: "Get every sending address with health, transport, ramp and lifecycle history (staff only)",
  description:
    "Platform-scoped staff read from instantly-service's unified sending model (cross-org ops "
    + "data, NOT customer data) — powers the rebuilt staff 'Audit → Instantly' page. Staff-only "
    + "(platform API key + STAFF_EMAILS x-email); no org context. "
    + "Transparent byte passthrough to instantly-service GET /internal/ops/addresses: a SUPERSET of "
    + "GET /internal/audit/account-health assembled from the same rows, plus mailbox login, send transport, "
    + "evidence expiry, next seed test, ramp projection, 7-day volume by typology and the last lifecycle "
    + "transitions. Response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Addresses — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsAddressesResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/infra",
  tags: ["Instantly"],
  summary: "Get the sending-infrastructure rollup: fleet totals and one row per pool (staff only)",
  description:
    "Platform-scoped staff read from instantly-service's unified sending model (cross-org ops "
    + "data, NOT customer data) — powers the rebuilt staff 'Audit → Instantly' page. Staff-only "
    + "(platform API key + STAFF_EMAILS x-email); no org context. "
    + "Transparent byte passthrough to instantly-service GET /internal/ops/infra: fleet totals and one "
    + "rollup per pool (capacity, lifecycle counts, queue, volume, placement) plus the manual exclusions. "
    + "Response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Infra — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsInfraResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/threads",
  tags: ["Instantly"],
  summary: "List sending threads, newest activity first — the ops inbox (staff only)",
  description:
    "Platform-scoped staff read from instantly-service's unified sending model (cross-org ops "
    + "data, NOT customer data) — powers the rebuilt staff 'Audit → Instantly' page. Staff-only "
    + "(platform API key + STAFF_EMAILS x-email); no org context. "
    + "Transparent byte passthrough to instantly-service GET /internal/ops/threads: one row per thread "
    + "(a sequence and its replies for outreach, the message itself for warmup and seeds) with kind, subject, "
    + "account, mailbox, counterparty, transport, counts, first and last activity, and the lead's delivery and "
    + "reply classification. Cursor pagination on (lastAt, threadId). "
    + "The query string is forwarded verbatim, so any filter instantly-service accepts can be asked for; "
    + "the parameters below are the ones it documents today, not a whitelist this gateway enforces. "
    + "`limit` is REQUIRED downstream (there is no silent default) — omitting it answers instantly-service's own 400.",
  security: platformAuth,
  request: {
    query: z.object({
      limit: z.coerce.number().int().describe("REQUIRED downstream. Page size — there is no default; a caller states how much it wants."),
      cursor: z.string().optional().describe("Opaque, from the previous page's nextCursor"),
      kind: z.string().optional().describe("outreach | manual_reply | warmup | warmup_reply | seed | reply | auto_reply | bounce"),
      direction: z.string().optional().describe("in | out"),
      account: z.string().optional().describe("Sending address"),
      mailbox: z.string().optional().describe("Real mailbox login"),
      domain: z.string().optional().describe("Sending domain"),
      counterparty: z.string().optional().describe("Substring match on the other party"),
      orgId: z.string().optional(),
      campaignId: z.string().optional().describe("The caller campaign id"),
      since: z.string().optional().describe("ISO timestamp, inclusive"),
      until: z.string().optional().describe("ISO timestamp, exclusive"),
      placement: z.string().optional().describe("inbox | spam | missing (warmup + seed)"),
      hasInbound: z.string().optional().describe("true | false — threads with / without an answer"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Threads page — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsThreadsResponse") } } },
    400: { description: "Downstream rejected the query (e.g. `limit` missing)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/messages",
  tags: ["Instantly"],
  summary: "List messages, newest first — every email of every typology (staff only)",
  description:
    "Platform-scoped staff read from instantly-service's unified sending model (cross-org ops "
    + "data, NOT customer data) — powers the rebuilt staff 'Audit → Instantly' page. Staff-only "
    + "(platform API key + STAFF_EMAILS x-email); no org context. "
    + "Transparent byte passthrough to instantly-service GET /internal/ops/messages: one row per message, "
    + "with the same filters as threads plus `threadId`. The body is not inline — read it from "
    + "GET /v1/instantly/ops/messages/{id}/body. "
    + "The query string is forwarded verbatim, so any filter instantly-service accepts can be asked for; "
    + "the parameters below are the ones it documents today, not a whitelist this gateway enforces. "
    + "`limit` is REQUIRED downstream (there is no silent default) — omitting it answers instantly-service's own 400.",
  security: platformAuth,
  request: {
    query: z.object({
      limit: z.coerce.number().int().describe("REQUIRED downstream. Page size — there is no default; a caller states how much it wants."),
      cursor: z.string().optional().describe("Opaque, from the previous page's nextCursor"),
      kind: z.string().optional().describe("outreach | manual_reply | warmup | warmup_reply | seed | reply | auto_reply | bounce"),
      direction: z.string().optional().describe("in | out"),
      account: z.string().optional().describe("Sending address"),
      mailbox: z.string().optional().describe("Real mailbox login"),
      domain: z.string().optional().describe("Sending domain"),
      counterparty: z.string().optional().describe("Substring match on the other party"),
      orgId: z.string().optional(),
      campaignId: z.string().optional().describe("The caller campaign id"),
      since: z.string().optional().describe("ISO timestamp, inclusive"),
      until: z.string().optional().describe("ISO timestamp, exclusive"),
      placement: z.string().optional().describe("inbox | spam | missing (warmup + seed)"),
      threadId: z.string().optional(),
    }).passthrough(),
  },
  responses: {
    200: { description: "Messages page — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsMessagesResponse") } } },
    400: { description: "Downstream rejected the query (e.g. `limit` missing)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/sent-per-period",
  tags: ["Instantly"],
  summary: "Count emails sent per day / week / month, to leads apart from warmup and seeds (staff only)",
  description:
    "Platform-scoped staff read from instantly-service's unified sending model (cross-org ops "
    + "data, NOT customer data) — powers the staff 'Monitoring → Emails' page. Staff-only "
    + "(platform API key + STAFF_EMAILS x-email); no org context. "
    + "Transparent byte passthrough to instantly-service GET /internal/ops/sent-per-period: every UTC period "
    + "from the first send (or `since`) to the current one, zeros included, with the count of emails sent per "
    + "purpose (toLeads, manualReplies, warmup, warmupReplies, seeds), distinct leads emailed, and `inProgress` "
    + "on the current period. The query string is forwarded verbatim; the parameters below are the ones "
    + "instantly-service documents today, not a whitelist. `grain` is REQUIRED downstream — omitting it "
    + "answers instantly-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      grain: z.string().describe("REQUIRED downstream. day | week | month (UTC; a week starts Monday)"),
      since: z.string().optional().describe("ISO timestamp; the series starts at the period containing it"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Periods — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsSentPerPeriodResponse") } } },
    400: { description: "Downstream rejected the query (e.g. `grain` missing)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/messages/{id}/body",
  tags: ["Instantly"],
  summary: "Get the body of one message, read from its bronze source (staff only)",
  description:
    "Platform-scoped staff read from instantly-service's unified sending model (cross-org ops "
    + "data, NOT customer data) — powers the rebuilt staff 'Audit → Instantly' page. Staff-only "
    + "(platform API key + STAFF_EMAILS x-email); no org context. "
    + "Transparent byte passthrough to instantly-service GET /internal/ops/messages/{id}/body: the text and "
    + "html of one message from whichever bronze row it came from, with `source` naming that table. Warmup and "
    + "seed bodies are generated per send and not stored, so both read null. An unknown id answers the "
    + "downstream's own 404. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    params: z.object({
      id: z.string().describe("The message id from GET /v1/instantly/ops/messages"),
    }),
  },
  responses: {
    200: { description: "Message body — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsMessageBodyResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "No message with that id", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/checkout-sessions",
  tags: ["Billing"],
  summary: "Create Stripe checkout session",
  description: "Create a Stripe checkout session for purchasing credits or setting up a payment method.",
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
      description: "Checkout session created — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("BillingCheckoutResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/accounts/charge",
  tags: ["Billing"],
  summary: "Charge a stated amount against the org's saved card",
  description:
    "Charges `amountCents` against the card the calling org already saved, off-session — no " +
    "redirect and no hosted page, so a customer paying for several things one at a time stays " +
    "on the page after the first (hosted) payment saved the card. The org charged is the " +
    "authenticated one (resolved from the Bearer key); no orgId is accepted in the body. " +
    "Transparent proxy to billing-service POST /internal/accounts/by-org/{orgId}/charge — " +
    "request body and response are owned by billing-service (passthrough). Every refusal " +
    "carries a stable `code` and reaches the caller field-for-field under billing's own status " +
    "(CLAUDE.md #7): 402 `charge_declined`, 409 `no_chargeable_payment_method`, 409 " +
    "`card_not_chargeable_off_session`, 429 `charge_backoff`, 502 `upstream_error`. The gateway " +
    "adds no retry or backoff of its own.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": { schema: ChargeSavedPaymentMethodRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description:
        "Charge settled — pass-through from billing-service (`{ ok, charged, amountCents, reference }`)",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ChargeSavedPaymentMethodResponse"),
        },
      },
    },
    400: { description: "Missing required field, or an amount below Stripe's minimum (billing-service)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    402: {
      description:
        "Card declined, no money taken. billing-service's body reaches the caller field-for-field " +
        "and carries `code: \"charge_declined\"`. Documented, not owned.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ChargeSavedPaymentMethodDeclined"),
        },
      },
    },
    409: {
      description:
        "Nothing chargeable: `code: \"no_chargeable_payment_method\"` (no card saved) or " +
        "`code: \"card_not_chargeable_off_session\"` (issuing country cannot be charged " +
        "off-session). Distinguish on `code`; both mean send the customer through hosted checkout.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ChargeSavedPaymentMethodUnavailable"),
        },
      },
    },
    429: {
      description:
        "Two distinct refusals share this status and are told apart by the body: " +
        "`code: \"charge_backoff\"` — billing-service is holding off after a recent failed " +
        "charge on this card; or the gateway's own rate limiter (body `error: \"Rate limit " +
        "exceeded\"`). Either way the caller decides when to retry — neither this gateway nor " +
        "billing-service retries on its behalf.",
      headers: {
        "Retry-After": {
          description: "Seconds to wait before retrying.",
          schema: { type: "integer" as const },
        },
      },
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ChargeSavedPaymentMethodBackoff"),
        },
      },
    },
    502: {
      description:
        "`code: \"upstream_error\"` — stripe-service unreachable. NOT a decline: no answer was " +
        "obtained, so the charge may be retried.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ChargeSavedPaymentMethodUpstreamError"),
        },
      },
    },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/portal-sessions",
  tags: ["Billing"],
  summary: "Create Stripe portal session",
  description: "Create a Stripe billing portal session for managing payment methods",
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
      description: "Portal session created — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("BillingPortalSessionResponse"),
        },
      },
    },
    400: { description: "No Stripe customer found", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    402: {
      description:
        "Refused by billing-service: the org carries a negative balance and the settle " +
        "charge failed, so it may not reach the portal to change its card. The body is " +
        "billing-service's and reaches the caller field-for-field (CLAUDE.md #7) — it " +
        "carries a stable `code` (`outstanding_balance_unsettled`) plus `owed_cents`, " +
        "`balance_cents` and `reason`. Documented, not owned: billing-service may add " +
        "fields without a change here.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("BillingPortalSessionRefusal"),
        },
      },
    },
    500: { description: "Internal error", content: errorContent },
  },
});

// Billing – Payments (proxy to stripe-service)
// Lists the calling org's payment history (its Stripe PaymentIntents / top-ups).
// Org resolved from the Bearer key; sourced from stripe-service internal
// /payment_intents/by-org/{orgId}. Full Stripe list, no pagination. Each item
// carries id, amount (cents), currency, status, created. Downstream owns the
// shape — passthrough only (CLAUDE.md #4/#8).
registry.registerPath({
  method: "get",
  path: "/v1/billing/payments",
  tags: ["Billing"],
  summary: "List the org's payment history",
  description:
    "Returns every payment (Stripe PaymentIntent / top-up) for the calling org, " +
    "scoped to the Bearer key's org (no orgId in the request). Sourced from " +
    "stripe-service GET /internal/payment_intents/by-org/{orgId}. Full set, no " +
    "pagination. Each PaymentIntent carries id, amount (cents), currency, status, " +
    "created. Response shape is owned by stripe-service — passthrough.",
  security: authed,
  responses: {
    200: {
      description: "Stripe PaymentIntent list — pass-through from stripe-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("OrgPaymentsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// Brand – Daily Budget (proxy to billing-service)
// Per-brand daily spend ceiling (pacing/allocation), SEPARATE from org credit
// balance/affordability. GET proxies billing /internal/brands/:brandId/daily-budget
// (unset -> dailyBudgetCents null); PATCH proxies billing /v1/brands/:brandId/daily-budget.
// Downstream owns body + response shapes — passthrough only (CLAUDE.md #8).
const BrandDailyBudgetParam = z.object({
  brandId: z.string().uuid().describe("Brand ID"),
});
const DailyBudgetResponseSchema = z.object({}).passthrough().openapi("DailyBudgetResponse");
const DailyBudgetRequestSchema = z
  .object({
    dailyBudgetCents: inboundCents.describe("Brand daily budget cap in cents (integer or decimal string)"),
  })
  .passthrough()
  .openapi("DailyBudgetRequest");

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/daily-budget",
  tags: ["Billing"],
  summary: "Get a brand's daily budget",
  description:
    "Proxy to billing-service GET /internal/brands/{brandId}/daily-budget. " +
    "Returns the brand's current daily spend ceiling (per-day pacing/allocation " +
    "value, separate from org credit balance/affordability). An unset brand returns " +
    "{ dailyBudgetCents: null }. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandDailyBudgetParam },
  responses: {
    200: { description: "Brand daily budget (dailyBudgetCents null when unset)", content: { "application/json": { schema: DailyBudgetResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/brands/{brandId}/daily-budget",
  tags: ["Billing"],
  summary: "Set a brand's daily budget",
  description:
    "Proxy to billing-service PATCH /v1/brands/{brandId}/daily-budget. " +
    "Sets the brand's daily spend ceiling. Body { dailyBudgetCents } (number or " +
    "decimal string, >= 0; 0 = pause). Identity headers (x-org-id, x-user-id, " +
    "x-run-id) are forwarded. Body + response shapes are owned by the downstream " +
    "service; its 4xx validation errors propagate verbatim.",
  security: authed,
  request: {
    params: BrandDailyBudgetParam,
    body: { content: { "application/json": { schema: DailyBudgetRequestSchema } } },
  },
  responses: {
    200: { description: "Updated brand daily budget", content: { "application/json": { schema: DailyBudgetResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: {
      description:
        "Brand is funded PER FUNNEL — the brand-level write is refused. Status and body " +
        "are billing's, forwarded field-for-field.",
      content: errorContent,
    },
    500: { description: "Upstream error", content: errorContent },
  },
});

// Brand – Per-campaign daily budgets (proxy to billing-service, #500)
// Campaign = (offer × leg × acquisition channel), no funnel. billing owns the three-part key,
// the minimums and the consolidation rule — the gateway declares none of it (CLAUDE.md #4/#8).
const BrandBudgetParam = z.object({
  brandId: z.string().uuid().describe("Brand ID"),
});
const CampaignBudgetsResponseSchema = z.object({}).passthrough().openapi("CampaignBudgetsResponse");
const CampaignBudgetResponseSchema = z.object({}).passthrough().openapi("CampaignBudgetResponse");
const CampaignBudgetRequestSchema = z.object({}).passthrough().openapi("CampaignBudgetRequest");
const CampaignBudgetQuery = z
  .object({
    offerId: z.string().optional().describe("Offer ID (required by billing-service)"),
    legKey: z.string().optional().describe("Leg key (required by billing-service)"),
    featureSlug: z.string().optional().describe("Acquisition channel feature slug (required by billing-service)"),
  })
  .passthrough();

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/campaign-budgets",
  tags: ["Billing"],
  summary: "List a brand's per-campaign daily budgets",
  description:
    "Proxy to billing-service GET /v1/brands/{brandId}/campaign-budgets. Every campaign (offer x leg x channel) " +
    "daily ceiling for the calling org + brand, summing to the brand total. Response shape owned downstream.",
  security: authed,
  request: {
    params: BrandBudgetParam,
  },
  responses: {
    200: { description: "Downstream body, untouched", content: { "application/json": { schema: CampaignBudgetsResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/campaign-budget",
  tags: ["Billing"],
  summary: "Get one campaign's daily budget",
  description:
    "Proxy to billing-service GET /v1/brands/{brandId}/campaign-budget. One campaign's daily ceiling, keyed by " +
    "?offerId=&legKey=&featureSlug= (null when unfunded). Query forwarded verbatim; these are the params documented today, not a whitelist.",
  security: authed,
  request: {
    params: BrandBudgetParam, query: CampaignBudgetQuery,
  },
  responses: {
    200: { description: "Downstream body, untouched", content: { "application/json": { schema: CampaignBudgetResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{brandId}/campaign-budget",
  tags: ["Billing"],
  summary: "Set one campaign's daily budget",
  description:
    "Proxy to billing-service PUT /v1/brands/{brandId}/campaign-budget. Body { offerId, legKey, featureSlug, " +
    "dailyBudgetCents }; key vocabulary, minimums and consolidation are owned downstream; its 4xx propagate verbatim.",
  security: authed,
  request: {
    params: BrandBudgetParam,
    body: { content: { "application/json": { schema: CampaignBudgetRequestSchema } } },
  },
  responses: {
    200: { description: "Downstream body, untouched", content: { "application/json": { schema: CampaignBudgetResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

const SalesBudgetResponseSchema = z.object({}).passthrough().openapi("SalesBudgetResponse");
const SalesBudgetRequestSchema = z.object({}).passthrough().openapi("SalesBudgetRequest");
const salesBudgetResponses = {
  200: { description: "Downstream body, untouched", content: { "application/json": { schema: SalesBudgetResponseSchema } } },
  400: { description: "Validation error (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  500: { description: "Upstream error", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/sales-budget",
  tags: ["Billing"],
  summary: "Get a brand's funding mode and global sales budget",
  description:
    "Proxy to billing-service GET /v1/brands/{brandId}/sales-budget. { mode: global|campaigns, dailyBudgetCents, updatedAt }. Response shape owned downstream.",
  security: authed,
  request: { params: BrandBudgetParam },
  responses: salesBudgetResponses,
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{brandId}/sales-budget",
  tags: ["Billing"],
  summary: "State a brand's one daily sales budget (global mode)",
  description:
    "Proxy to billing-service PUT /v1/brands/{brandId}/sales-budget. Body { dailyBudgetCents } (>= 0). Campaign ceilings untouched; 4xx propagate verbatim.",
  security: authed,
  request: { params: BrandBudgetParam, body: { content: { "application/json": { schema: SalesBudgetRequestSchema } } } },
  responses: salesBudgetResponses,
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{brandId}/sales-budget",
  tags: ["Billing"],
  summary: "Clear a brand's global sales budget (back to campaign ceilings)",
  description: "Proxy to billing-service DELETE /v1/brands/{brandId}/sales-budget. Idempotent.",
  security: authed,
  request: { params: BrandBudgetParam },
  responses: salesBudgetResponses,
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/sales-budget/history",
  tags: ["Billing"],
  summary: "Every state and clear of a brand's global sales budget",
  description: "Proxy to billing-service GET /v1/brands/{brandId}/sales-budget/history.",
  security: authed,
  request: { params: BrandBudgetParam },
  responses: salesBudgetResponses,
});

// Brand x offer – per-campaign budgets (proxy to billing-service). billing owns the
// items, minimums, caps and refusal codes; the gateway declares none of it (#4/#8).
const OfferCampaignBudgetsParams = z.object({
  brandId: z.string().describe("Brand ID"),
  offerId: z.string().describe("Offer ID"),
});
const OfferCampaignBudgetsRequestSchema = z.object({}).passthrough().openapi("OfferCampaignBudgetsRequest");
const OfferCampaignBudgetsResponseSchema = z.object({}).passthrough().openapi("OfferCampaignBudgetsResponse");
const offerCampaignBudgetsResponses = {
  200: { description: "Billing's body, forwarded untouched", content: { "application/json": { schema: OfferCampaignBudgetsResponseSchema } } },
  400: { description: "Refused by billing (e.g. code below_minimum, reactive_above_cap, entry_item_required), body forwarded verbatim", content: errorContent },
  409: { description: "Conflict from billing (e.g. code no_plan_for_offer, reactive_charge_declined), body forwarded verbatim", content: errorContent },
  502: { description: "Billing dependency unavailable (e.g. code minimums_unavailable, campaign_status_unavailable, charge_unavailable), body forwarded verbatim", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/offers/{offerId}/campaign-budgets",
  tags: ["Billing"],
  summary: "Read the budget of each campaign (channel x leg) of an offer",
  description:
    "Proxy to billing-service GET /v1/brands/{brandId}/offers/{offerId}/campaign-budgets. The query string is forwarded verbatim; documented params are today's, not a whitelist. Response shape owned downstream.",
  security: authed,
  request: {
    params: OfferCampaignBudgetsParams,
    query: z.object({ campaigns: z.string().optional().describe("Comma-separated featureSlug:legKey pairs to narrow the read") }).passthrough(),
  },
  responses: offerCampaignBudgetsResponses,
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{brandId}/offers/{offerId}/campaign-budgets",
  tags: ["Billing"],
  summary: "Set the budgets of campaigns (channel x leg) of an offer",
  description:
    "Proxy to billing-service PUT /v1/brands/{brandId}/offers/{offerId}/campaign-budgets. Body { items: [{ featureSlug, legKey, budgetCents }] }, forwarded untouched. Status and body (with code) of every refusal propagate verbatim.",
  security: authed,
  request: { params: OfferCampaignBudgetsParams, body: { content: { "application/json": { schema: OfferCampaignBudgetsRequestSchema } } } },
  responses: offerCampaignBudgetsResponses,
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{brandId}/offers/{offerId}/campaign-budgets",
  tags: ["Billing"],
  summary: "Remove the budget of one campaign (channel x leg) of an offer",
  description:
    "Proxy to billing-service DELETE /v1/brands/{brandId}/offers/{offerId}/campaign-budgets?featureSlug=&legKey=. The query string is forwarded verbatim.",
  security: authed,
  request: {
    params: OfferCampaignBudgetsParams,
    query: z
      .object({
        featureSlug: z.string().optional().describe("Channel feature slug (required by billing-service)"),
        legKey: z.string().optional().describe("Leg key (required by billing-service)"),
      })
      .passthrough(),
  },
  responses: offerCampaignBudgetsResponses,
});

// ===================================================================
// TRANSACTIONAL EMAILS
// ===================================================================

export const SendEmailRequestSchema = z
  .object({
    eventType: z.string().min(1).describe("Event type determining which template to use (e.g. 'webinar_welcome', 'j_minus_1')"),
    recipientEmail: z.string().email().optional().describe("Direct recipient email (fallback when no userId on the key)"),
    bccEmails: z.array(z.string().email()).optional().describe("True blind-copy recipients (BCC). Forwarded top-level to transactional-email-service as bccEmails; never rendered as visible To/Cc and never injected into template metadata."),
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

// ───────────────────────────────────────────────────────────────────────────
// Manual reply qualifications (forwarded to email-gateway → instantly-service)
// ───────────────────────────────────────────────────────────────────────────

// The route forwards `req.body` byte-identical and parses nothing, so this schema is a
// DESCRIPTION of a passthrough, never its contract. It used to re-declare the status
// vocabulary as a closed 8-value enum; instantly-service has since reshaped it (the two
// deal-progress values moved out to the lead-outcomes service, and the positive case
// split four ways), so the enum documented three values that no longer mean what they
// said and omitted four that work today. Nothing broke — the wire was never gated on it
// — but a reader checking the registry before wiring a consumer is told the new values
// will be rejected, which is worse than saying nothing. `.passthrough()` with the
// vocabulary named upstream: this gateway does not own that shape (rule #8).
export const ManualQualificationCreateRequestSchema = z
  .object({
    campaign_id: z.string().min(1).describe("Logical campaign id (groups sub-campaigns for the same workflow run)"),
    email: z.string().email().describe("Lead email address"),
    status: z.string().min(1).describe(
      "What a human states about the reply. instantly-service owns this vocabulary and is the only place it is authoritative — refer to its openapi.json rather than to this line, which cannot be kept in lockstep across a deploy boundary.",
    ),
    notes: z.string().max(2000).optional().describe("Optional free-text human note for audit"),
  })
  .passthrough()
  .openapi("ManualQualificationCreateRequest");

registry.registerPath({
  method: "get",
  path: "/v1/emails",
  tags: ["Emails"],
  summary: "List generated emails by brand",
  description:
    "List all generated emails across campaigns for a brand. Returns the same enriched shape as GET /campaigns/{id}/emails. " +
    "Proxies to content-generation-service GET /generations. The query string is forwarded verbatim, so every filter " +
    "content-generation-service accepts can be asked for; the parameters below are the ones it documents today, not a " +
    "whitelist this gateway enforces. brandId is the one this gateway itself requires.",
  security: authed,
  request: {
    query: z
      .object({
        brandId: z.string().uuid().openapi({ description: "Brand ID (required)" }),
        campaignId: z.string().uuid().optional().openapi({ description: "Optional campaign ID filter" }),
        limit: z.coerce.number().int().optional().openapi({ description: "Max results to return" }),
        offset: z.coerce.number().int().optional().openapi({ description: "Offset for pagination" }),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "Generated emails with run cost data",
      content: {
        "application/json": {
          schema: z
            .object({
              emails: z.array(
                z.object({
                  id: z.string().describe("Generation ID"),
                  campaignId: z.string(),
                  subject: z.string().nullable(),
                  bodyHtml: z.string().nullable(),
                  bodyText: z.string().nullable(),
                  sequence: z.number().nullable(),
                  leadFirstName: z.string().nullable(),
                  leadLastName: z.string().nullable(),
                  leadCompany: z.string().nullable(),
                  leadOrganizationDomain: z.string().nullable(),
                  leadTitle: z.string().nullable(),
                  leadIndustry: z.string().nullable(),
                  clientCompanyName: z.string().nullable(),
                  generationRunId: z.string().nullable(),
                  createdAt: z.string(),
                  generationRun: RunCostDataSchema.nullable(),
                }),
              ),
            })
            .openapi("BrandEmailsResponse"),
        },
      },
    },
    400: { description: "Missing brandId", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/emails/by-lead/{leadId}",
  tags: ["Emails"],
  summary: "Get the generated email for a lead",
  description:
    "The generated email (subject + body + follow-up sequence) for a single lead. " +
    "Transparent proxy to content-generation-service GET /generations/by-lead/{leadId}; body forwarded verbatim. " +
    "The query string is forwarded verbatim too, so the scope the caller asks for decides which of the person's " +
    "generations comes back; the parameters below are the ones content-generation-service documents today, not a " +
    "whitelist this gateway enforces. " +
    "Returns { generation: null } when no email has been generated for the lead yet (a normal empty state, not an error).",
  security: authed,
  request: {
    params: z.object({
      leadId: z.string().openapi({ description: "Lead ID" }),
    }),
    query: z
      .object({
        brandId: z
          .string()
          .optional()
          .describe("Scope the read to one brand — a person contacted by several brands of one org has one generation per brand"),
        campaignId: z
          .string()
          .optional()
          .describe(
            "Scope the read to one campaign — a person contacted by several campaigns of one brand has one generation per " +
              "campaign, and this returns that campaign's. Omit it and no campaign is inferred; the campaign a returned " +
              "generation belongs to is always on the row as campaignId.",
          ),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "The lead's generated email, or null if none exists yet (passthrough — owned by content-generation-service)",
      content: {
        "application/json": {
          // Passthrough per CLAUDE.md #8 — downstream owns the generation shape; do NOT re-declare fields.
          schema: z
            .object({ generation: z.object({}).passthrough().nullable() })
            .passthrough()
            .openapi("EmailByLeadResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/workflow-examples",
  tags: ["Emails"],
  summary: "List example emails for a workflow",
  description:
    "Example emails per workflow for the workflow picker — a brand→org→global cascade of past generations. " +
    "Transparent proxy to content-generation-service GET /generations/examples; body and query string both forwarded " +
    "verbatim — the parameters below are the ones content-generation-service documents today, not a whitelist. " +
    "Each example carries the email fields plus scope ('brand'|'org'|'global') and brandName.",
  security: authed,
  request: {
    query: z
      .object({
        workflowSlug: z.string().openapi({ description: "Workflow slug (required)" }),
        brandId: z.string().uuid().optional().openapi({ description: "Optional brand ID for the brand-scoped cascade tier" }),
        limit: z.coerce.number().int().optional().openapi({ description: "Max examples to return" }),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "Example emails (passthrough — owned by content-generation-service)",
      content: {
        "application/json": {
          // Passthrough per CLAUDE.md #8 — downstream owns the ExampleEmail shape; do NOT re-declare fields.
          schema: z
            .object({ examples: z.array(z.object({}).passthrough()) })
            .passthrough()
            .openapi("WorkflowExamplesResponse"),
        },
      },
    },
    400: { description: "Missing workflowSlug", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

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
  method: "post",
  path: "/v1/emails/manual-qualifications",
  tags: ["Emails"],
  summary: "Set a manual reply qualification for a (campaign, lead) pair",
  description:
    "Record a human-set reply classification for a lead in a campaign. Used when Instantly's automatic webhook reply " +
    "classification fails to detect a reply (e.g. the reply was sent to a non-leurre account that Instantly does not monitor). " +
    "Idempotent: re-POSTing the same status for the same (campaign, lead) returns `idempotent: true` with the existing row. " +
    "Transparent proxy to email-gateway → instantly-service; the response shape is owned upstream.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: ManualQualificationCreateRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Manual qualification recorded (or idempotent no-op)",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ManualQualificationCreateResponse"),
        },
      },
    },
    400: { description: "Validation error from upstream", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "(campaign, lead) not found in caller's org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/emails/manual-qualifications",
  tags: ["Emails"],
  summary: "List manual reply qualifications (org-scoped audit history)",
  description:
    "Returns the caller-org's manual qualification history, sorted by `qualifiedAt` DESC. Cross-org rows are blocked " +
    "at the instantly-service layer. The query string is forwarded verbatim, so any filter instantly-service accepts " +
    "can be asked for; the parameters below are the ones it documents today, not a whitelist this gateway enforces. " +
    "Transparent proxy to email-gateway → instantly-service; the response shape is owned upstream.",
  security: authed,
  request: {
    query: z
      .object({
        campaign_id: z.string().min(1).optional().describe("Filter by logical campaign id"),
        email: z.string().email().optional().describe("Filter by lead email"),
        limit: z.coerce.number().int().optional().describe("Max rows to return (upstream default 200, max 500)"),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "List of manual qualifications",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ManualQualificationListResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/emails/manual-qualifications/withdrawals",
  tags: ["Emails"],
  summary: "Take back the standing manual reply qualification for a (campaign, lead) pair",
  description:
    "The undo of POST /v1/emails/manual-qualifications, for a person who picked the wrong kind by mistake. After " +
    "the withdrawal the lead reads as it did before anybody said anything: no standing human statement, and the " +
    "automatic classification takes over again. It is a correction, not an erasure — the statement stays on " +
    "record carrying who withdrew it and when. " +
    "The body is forwarded byte-identical and this gateway never enumerates the reply-kind vocabulary; " +
    "instantly-service owns it. Withdrawing when nothing stands answers 404 with a `code` saying which " +
    "(`no_standing_qualification`, including a second withdrawal of the same statement, or `campaign_not_found`), " +
    "and that status and body reach the caller unchanged so a surface can tell them apart from a server failure. " +
    "Transparent proxy to email-gateway → instantly-service; the response shape is owned upstream.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ManualQualificationWithdrawalRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The standing statement was withdrawn, as returned upstream",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("ManualQualificationWithdrawalResponse"),
        },
      },
    },
    400: { description: "Validation error from upstream", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Nothing to withdraw for this (campaign, lead) pair in the caller's org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/emails/opt-outs",
  tags: ["Emails"],
  summary: "Record that a person asked a human to stop contacting them",
  description:
    "A prospect rarely clicks the unsubscribe link: they send an SMS, they call, they reply to a thread somebody " +
    "forwarded them, they say it in person. This records that statement — it is never inferred — and instantly-service " +
    "then honours it: the sending stops and the person reads as unsubscribed on the delivery status. " +
    "Scope is the PERSON, not a campaign, and the row is a consent record: who stated it, when, and through which channel. " +
    "Re-recording a standing opt-out is idempotent. " +
    "The body is forwarded byte-identical and this gateway never enumerates the channel vocabulary; instantly-service " +
    "owns it, so a value it rejects comes back as its own refusal rather than a local 400. " +
    "Transparent proxy to email-gateway → instantly-service; the response shape is owned upstream.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("OptOutCreateRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Opt-out recorded (or idempotent no-op), as returned upstream",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("OptOutCreateResponse"),
        },
      },
    },
    400: { description: "Validation error from upstream", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/emails/opt-outs",
  tags: ["Emails"],
  summary: "The org's recorded opt-out log",
  description:
    "Every opt-out recorded by a human for the caller's org, newest first. Withdrawn records are returned too and " +
    "carry the withdrawal — hiding them would destroy the audit — so a surface reads that field rather than assuming " +
    "every row still stands. Cross-org rows are blocked at the instantly-service layer. " +
    "The query string is forwarded verbatim, so any filter instantly-service accepts can be asked for; the parameters " +
    "below are the ones it documents today, not a whitelist this gateway enforces. " +
    "Transparent proxy to email-gateway → instantly-service; the response shape is owned upstream.",
  security: authed,
  request: {
    query: z
      .object({
        email: z.string().optional().describe("Filter by the person's email address"),
        standing_only: z
          .string()
          .optional()
          .describe("Return only records that still stand (upstream default false — withdrawn records are part of the audit)"),
        limit: z.coerce.number().int().optional().describe("Max rows to return (upstream default 200, max 500)"),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "The org's recorded opt-outs, as returned upstream",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("OptOutListResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/emails/opt-outs/withdrawals",
  tags: ["Emails"],
  summary: "Withdraw the standing recorded opt-out for a person",
  description:
    "The undo of POST /v1/emails/opt-outs, for an opt-out recorded on the wrong person or a prospect who came back " +
    "and asked to hear from us again. After it the person stops reading as unsubscribed. " +
    "It is a correction, not an erasure: the record stays on file carrying who withdrew it and when, and it releases " +
    "the opt-out without resuming the sequences it stopped. " +
    "The body is forwarded byte-identical. Withdrawing when nothing stands answers 404 with a `code` saying which, " +
    "and that status and body reach the caller unchanged so a surface can tell it apart from a server failure. " +
    "Transparent proxy to email-gateway → instantly-service; the response shape is owned upstream.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("OptOutWithdrawalRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The standing opt-out was withdrawn, as returned upstream",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("OptOutWithdrawalResponse"),
        },
      },
    },
    400: { description: "Validation error from upstream", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Nothing to withdraw for this person in the caller's org", content: errorContent },
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
    mode: z.literal("payment").optional().describe("Checkout mode (payment only)"),
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
    "Create a Stripe Checkout session for one-time payment. Returns the checkout URL to redirect the customer.",
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
    limit: z.coerce.number().int().positive().optional().describe("Max results to return"),
    offset: z.coerce.number().int().min(0).optional().describe("Pagination offset"),
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

// -- /v1/platform/llm-context (overview — lightweight, no inline endpoints) --

const LlmServiceOverviewSchema = z
  .object({
    service: z.string().describe("Service name"),
    title: z.string().optional().describe("Service title"),
    description: z.string().optional().describe("Service description"),
    error: z.string().optional().describe("Error message if service metadata could not be loaded"),
    endpointCount: z.number().describe("Number of endpoints exposed by this service"),
  })
  .openapi("LlmServiceOverview");

const LlmContextResponseSchema = z
  .object({
    _description: z.string().describe("Description of this context payload"),
    _workflow: z.string().describe("Progressive-disclosure workflow: overview first, then drill into a service"),
    serviceCount: z.number().describe("Total number of registered services"),
    services: z.array(LlmServiceOverviewSchema).describe("Lightweight service list (use /llm-context/{service} for endpoints)"),
  })
  .openapi("LlmContextResponse");

// -- /v1/platform/llm-context/{service} (drill-down — endpoint details) --

const LlmEndpointSummarySchema = z
  .object({
    method: z.string().describe("HTTP method"),
    path: z.string().describe("Endpoint path"),
    summary: z.string().describe("Endpoint summary"),
  })
  .openapi("LlmEndpointSummary");

const LlmEndpointGroupSchema = z
  .object({
    group: z.string().describe("Path group prefix"),
    endpointCount: z.number().describe("Number of endpoints in this group"),
    endpoints: z.array(LlmEndpointSummarySchema).describe("Endpoints in this group"),
  })
  .openapi("LlmEndpointGroup");

const LlmServiceDetailResponseSchema = z
  .object({
    service: z.string().describe("Service name"),
    title: z.string().optional().describe("Service title"),
    description: z.string().optional().describe("Service description"),
    endpointCount: z.number().optional().describe("Number of endpoints returned"),
    endpoints: z.array(LlmEndpointSummarySchema).optional().describe("Flat endpoint list (for small services)"),
    totalEndpoints: z.number().optional().describe("Total endpoints (when grouped)"),
    groupCount: z.number().optional().describe("Number of groups (when grouped)"),
    groups: z.array(LlmEndpointGroupSchema).optional().describe("Grouped endpoints (for large services with 30+ endpoints)"),
  })
  .openapi("LlmServiceDetailResponse");

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

// Content – Generate Expert Quote Pitch (proxy to content-generation-service)
// Downstream owns body + response shapes — passthrough only.
const GenerateExpertQuotePitchRequestSchema = z.object({}).passthrough().openapi("GenerateExpertQuotePitchRequest");
const GenerateExpertQuotePitchResponseSchema = z.object({}).passthrough().openapi("GenerateExpertQuotePitchResponse");

registry.registerPath({
  method: "post",
  path: "/v1/content/generate-expert-quote-pitch",
  tags: ["Content"],
  summary: "Generate a journalist-quote pitch",
  description:
    "Proxy to content-generation-service POST /generate-expert-quote-pitch. " +
    "Generates a Featured.com-compliant pitch (100-2500 char constraint) for an expert journalist quote opportunity. " +
    "Body + response shapes are owned by the downstream service.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: GenerateExpertQuotePitchRequestSchema } } },
  },
  responses: {
    200: { description: "Pitch generated", content: { "application/json": { schema: GenerateExpertQuotePitchResponseSchema } } },
    400: { description: "Content-generation length error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// Content – Preview Email (proxy to content-generation-service)
// Downstream owns body + response shapes — passthrough only.
const PreviewEmailRequestSchema = z.object({}).passthrough().openapi("PreviewEmailRequest");
const PreviewEmailResponseSchema = z.object({}).passthrough().openapi("PreviewEmailResponse");

registry.registerPath({
  method: "post",
  path: "/v1/content/preview-email",
  tags: ["Content"],
  summary: "Write one cold email for a brand and a sample recipient",
  description:
    "Proxy to content-generation-service POST /preview-email. Writes the first email of the sequence the product " +
    "would send, for a brand of the calling org and a sample recipient, before any campaign exists. The LLM spend is " +
    "billed to the calling org; an org that cannot afford it gets 402 with the downstream body forwarded field-for-field. " +
    "Body + response shapes are owned by the downstream service.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: PreviewEmailRequestSchema } } },
  },
  responses: {
    200: { description: "The written email", content: { "application/json": { schema: PreviewEmailResponseSchema } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    402: { description: "The org cannot afford the completion (forwarded verbatim)", content: errorContent },
    404: { description: "Brand or offer not found for this org (forwarded verbatim)", content: errorContent },
    409: { description: "The brand sells several offers; name one with offerId (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream failure (forwarded verbatim)", content: errorContent },
  },
});

// Content – Preview Email Prepare (proxy to content-generation-service)
// Downstream owns body + response shapes — passthrough only.
const PreviewEmailPrepareRequestSchema = z.object({}).passthrough().openapi("PreviewEmailPrepareRequest");
const PreviewEmailPrepareResponseSchema = z.object({}).passthrough().openapi("PreviewEmailPrepareResponse");

registry.registerPath({
  method: "post",
  path: "/v1/content/preview-email/prepare",
  tags: ["Content"],
  summary: "Get ready to write preview emails for a brand (fire and forget)",
  description:
    "Proxy to content-generation-service POST /preview-email/prepare. Starts, in the background, the brand read " +
    "POST /v1/content/preview-email will need for this brand, so the first preview only waits for the model. " +
    "Answers 202 at once with the downstream body and status forwarded as-is; idempotent per org + brand. " +
    "The brand read is billed to the calling org. Body + response shapes are owned by the downstream service " +
    "(today: body { brandId, offerId? }, response { brandId, status }).",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: PreviewEmailPrepareRequestSchema } } },
  },
  responses: {
    202: {
      description: "Warm-up started, already running, or recently completed",
      content: { "application/json": { schema: PreviewEmailPrepareResponseSchema } },
    },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Upstream failure (forwarded verbatim)", content: errorContent },
  },
});

// Content – Get Platform Prompt (proxy to content-generation-service)
// Downstream owns response shape — passthrough only.
const PlatformPromptResponseSchema = z.object({}).passthrough().openapi("PlatformPromptResponse");

registry.registerPath({
  method: "get",
  path: "/v1/content/platform-prompts",
  tags: ["Content"],
  summary: "Get a prompt template by type",
  description:
    "Proxy to content-generation-service GET /platform-prompts?type=<type>. " +
    "Returns the stored prompt template + its variable metadata so callers can collect inputs " +
    "before invoking POST /v1/content/generate-expert-quote-pitch. " +
    "Response shape is owned by the downstream service.",
  security: authed,
  request: {
    query: z.object({ type: z.string().openapi({ description: "Prompt type to look up (e.g. expert-quote-pitch)" }) }),
  },
  responses: {
    200: { description: "Prompt template", content: { "application/json": { schema: PlatformPromptResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Prompt type not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// Content – Prompt Assignments (proxy to content-generation-service)
// Downstream owns body + response shapes — passthrough only. No gateway re-validation.
const PromptAssignmentResponseSchema = z.object({}).passthrough().openapi("PromptAssignmentResponse");
const PromptAssignmentRequestSchema = z.object({}).passthrough().openapi("PromptAssignmentRequest");

registry.registerPath({
  method: "get",
  path: "/v1/content/prompt-assignments",
  tags: ["Content"],
  summary: "Get a feature's assigned generation prompt",
  description:
    "Proxy to content-generation-service GET /prompt-assignments?featureSlug=<slug>. " +
    "Returns the prompt currently assigned to a feature + its variable metadata so the " +
    "dashboard prompt editor can read the prompt the feature's GENERATE step uses. " +
    "Response shape is owned by the downstream service.",
  security: authed,
  request: {
    query: z.object({ featureSlug: z.string().openapi({ description: "Feature slug whose assigned prompt to fetch (e.g. pr-expert-quote-opportunities)" }) }),
  },
  responses: {
    200: { description: "Assigned prompt", content: { "application/json": { schema: PromptAssignmentResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No assignment for featureSlug (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/content/prompt-assignments",
  tags: ["Content"],
  summary: "Save a feature's generation prompt",
  description:
    "Proxy to content-generation-service PUT /prompt-assignments. " +
    "Saves the feature's generation prompt (forks + reassigns downstream). " +
    "Body + response shapes are owned by the downstream service; its 400 variable-integrity " +
    "errors propagate verbatim.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: PromptAssignmentRequestSchema } } },
  },
  responses: {
    200: { description: "Prompt saved", content: { "application/json": { schema: PromptAssignmentResponseSchema } } },
    400: { description: "Variable-integrity error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/platform/llm-context",
  tags: ["Platform"],
  summary: "Get LLM-friendly platform overview",
  description:
    "Returns a lightweight overview of all platform services (name, description, endpoint count). " +
    "Proxied from api-registry. Use GET /v1/platform/llm-context/{service} to drill into a specific service's endpoints.",
  security: authed,
  responses: {
    200: {
      description: "Lightweight service overview for LLM consumption",
      content: { "application/json": { schema: LlmContextResponseSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/platform/llm-context/{service}",
  tags: ["Platform"],
  summary: "Get LLM-friendly endpoint details for a service",
  description:
    "Returns endpoint details for a specific service. Supports filtering by method, path group, or path prefix. " +
    "Large services (30+ endpoints) auto-group by path prefix. Proxied from api-registry.",
  security: authed,
  request: {
    params: z.object({
      service: z.string().describe("Service name"),
    }),
    query: z.object({
      method: z.string().optional().describe("Filter by HTTP method (e.g. 'POST')"),
      group: z.string().optional().describe("Filter by path group (e.g. 'campaigns')"),
      pathPrefix: z.string().optional().describe("Filter by path prefix (e.g. '/v1/campaigns')"),
    }),
  },
  responses: {
    200: {
      description: "Endpoint list for the service (flat or grouped depending on size)",
      content: { "application/json": { schema: LlmServiceDetailResponseSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Service not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});


// ===================================================================
// FEATURES (proxy to features-service)
// ===================================================================

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
      status: z.string().optional().describe("Filter by status (defaults to 'active')"),
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
  path: "/v1/features/{slug}",
  tags: ["Features"],
  summary: "Get feature by versioned slug",
  description: "Get a single feature definition by its slug. Proxied from features-service.",
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
  method: "get",
  path: "/v1/features/entities/registry",
  tags: ["Features"],
  summary: "Entity type registry",
  description: "Complete entity type registry — label, icon, pathSuffix, and description for each entity type. Proxied from features-service.",
  security: authed,
  responses: {
    200: { description: "Entity type registry", content: { "application/json": { schema: z.object({}).passthrough().openapi("EntitiesRegistryResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
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
    "Aggregated stats across all features. Supports groupBy (featureSlug, featureDynastySlug, workflowSlug, workflowDynastySlug, brandId, campaignId) and optional filters. Proxied from features-service.",
  security: authed,
  request: {
    query: z.object({
      groupBy: z.string().optional().openapi({ example: "featureSlug" }).describe("Group dimension: featureSlug, featureDynastySlug, workflowSlug, workflowDynastySlug, brandId, campaignId"),
      brandId: z.string().optional().openapi({ example: "brand-uuid-123" }).describe("Filter by brand UUID"),
      campaignId: z.string().optional().describe("Filter by campaign UUID"),
      featureSlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature slug"),
      workflowSlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-sienna-v3" }).describe("Filter by exact workflow slug"),
      featureDynastySlug: z.string().optional().openapi({ example: "pr-cold-email-outreach" }).describe("Filter by feature slug (legacy param name)"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug"),
    }),
  },
  responses: {
    200: { description: "Global stats", content: { "application/json": { schema: z.object({}).passthrough().openapi("GlobalStatsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/features/{featureSlug}/prefill",
  tags: ["Features"],
  summary: "Prefill feature inputs from brand data",
  description:
    "Calls brand-service to extract field values for the feature's inputs. Returns pre-filled values keyed by input key. " +
    "Requires brandIds in the request body. Use ?format=text for flattened strings, ?format=full for structured values with per-brand breakdown. " +
    "Proxied from features-service.",
  security: authed,
  request: {
    params: z.object({ featureSlug: z.string().openapi({ example: "pr-cold-email-outreach" }).describe("Feature slug") }),
    query: z.object({
      format: z.enum(["text", "full"]).optional().describe("Response format: 'text' returns flattened strings, 'full' returns structured values with per-brand breakdown"),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            brandIds: z.array(z.string()).openapi({ example: ["brand-uuid-123"] }).describe("Non-empty array of brand UUIDs to prefill from"),
          }).openapi("PrefillFeatureRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Pre-filled input values",
      content: {
        "application/json": {
          schema: z.object({
            slug: z.string(),
            brandId: z.string(),
            format: z.enum(["text", "full"]),
            prefilled: z.record(z.unknown()),
          }).openapi("PrefillFeatureResponse"),
        },
      },
    },
    400: { description: "Missing or invalid brandIds", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/{featureSlug}/pipeline-activity",
  tags: ["Features"],
  summary: "Feature pipeline activity",
  description:
    "7-day pipeline activity for a brand overview chart. Scoped by brandId, days, and timezone. Proxied from features-service. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list, so any param features-service adds works without an api-service change.",
  security: authed,
  request: {
    params: z.object({ featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required)"),
      days: z.string().openapi({ example: "7" }).describe("Number of days to include"),
      timezone: z.string().openapi({ example: "America/New_York" }).describe("IANA timezone for day bucketing"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Pricing basis for money metrics: gross (default, undiscounted) | net (the org's discounted figures). Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Feature pipeline activity", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeaturePipelineActivityResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/{featureSlug}/stats",
  tags: ["Features"],
  summary: "Feature stats",
  description:
    "Stats for a specific feature, groupable by workflowSlug, workflowDynastySlug, brandId, or campaignId. Proxied from features-service. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list, so any param features-service adds works without an api-service change.",
  security: authed,
  request: {
    params: z.object({ featureSlug: z.string().openapi({ example: "pr-cold-email-outreach" }).describe("Feature slug") }),
    query: z.object({
      groupBy: z.string().optional().openapi({ example: "workflowSlug" }).describe("Group dimension: workflowSlug | brandId | campaignId"),
      brandId: z.string().optional().openapi({ example: "brand-uuid-123" }).describe("Filter by brand UUID"),
      campaignId: z.string().optional().openapi({ example: "campaign-uuid-456" }).describe("Filter by campaign UUID"),
      workflowSlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-sienna-v3" }).describe("Filter by exact workflow slug"),
      workflowDynastySlug: z.string().optional().describe("Filter by workflow dynasty slug (resolved to all versioned slugs)"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Pricing basis for money metrics: gross (default, undiscounted) | net (the org's discounted figures). Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Feature stats", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureStatsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/{featureSlug}/revenue",
  tags: ["Features"],
  summary: "Feature revenue overview",
  description:
    "Expected-pipeline-revenue overview for a specific feature: headline pipeline $, organizations, and leads. Scoped by brandId (+ optional campaignId). Proxied from features-service.",
  security: authed,
  request: {
    params: z.object({ featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required) — scopes the revenue view to one brand"),
      campaignId: z.string().optional().openapi({ example: "campaign-uuid-456" }).describe("Filter by campaign UUID"),
      workflowSlug: z.string().optional().openapi({ example: "sales-email-cold-outreach-mintaka-v3" }).describe("Filter by workflow slug"),
      groupBy: z.string().optional().openapi({ example: "workflowSlug" }).describe("Group the revenue view by a dimension: campaignId or workflowSlug. Returns one grouped entry per value instead of the scalar overview"),
      lens: z.string().optional().openapi({ example: "signups" }).describe("Filter to a funnel lens (signups | booked-meetings | sales). Returns lens-filtered leads, each carrying conversionProbabilityPct. Absent/unknown → un-lensed overview"),
    }),
  },
  responses: {
    200: { description: "Feature revenue overview", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureRevenueResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/{featureSlug}/revenue/actual-cost",
  tags: ["Features"],
  summary: "Feature return curve at actual vendor cost (staff only)",
  description:
    "The /v1/features/{featureSlug}/revenue return curve costed at what vendors actually charged, before markup. " +
    "Reveals margin, so staff-only: platform API key + a STAFF_EMAILS x-email, refused with 403 before any downstream call; " +
    "org + user identity (x-org-id/x-user-id or x-external-org-id/x-external-user-id) select the org being viewed. " +
    "Transparent proxy to features-service GET /internal/features/{featureSlug}/revenue/actual-cost; query forwarded verbatim " +
    "(brandId, workflow, campaignId, offerId, cause are the ones documented today, not a whitelist); response owned by features-service.",
  security: platformAuth,
  request: {
    params: z.object({ featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug") }),
    query: z
      .object({
        brandId: z.string().describe("Brand UUID (required downstream)"),
        workflow: z.string().describe("Workflow the curve is drawn for (required downstream)"),
        campaignId: z.string().optional().describe("Narrow to one campaign"),
        offerId: z.string().optional().describe("Narrow to one offer"),
        cause: z.string().optional().describe("Narrow to one cause"),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "Actual-cost return curve — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureActualCostRevenueResponse") } } },
    400: { description: "Missing or invalid query parameters", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/{featureSlug}/audience-stats",
  tags: ["Features"],
  summary: "Feature audience stats",
  description:
    "Audience-level cost and outcome evidence for a feature, scoped by brandId and goal. " +
    "Proxied to features-service GET /features/{featureSlug}/audience-stats. Response shape is downstream-owned and passed through.",
  security: authed,
  request: {
    params: z.object({ featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required)"),
      goal: z.string().openapi({ example: "signup" }).describe("Optimization goal (required)"),
      brandProfileId: z.string().optional().openapi({ example: "profile-uuid-123" }).describe("Optional brand-profile version to scope evidence"),
      campaignId: z.string().optional().openapi({ example: "campaign-uuid-123" }).describe("Optional single-campaign scope for the stats (audiences stay brand-wide; only the per-audience cost + outcome numerators narrow to this campaign). Omit for brand-wide numbers"),
      limit: z.string().optional().openapi({ example: "3" }).describe("Optional row limit after sorting"),
      statuses: z.string().optional().openapi({ example: "active,paused,archived" }).describe("Optional comma-separated subset of active,paused,archived to scope which audiences are included (features-service owns the default)"),
    }),
  },
  responses: {
    200: { description: "Feature audience stats", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureAudienceStatsResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ── Offer grain ──────────────────────────────────────────────────────────────
// The three reads above, one grain up: an offer is sold through SEVERAL
// acquisition channels at once, and features-service answers across all of them
// with the per-channel breakdown on the same body. Query objects below are
// PASSTHROUGH documentation of the params known today, never a whitelist — the
// gateway forwards the caller's query string verbatim (CLAUDE.md #11), and the
// response is downstream-owned and passed through unchanged (CLAUDE.md #8).

registry.registerPath({
  method: "get",
  path: "/v1/offers/{offerId}/revenue",
  tags: ["Features"],
  summary: "Offer revenue overview",
  description:
    "An offer's money, across every acquisition channel it is sold through, with the per-channel breakdown beside it. " +
    "Proxied to features-service GET /offers/{offerId}/revenue. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ offerId: z.string().openapi({ example: "offer-uuid-123" }).describe("Offer UUID") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required) — an offer belongs to a brand"),
      funnel: z.string().optional().openapi({ example: "self-serve" }).describe("Sales funnel the cost-per-outcome columns are priced on. Owned and validated by features-service"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Pricing basis for money metrics: gross (default, undiscounted) | net (the org's discounted figures). Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Offer revenue overview", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferRevenueResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Offer not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/offers/{offerId}/outcomes",
  tags: ["Features"],
  summary: "Offer outcomes",
  description:
    "One row per OUTCOME an offer buys (a step at least one of our channels lands a leg on), each with its count, spend, cost per outcome, value and return, and under it every leg x channel serving that outcome. " +
    "Proxied to features-service GET /offers/{offerId}/outcomes. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ offerId: z.string().openapi({ example: "offer-uuid-123" }).describe("Offer UUID") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required) — an offer belongs to a brand"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Offer outcomes", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferOutcomesResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Offer not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/offers/{offerId}/sourcing",
  tags: ["Features"],
  summary: "Offer sourcing split",
  description:
    "Where an offer's leads come from (the sourcing origin, e.g. Apollo cold filters, LinkedIn engagement signals), separately from the outreach channel, each origin with its own cost and ROI, per campaign and in total. " +
    "Proxied to features-service GET /offers/{offerId}/sourcing. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ offerId: z.string().openapi({ example: "offer-uuid-123" }).describe("Offer UUID") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required) — an offer belongs to a brand"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("gross | net — validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Offer sourcing split", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferSourcingResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Offer not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/offers/{offerId}/sales-paths",
  tags: ["Features"],
  summary: "Offer sales paths",
  description:
    "Every sales path an offer can sell through (a chain of the legs ticked for the offer, from an entry leg to a paying client), ranked by ROI, each with its per-leg breakdown: rate retained and its source, the channel chosen for each platform leg, cost per paying client, lifetime revenue and ROI. " +
    "Proxied to features-service GET /offers/{offerId}/sales-paths, which states the formula. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ offerId: z.string().openapi({ example: "offer-uuid-123" }).describe("Offer UUID") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required) — an offer belongs to a brand"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Offer sales paths", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferSalesPathsResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Offer not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/offers/{offerId}/deals-value",
  tags: ["Features"],
  summary: "Offer deals value",
  description:
    "The dollar value of each Deals-board column for one offer (Interested, Won; Disqualified / Opt-out / Not placed carry no value with a reason), per column and per card. A separate figure, added to no pipeline. " +
    "Proxied to features-service GET /offers/{offerId}/deals-value. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ offerId: z.string().openapi({ example: "offer-uuid-123" }).describe("Offer UUID") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required) — an offer belongs to a brand"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Pricing basis: gross (default) | net (the org's discounted figures). Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Offer deals value", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferDealsValueResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Offer not found, or offer has no channels", content: errorContent },
    409: { description: "Conflict reported by features-service", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/offers/{offerId}/contacted-value",
  tags: ["Features"],
  summary: "Offer contacted value",
  description:
    "What one offer's contacted-but-not-yet-engaged leads are worth in expectation (LTR x P(paid | contacted)), per lead and as a total. A separate figure, added to no pipeline. " +
    "Proxied to features-service GET /offers/{offerId}/contacted-value. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ offerId: z.string().openapi({ example: "offer-uuid-123" }).describe("Offer UUID") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required) — an offer belongs to a brand"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Pricing basis: gross (default) | net (the org's discounted figures). Owned and validated by features-service"),
      limit: z.string().optional().openapi({ example: "50" }).describe("Page size. Owned and validated by features-service"),
      cursor: z.string().optional().describe("Opaque paging cursor from the previous page"),
      leadIds: z.string().optional().describe("Comma-separated lead ids to value instead of paging"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Offer contacted value", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferContactedValueResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Offer not found, or offer has no channels", content: errorContent },
    409: { description: "Conflict reported by features-service", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/offers/{offerId}/audience-stats",
  tags: ["Features"],
  summary: "Offer audience stats",
  description:
    "An offer's per-audience economics, across every channel it is sold through, with the channel set on the same body. " +
    "Proxied to features-service GET /offers/{offerId}/audience-stats. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ offerId: z.string().openapi({ example: "offer-uuid-123" }).describe("Offer UUID") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required)"),
      goal: z.string().optional().openapi({ example: "signup" }).describe("Optimization goal. Omitting both goal and funnel is the brand-level read, not an error"),
      funnel: z.string().optional().openapi({ example: "self-serve" }).describe("Sales funnel, same vocabulary as the per-feature read"),
      statuses: z.string().optional().openapi({ example: "active,paused,archived" }).describe("Comma-separated audience statuses (features-service owns the default)"),
      limit: z.string().optional().openapi({ example: "3" }).describe("Maximum number of audience rows"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Pricing basis for money metrics: gross (default) | net. Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Offer audience stats", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferAudienceStatsResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Offer not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/offers/{offerId}/pipeline-activity",
  tags: ["Features"],
  summary: "Offer pipeline activity",
  description:
    "An offer's per-day activity, across every acquisition channel it is sold through, day buckets merged. " +
    "Proxied to features-service GET /offers/{offerId}/pipeline-activity. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ offerId: z.string().openapi({ example: "offer-uuid-123" }).describe("Offer UUID") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required)"),
      timezone: z.string().openapi({ example: "America/New_York" }).describe("IANA timezone used for calendar day ordering (required)"),
      days: z.string().optional().openapi({ example: "7" }).describe("Number of days to return (features-service owns the default)"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Accepted for parity with the sibling reads. Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Offer pipeline activity", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferPipelineActivityResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Offer not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ── Brand grain ──────────────────────────────────────────────────────────────
// The three reads above, one grain further up: a brand holds SEVERAL offers and
// each of those runs SEVERAL channels, so a per-feature read describes whichever
// channel it happened to ask. A brand answer is neither the sum of its offers nor
// the sum of its channels — features-service owns how those parts combine. Query objects below are
// PASSTHROUGH documentation of the params known today, never a whitelist — the
// gateway forwards the caller's query string verbatim (CLAUDE.md #11), and the
// response is downstream-owned and passed through unchanged (CLAUDE.md #8).

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/revenue",
  tags: ["Features"],
  summary: "Brand revenue overview",
  description:
    "A brand's money, across every acquisition channel it runs, with the per-channel breakdown beside it. " +
    "Proxied to features-service GET /brands/{brandId}/revenue. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID") }),
    query: z.object({
      funnel: z.string().optional().openapi({ example: "self-serve" }).describe("Sales funnel the cost-per-outcome columns are priced on. Owned and validated by features-service"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Pricing basis for money metrics: gross (default, undiscounted) | net (the org's discounted figures). Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Brand revenue overview", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandRevenueResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/audience-stats",
  tags: ["Features"],
  summary: "Brand audience stats",
  description:
    "A brand's per-audience economics, across every channel it runs, with the channel set on the same body. " +
    "Proxied to features-service GET /brands/{brandId}/audience-stats. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID") }),
    query: z.object({
      goal: z.string().optional().openapi({ example: "signup" }).describe("Optimization goal. Omitting both goal and funnel is the brand-level read, not an error"),
      funnel: z.string().optional().openapi({ example: "self-serve" }).describe("Sales funnel, same vocabulary as the per-feature read"),
      statuses: z.string().optional().openapi({ example: "active,paused,archived" }).describe("Comma-separated audience statuses (features-service owns the default)"),
      limit: z.string().optional().openapi({ example: "3" }).describe("Maximum number of audience rows"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Pricing basis for money metrics: gross (default) | net. Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Brand audience stats", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandAudienceStatsResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/pipeline-activity",
  tags: ["Features"],
  summary: "Brand pipeline activity",
  description:
    "An offer's per-day activity, across every acquisition channel it is sold through, day buckets merged. " +
    "Proxied to features-service GET /brands/{brandId}/pipeline-activity. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID") }),
    query: z.object({
      timezone: z.string().openapi({ example: "America/New_York" }).describe("IANA timezone used for calendar day ordering (required)"),
      days: z.string().optional().openapi({ example: "7" }).describe("Number of days to return (features-service owns the default)"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Accepted for parity with the sibling reads. Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Brand pipeline activity", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandPipelineActivityResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/orgs/usage",
  tags: ["Features"],
  summary: "Org usage by activity",
  description:
    "The org's net spend grouped into activities a customer recognises (setup, finding contacts, writing emails, sending emails, reading replies, notifications, other). " +
    "totalBilledUsd equals billing's Billed figure. Proxied to features-service GET /orgs/usage; the org is the authenticated one.",
  security: authed,
  responses: {
    200: { description: "Org usage", content: { "application/json": { schema: z.object({}).passthrough().openapi("OrgUsageResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/contacted-value",
  tags: ["Features"],
  summary: "Brand contacted value",
  description:
    "What the brand's contacted-but-not-yet-engaged leads are worth in expectation (LTR × P(paid client | contacted)), " +
    "per lead (paged) and as a company-level total. A separate figure: it is added to no pipeline, ROI or cost figure. " +
    "Proxied to features-service GET /brands/{brandId}/contacted-value. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID") }),
    query: z.object({
      limit: z.string().optional().describe("Rows per page, 1..5000, default 1000"),
      cursor: z.string().optional().describe("The nextCursor of the previous page"),
      leadIds: z.string().optional().describe("Comma-separated lead ids (≤1000) — return only those rows"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Brand contacted value", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandContactedValueResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand has no channels", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/deals-value",
  tags: ["Features"],
  summary: "Brand Deals column values",
  description:
    "The dollar value of each Deals-board column (Interested, Won), per column and per card; Disqualified, opted out and not placed state no value, with a reason. " +
    "A separate figure: it is added to no pipeline, ROI or cost figure. The Contacted column's value is GET /v1/brands/{brandId}/contacted-value. " +
    "Proxied to features-service GET /brands/{brandId}/deals-value. The gateway forwards EVERY query param verbatim.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID") }),
  },
  responses: {
    200: { description: "Brand Deals column values", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandDealsValueResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand has no channels", content: errorContent },
    409: { description: "The brand's channels price differently", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/conversion-rates",
  tags: ["Features"],
  summary: "Brand conversion rates",
  description:
    "The effective conversion rate of every arrow of the brand's sales funnels, and where each came from " +
    "(measured on the brand's own leads, else the brand's manual statement, else the cross-org median). " +
    "Proxied to features-service GET /brands/{brandId}/conversion-rates. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID") }),
    query: z.object({
      funnel: z.string().optional().openapi({ example: "self-serve" }).describe("Narrow to one sales funnel. Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Brand conversion rates", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandConversionRatesResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

// Every offer of a brand, each with its own money combined across every channel it
// is sold through — the read a brand Overview's offer table is built on. NOT mounted
// at /v1/brands/{brandId}/offers: that path is brand-service's offer CATALOG, served
// by src/routes/brand.ts, which mounts first. This takes the /v1/{service}/{downstream
// path} shape instead, so the downstream path stays exactly what features-service
// serves and nothing is renamed.
registry.registerPath({
  method: "get",
  path: "/v1/features/brands/{brandId}/offers",
  tags: ["Features"],
  summary: "Brand offers, each combined across its channels",
  description:
    "Every offer of a brand, each with its own money combined across every acquisition channel that offer is sold through — one lean body an offer table can poll. " +
    "Proxied to features-service GET /brands/{brandId}/offers. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID") }),
    query: z.object({
      funnel: z.string().optional().openapi({ example: "self-serve" }).describe("Sales funnel the cost-per-outcome columns are priced on. Owned and validated by features-service"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Pricing basis for money metrics: gross (default, undiscounted) | net (the org's discounted figures). Owned and validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Brand offers with per-offer economics", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandOffersResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found", content: errorContent },
    409: { description: "Conflict", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/{featureSlug}/workflow-projection",
  tags: ["Features"],
  summary: "Feature workflow projection",
  description:
    "Serves a 3-grain (crossOrg → brand → audience) cost-per-outcome projection ladder + a resolved pick, keyed per (audienceId?, workflowDynasty), for a specific feature. Scoped by brandId; goal/objective select the outcome metric. Folds in the audience×workflow grain formerly served by the removed /candidates endpoint. Proxied from features-service.",
  security: authed,
  request: {
    params: z.object({ featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required) — scopes the projection to one brand"),
      goal: z.string().optional().openapi({ example: "meetingBooked" }).describe("Optimization goal selecting the outcome metric (camel/snake/kebab). Also accepted via `objective`. Defaults to meeting-booked"),
      objective: z.string().optional().openapi({ example: "meeting-booked" }).describe("Alias of `goal` (snake/kebab spelling). Either param is accepted"),
      audienceId: z.string().optional().openapi({ example: "audience-uuid-123" }).describe("Optional audience UUID context (echoed via audience rows)"),
      budgetUsd: z.string().optional().openapi({ example: "1000" }).describe("Optional budget context (back-compat; the grain ladder + recommendedBudgetUsd carry the projection surface)"),
    }),
  },
  responses: {
    200: { description: "Feature workflow projection", content: { "application/json": { schema: z.object({}).passthrough().openapi("WorkflowProjectionResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/{featureSlug}/workflow-projection/actual-cost",
  tags: ["Features"],
  summary: "Feature workflow projection at actual vendor cost (staff only)",
  description:
    "The /v1/features/{featureSlug}/workflow-projection ladder with every money figure at what vendors actually charged, before markup. " +
    "Reveals margin, so staff-only: platform API key + a STAFF_EMAILS x-email, refused with 403 before any downstream call; " +
    "org + user identity (x-org-id/x-user-id or x-external-org-id/x-external-user-id) select the org being viewed. " +
    "Transparent proxy to features-service GET /internal/features/{featureSlug}/workflow-projection/actual-cost; query forwarded verbatim " +
    "(the parameters below are the ones documented today, not a whitelist); response owned by features-service.",
  security: platformAuth,
  request: {
    params: z.object({ featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug") }),
    query: z
      .object({
        brandId: z.string().describe("Brand UUID (required downstream)"),
        goal: z.string().optional().describe("Optimization goal selecting the outcome metric"),
        objective: z.string().optional().describe("Alias of `goal`"),
        audienceId: z.string().optional().describe("Optional audience UUID context"),
        budgetUsd: z.string().optional().describe("Optional budget context"),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "Actual-cost workflow projection — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("WorkflowProjectionActualCostResponse") } } },
    400: { description: "Missing or invalid query parameters", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/runs/vendor",
  tags: ["Runs"],
  summary: "List runs with vendor cost (staff only)",
  description:
    "The GET /v1/runs list (same query parameters, same runs, same order) with each run's cost also stated at what vendors charged, before markup — own and subtree totals. " +
    "Reveals margin, so staff-only: platform API key + a STAFF_EMAILS x-email, refused with 403 before any downstream call; " +
    "org + user identity select the org whose runs are listed, and the gateway forwards that org as runs-service's `orgId` query parameter (a caller-supplied `orgId` is ignored). " +
    "Transparent proxy to runs-service GET /internal/runs/vendor; every other query parameter forwarded verbatim; response owned by runs-service.",
  security: platformAuth,
  request: {
    query: z
      .object({
        campaignId: z.string().optional(),
        brandId: z.string().optional(),
        workflowSlug: z.string().optional(),
        featureSlug: z.string().optional(),
        serviceName: z.string().optional(),
        taskName: z.string().optional(),
        status: z.string().optional(),
        startedAfter: z.string().optional(),
        startedBefore: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "Runs with vendor cost — pass-through from runs-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("ListRunsVendorResponse") } } },
    400: { description: "Invalid query parameters", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// PUBLIC STATS (no auth — landing page endpoints)
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/public/stats/users",
  tags: ["Public Stats"],
  summary: "Public user/org stats (no auth)",
  description:
    "Returns total orgs, total users, and monthly growth breakdown. " +
    "No authentication required. Proxied from client-service.",
  responses: {
    200: { description: "User/org stats", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicUserStatsResponse") } } },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/public/stats/billing",
  tags: ["Public Stats"],
  summary: "Public billing stats (no auth)",
  description:
    "Returns total accounts, payment-method coverage, grant/credit aggregates, " +
    "and monthly/weekly growth breakdowns. " +
    "No authentication required. Proxied from billing-service.",
  responses: {
    200: {
      description: "Billing stats — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("PublicBillingStatsResponse"),
        },
      },
    },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/public/stats/runs",
  tags: ["Public Stats"],
  summary: "Public run stats (no auth)",
  description:
    "Returns run counts by status and monthly completed breakdown. " +
    "No authentication required. Proxied from runs-service.",
  responses: {
    200: { description: "Run stats", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicRunStatsResponse") } } },
    502: { description: "Upstream error", content: errorContent },
  },
});

// PUBLIC CONVERSIONS (no Clerk auth — third-party website postback)
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "post",
  path: "/public/conversions",
  tags: ["Public"],
  summary: "Ingest a conversion event (no Clerk auth — per-brand token)",
  description:
    "PUBLIC conversion-tracking ingest. Called directly by third-party client " +
    "websites (conversion snippet / server-side postback). NOT authenticated by a " +
    "Clerk session — the per-brand publishable token travels in the `x-conversion-token` " +
    "header (or `Authorization: Bearer`) and is verified downstream. Proxied to " +
    "lead-service POST /public/conversions; the raw JSON body is forwarded untouched. " +
    "Response (expected 200 { received: true }, or its 400/401) is owned by the " +
    "downstream service.",
  request: {
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("ConversionIngestRequest") } } },
  },
  responses: {
    200: { description: "Conversion received", content: { "application/json": { schema: z.object({}).passthrough().openapi("ConversionIngestResponse") } } },
    400: { description: "Invalid payload (forwarded verbatim)", content: errorContent },
    401: { description: "Invalid or missing conversion token (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

// PUBLIC FEATURES (no auth — landing page endpoints)
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/public/features",
  tags: ["Features"],
  summary: "List active features (public, no auth)",
  description:
    "Returns all active features. " +
    "No authentication required. Proxied from features-service.",
  responses: {
    200: { description: "Active features", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicFeaturesListResponse") } } },
    500: { description: "Internal error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// PUBLIC COSTS (no auth — landing page endpoints)
// ---------------------------------------------------------------------------

const PlatformPriceSchema = z.object({
  id: z.string().describe("Platform price row id"),
  name: z.string().describe("Stable identifier (e.g. 'input_tokens_sonnet_4_6')"),
  provider: z.string().describe("Provider name (e.g. 'anthropic', 'openai')"),
  providerDomain: z.string().nullable().describe("Provider domain for logo.dev rendering, nullable"),
  type: z.string().describe("Human-readable cost type (e.g. 'Input tokens (Sonnet 4.6)')"),
  unit: z.string().describe("Billing unit (e.g. '1M tokens', '1 request')"),
  costPerUnitInUsdCents: z.string().describe("Cost per unit, decimal-string USD cents (full precision)"),
  effectiveFrom: z.string().describe("ISO timestamp the price became effective"),
}).passthrough().openapi("PlatformPrice");

registry.registerPath({
  method: "get",
  path: "/v1/costs/platform-prices",
  tags: ["Public Costs"],
  summary: "List platform prices (public, no auth)",
  description:
    "Returns the live list of platform unit costs grouped by provider. " +
    "No authentication required. Pure pass-through to costs-service GET /v1/platform-prices. " +
    "Each row includes provider/providerDomain (for logo.dev), type, unit, and decimal-string USD cents.",
  responses: {
    200: {
      description: "Platform prices",
      content: {
        "application/json": {
          schema: z.array(PlatformPriceSchema).openapi("PlatformPricesResponse"),
        },
      },
    },
    502: { description: "Upstream costs-service unreachable or returned non-2xx", content: errorContent },
  },
});

// ===================================================================
// ADMIN CRM (brand-service staff proxy)
// ===================================================================

registry.registerPath({
  method: "get",
  path: "/v1/admin/brands",
  tags: ["Admin"],
  summary: "List all brands across orgs (staff only)",
  description:
    "Fleet-wide brands list (id, name, domain, orgId) across all orgs — powers the admin CRM " +
    "brands view (cross-org ops data, NOT customer data). Staff-only (platform API key + " +
    "STAFF_EMAILS x-email); no org context required. Transparent proxy to brand-service " +
    "GET /internal/brands/all; response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Brands list — pass-through from brand-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("AdminBrandsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

const audienceSnapshotParams = z.object({ brandId: z.string().openapi({ description: "Brand UUID" }) });
const audienceSnapshotQuery = z
  .object({ orgId: z.string().optional().openapi({ description: "Optional internal org UUID to scope the snapshot" }) })
  .passthrough();
const heldEntitiesQuery = z
  .object({
    orgId: z.string().optional().openapi({ description: "Optional internal org UUID" }),
    limit: z.string().optional().openapi({ description: "Page size (human-service owns the range and default)" }),
    offset: z.string().optional().openapi({ description: "Page offset" }),
    acceptedOnly: z.string().optional().openapi({ description: "true | false: only rows a target audience accepted" }),
  })
  .passthrough();

for (const read of [
  {
    suffix: "",
    summary: "What we hold in a brand's audiences, per list (staff only)",
    query: audienceSnapshotQuery,
    schema: z.object({}).passthrough().openapi("BrandAudienceSnapshot"),
  },
  {
    suffix: "/people",
    summary: "People held for a brand's audiences, paginated (staff only)",
    query: heldEntitiesQuery,
    schema: z.object({}).passthrough().openapi("BrandHeldPeople"),
  },
  {
    suffix: "/companies",
    summary: "Companies held for a brand's audiences, paginated (staff only)",
    query: heldEntitiesQuery,
    schema: z.object({}).passthrough().openapi("BrandHeldCompanies"),
  },
]) {
  registry.registerPath({
    method: "get",
    path: `/v1/admin/brands/{brandId}/audience-snapshot${read.suffix}`,
    tags: ["Admin"],
    summary: read.summary,
    description:
      "Staff-only (platform API key + STAFF_EMAILS x-email); cross-org data, no org context required. " +
      `Byte passthrough to human-service GET /internal/brands/{brandId}/audience-snapshot${read.suffix}; ` +
      "query string forwarded verbatim (the params documented here are today's, not a whitelist), status and body owned by the downstream service.",
    security: platformAuth,
    request: { params: audienceSnapshotParams, query: read.query },
    responses: {
      200: { description: "Pass-through from human-service", content: { "application/json": { schema: read.schema } } },
      400: { description: "Invalid brand id or query (forwarded verbatim)", content: errorContent },
      401: { description: "Unauthorized", content: errorContent },
      403: { description: "Not staff", content: errorContent },
      502: { description: "Upstream error", content: errorContent },
    },
  });
}

const sourcingInvestmentQuery = z.object({}).passthrough();
const sourcingInvestedPeopleQuery = z
  .object({
    limit: z.string().optional().openapi({ description: "Page size (features-service owns the range and default)" }),
    offset: z.string().optional().openapi({ description: "Page offset" }),
    apolloPersonIds: z.string().optional().openapi({ description: "Comma-separated Apollo person ids to read" }),
  })
  .passthrough();
const sourcingInvestedCompaniesQuery = z
  .object({
    limit: z.string().optional().openapi({ description: "Page size (features-service owns the range and default)" }),
    offset: z.string().optional().openapi({ description: "Page offset" }),
    domains: z.string().optional().openapi({ description: "Comma-separated company domains to read" }),
  })
  .passthrough();

for (const read of [
  {
    suffix: "",
    summary: "What we invested to source a brand's audiences, per audience (staff only)",
    query: sourcingInvestmentQuery,
    schema: z.object({}).passthrough().openapi("BrandSourcingInvestment"),
  },
  {
    suffix: "/people",
    summary: "Sourcing investment per acquired person of a brand, paginated (staff only)",
    query: sourcingInvestedPeopleQuery,
    schema: z.object({}).passthrough().openapi("BrandSourcingInvestmentPeople"),
  },
  {
    suffix: "/companies",
    summary: "Sourcing investment per company of a brand, paginated (staff only)",
    query: sourcingInvestedCompaniesQuery,
    schema: z.object({}).passthrough().openapi("BrandSourcingInvestmentCompanies"),
  },
]) {
  registry.registerPath({
    method: "get",
    path: `/v1/admin/brands/{brandId}/sourcing-investment${read.suffix}`,
    tags: ["Admin"],
    summary: read.summary,
    description:
      "Staff-only (platform API key + STAFF_EMAILS x-email), carries our vendor cost. Needs the viewed org's identity " +
      "(x-org-id/x-user-id or x-external-org-id/x-external-user-id). " +
      `Byte passthrough to features-service GET /brands/{brandId}/sourcing-investment${read.suffix}; ` +
      "query string forwarded verbatim (the params documented here are today's, not a whitelist), status and body owned by the downstream service.",
    security: platformAuth,
    request: { params: audienceSnapshotParams, query: read.query },
    responses: {
      200: { description: "Pass-through from features-service", content: { "application/json": { schema: read.schema } } },
      400: { description: "Invalid brand id, query or identity headers (forwarded verbatim)", content: errorContent },
      401: { description: "Unauthorized", content: errorContent },
      403: { description: "Not staff", content: errorContent },
      502: { description: "Upstream error", content: errorContent },
    },
  });
}

// Customer twins of the two staff families above: same six reads for an ordinary org
// member, scoped to the authenticated org (brand ownership checked at brand-service,
// human-service snapshot forced to orgId=<that org>, features-service on x-org-id),
// and the sourcing investment bodies stripped of every vendorUsd (our vendor cost).
const customerOrgScopeNote =
  "Scoped to the caller's organization: the brand must belong to it (else 404 brand_not_in_org) and only that organization's data is returned. ";
const customerHeldEntitiesQuery = z
  .object({
    limit: z.string().optional().openapi({ description: "Page size (human-service owns the range and default)" }),
    offset: z.string().optional().openapi({ description: "Page offset" }),
    acceptedOnly: z.string().optional().openapi({ description: "true | false: only rows a target audience accepted" }),
  })
  .passthrough();
const customerInvestedCompaniesQuery = z
  .object({
    limit: z.string().optional().openapi({ description: "Page size (features-service owns the range and default)" }),
    offset: z.string().optional().openapi({ description: "Page offset" }),
    companyKeys: z.string().optional().openapi({ description: "Comma-separated company keys to read (exclusive with domains)" }),
    domains: z.string().optional().openapi({ description: "Comma-separated company domains to read" }),
  })
  .passthrough();

for (const read of [
  {
    path: "audience-snapshot",
    summary: "The lists a brand's people are sourced from, and what each holds",
    query: z.object({}).passthrough(),
    schema: "CustomerBrandAudienceSnapshot",
    downstream: "human-service GET /internal/brands/{brandId}/audience-snapshot",
  },
  {
    path: "audience-snapshot/people",
    summary: "People held for a brand's audiences, paginated",
    query: customerHeldEntitiesQuery,
    schema: "CustomerBrandHeldPeople",
    downstream: "human-service GET /internal/brands/{brandId}/audience-snapshot/people",
  },
  {
    path: "audience-snapshot/companies",
    summary: "Companies held for a brand's audiences, paginated",
    query: customerHeldEntitiesQuery,
    schema: "CustomerBrandHeldCompanies",
    downstream: "human-service GET /internal/brands/{brandId}/audience-snapshot/companies",
  },
  {
    path: "sourcing-investment",
    summary: "What was invested to source a brand's audiences: total and per audience",
    query: z.object({}).passthrough(),
    schema: "CustomerBrandSourcingInvestment",
    downstream: "features-service GET /brands/{brandId}/sourcing-investment (vendorUsd removed)",
  },
  {
    path: "sourcing-investment/people",
    summary: "What acquiring each person of a brand cost, paginated",
    query: sourcingInvestedPeopleQuery,
    schema: "CustomerBrandSourcingInvestmentPeople",
    downstream: "features-service GET /brands/{brandId}/sourcing-investment/people (vendorUsd removed)",
  },
  {
    path: "sourcing-investment/companies",
    summary: "What each company's people of a brand cost to acquire, paginated",
    query: customerInvestedCompaniesQuery,
    schema: "CustomerBrandSourcingInvestmentCompanies",
    downstream: "features-service GET /brands/{brandId}/sourcing-investment/companies (vendorUsd removed)",
  },
]) {
  registry.registerPath({
    method: "get",
    path: `/v1/brands/{brandId}/${read.path}`,
    tags: ["Brand"],
    summary: read.summary,
    description:
      customerOrgScopeNote +
      `Proxy to ${read.downstream}; query string forwarded (the params documented here are today's, not a whitelist), ` +
      "response shape owned by the downstream service.",
    security: authed,
    request: { params: audienceSnapshotParams, query: read.query },
    responses: {
      200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi(read.schema) } } },
      400: { description: "Invalid brand id or query (forwarded verbatim)", content: errorContent },
      401: { description: "Unauthorized", content: errorContent },
      404: { description: "Brand not in the caller's organization", content: errorContent },
      502: { description: "Upstream error", content: errorContent },
    },
  });
}

// ===================================================================
// EXPERT QUOTES (journalists-quotes-service proxy)
// ===================================================================

const QuoteRequestSchema = z
  .object({
    id: z.string().uuid(),
    featuredQuestionId: z.number().int(),
    source: z.string(),
    mediaOutlet: z.string().nullable(),
    opportunityText: z.string(),
    pitchUrl: z.string().nullable(),
    deadline: z.string().nullable(),
    fetchedAt: z.string(),
    orgId: z.string().uuid(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("QuoteRequest");

const QuoteRequestsListResponseSchema = z
  .object({ quoteRequests: z.array(QuoteRequestSchema) })
  .openapi("QuoteRequestsListResponse");

const QuoteRequestResponseSchema = z
  .object({ quoteRequest: QuoteRequestSchema })
  .openapi("QuoteRequestResponse");

const QuoteRequestsStatsResponseSchema = z
  .object({
    totalRequests: z.number().int(),
    totalPitched: z.number().int(),
    totalSelected: z.number().int(),
    totalPublished: z.number().int(),
    totalNotSelected: z.number().int(),
  })
  .openapi("QuoteRequestsStatsResponse");

const QuotePitchStatusEnum = z.enum([
  "drafted",
  "submitted",
  "selected",
  "published",
  "not_selected",
  "error",
]);

const QuotePitchSchema = z
  .object({
    id: z.string().uuid(),
    quoteRequestId: z.string().uuid(),
    featuredQuestionId: z.number().int(),
    featuredProfileId: z.number().int(),
    campaignId: z.string().uuid(),
    brandId: z.string().uuid(),
    draft: z.string(),
    submittedAt: z.string().nullable(),
    status: QuotePitchStatusEnum,
    featuredArticleUrl: z.string().nullable(),
    error: z.string().nullable(),
    parentRunId: z.string().uuid().nullable(),
    runId: z.string().uuid().nullable(),
    orgId: z.string().uuid(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("QuotePitch");

const QuotePitchesListResponseSchema = z
  .object({ quotePitches: z.array(QuotePitchSchema) })
  .openapi("QuotePitchesListResponse");

const QuotePitchResponseSchema = z
  .object({ quotePitch: QuotePitchSchema })
  .openapi("QuotePitchResponse");

// Passthrough schemas for HITL PR Expert Quote Opportunities routes.
// Downstream (journalists-quotes-service) owns body + response shapes — api-service forwards bytes.
const OpportunityNextRequestSchema = z.object({}).passthrough().openapi("OpportunityNextRequest");
const OpportunityNextResponseSchema = z.object({}).passthrough().openapi("OpportunityNextResponse");
const OpportunityReplyRequestSchema = z.object({}).passthrough().openapi("OpportunityReplyRequest");
const OpportunityReplyResponseSchema = z.object({}).passthrough().openapi("OpportunityReplyResponse");
const OpportunityDiscoverRequestSchema = z.object({}).passthrough().openapi("OpportunityDiscoverRequest");
const OpportunityDiscoverResponseSchema = z.object({}).passthrough().openapi("OpportunityDiscoverResponse");
const OpportunitiesListResponseSchema = z.object({}).passthrough().openapi("OpportunitiesListResponse");

registry.registerPath({
  method: "get",
  path: "/v1/orgs/quote-requests",
  tags: ["Expert Quotes"],
  summary: "List quote requests for the org",
  description:
    "Pure pass-through to journalists-quotes-service GET /orgs/quote-requests. " +
    "Filter by campaign_id and/or source. Caller controls pagination via limit/offset.",
  security: authed,
  request: {
    query: z.object({
      campaign_id: z.string().uuid().optional(),
      source: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "List of quote requests", content: { "application/json": { schema: QuoteRequestsListResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/quote-requests/stats",
  tags: ["Expert Quotes"],
  summary: "Aggregate stats for quote requests + pitches",
  description: "Pass-through to journalists-quotes-service GET /orgs/quote-requests/stats.",
  security: authed,
  request: {
    query: z.object({
      campaign_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: { description: "Quote request stats", content: { "application/json": { schema: QuoteRequestsStatsResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/quote-requests/{id}",
  tags: ["Expert Quotes"],
  summary: "Get a single quote request",
  description: "Pass-through to journalists-quotes-service GET /orgs/quote-requests/{id}.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: "Quote request id" }),
    }),
  },
  responses: {
    200: { description: "Quote request", content: { "application/json": { schema: QuoteRequestResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Quote request not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/quote-pitches",
  tags: ["Expert Quotes"],
  summary: "List quote pitches for the org",
  description:
    "Pure pass-through to journalists-quotes-service GET /orgs/quote-pitches. " +
    "Filter by campaign_id and/or status. Caller controls pagination via limit/offset.",
  security: authed,
  request: {
    query: z.object({
      campaign_id: z.string().uuid().optional(),
      status: QuotePitchStatusEnum.optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "List of quote pitches", content: { "application/json": { schema: QuotePitchesListResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/quote-pitches/{id}",
  tags: ["Expert Quotes"],
  summary: "Get a single quote pitch",
  description: "Pass-through to journalists-quotes-service GET /orgs/quote-pitches/{id}.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: "Quote pitch id" }),
    }),
  },
  responses: {
    200: { description: "Quote pitch", content: { "application/json": { schema: QuotePitchResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Quote pitch not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/opportunities",
  tags: ["Expert Quotes"],
  summary: "Paginated read of scored Gold-cluster opportunities for the brand-set",
  description:
    "Pure pass-through to journalists-quotes-service GET /orgs/opportunities. " +
    "Brand identity flows via the x-brand-id header (CSV when plural). " +
    "Filter by campaignId. Caller controls pagination via limit/offset. " +
    "Response shape is owned by the downstream service.",
  security: authed,
  request: {
    query: z.object({
      campaignId: z.string().uuid().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "Scored opportunities", content: { "application/json": { schema: OpportunitiesListResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/opportunities/next",
  tags: ["Expert Quotes"],
  summary: "Single highest-scored Gold-cluster opportunity for the brand-set",
  description:
    "Pass-through to journalists-quotes-service POST /orgs/opportunities/next. " +
    "Mirrors lead-service POST /orgs/buffer/next semantics. " +
    "Brand identity via x-brand-id header (CSV when plural). " +
    "Excludes opportunities with a non-retryable pitch (drafted/submitted/selected/published/not_selected) on the exact brand-set. " +
    "Returns { found: false } when nothing eligible remains. " +
    "Body + response shapes are owned by the downstream service.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: OpportunityNextRequestSchema } } },
  },
  responses: {
    200: { description: "Next opportunity (or { found: false })", content: { "application/json": { schema: OpportunityNextResponseSchema } } },
    400: { description: "Bad request (forwarded verbatim from downstream)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/opportunities/discover",
  tags: ["Expert Quotes"],
  summary: "Write-only batch scorer — ingest + score unscored opportunities for the brand-set",
  description:
    "Pass-through to journalists-quotes-service POST /orgs/opportunities/discover. " +
    "Brand identity flows via the x-brand-id header (CSV when plural). " +
    "Empty request body. Ingests Featured + scores the next batch of unscored opportunities for the brand-set tuple. " +
    "Body + response shapes are owned by the downstream service.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: OpportunityDiscoverRequestSchema } } },
  },
  responses: {
    200: { description: "Discovery result ({ scored, exhausted, brandIds })", content: { "application/json": { schema: OpportunityDiscoverResponseSchema } } },
    400: { description: "Bad request (forwarded verbatim from downstream)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/opportunities/{id}/reply",
  tags: ["Expert Quotes"],
  summary: "Submit a HITL pitch reply for the given Gold-cluster opportunity",
  description:
    "Pass-through to journalists-quotes-service POST /orgs/opportunities/{id}/reply. " +
    "`id` = quote_opportunities.id (Gold cluster). Brand identity via x-brand-id header (CSV when plural). " +
    "The downstream service picks a representative silver row (Featured-API preferred, else most recent email) and " +
    "dispatches via Featured submitAnswer or email-gateway-service /orgs/send. " +
    "Idempotency: exact-match on (quote_opportunity_id, sorted brand_ids[]) — co-branded [A,B] is distinct from solo [A]. " +
    "Body + response shapes are owned by the downstream service.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: "Gold-cluster opportunity id (quote_opportunities.id)" }),
    }),
    body: { content: { "application/json": { schema: OpportunityReplyRequestSchema } } },
  },
  responses: {
    200: { description: "Reply submitted", content: { "application/json": { schema: OpportunityReplyResponseSchema } } },
    400: { description: "Bad request (forwarded verbatim from downstream)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Opportunity not found", content: errorContent },
  },
});

// ===================================================================
// AI VISIBILITY (ai-visibility-score-service proxy)
// ===================================================================

const VisibilityScoreWeightsSchema = z
  .object({
    brandMentionRate: z.number().min(0).max(1),
    citationRate: z.number().min(0).max(1),
    positionScore: z.number().min(0).max(1),
    shareOfVoice: z.number().min(0).max(1),
    sentiment: z.number().min(0).max(1),
    brandAndUrlRate: z.number().min(0).max(1),
  })
  .openapi("VisibilityScoreWeights");

const VisibilityScoreRunBaseSchema = z
  .object({
    id: z.string().uuid(),
    orgId: z.string().uuid(),
    brandId: z.string().uuid(),
    parentRunId: z.string().uuid().nullable(),
    runId: z.string().uuid().nullable(),
    domain: z.string(),
    brandName: z.string(),
    llmProvider: z.string(),
    llmModel: z.string(),
    promptGenModel: z.string(),
    extractionProvider: z.string(),
    extractionModel: z.string(),
    nPrompts: z.number(),
    weights: VisibilityScoreWeightsSchema,
    visibilityScore: z.string().nullable(),
    brandMentionRate: z.string().nullable(),
    shareOfVoice: z.string().nullable(),
    netSentiment: z.string().nullable(),
    citationRate: z.string().nullable(),
    avgPosition: z.string().nullable(),
    promptGenSystemPrompt: z.string().nullable().optional().openapi({
      description:
        "Exact system prompt string sent to the prompt-generator LLM (one call per run, drives the prompts the judges then answer).",
    }),
    promptGenUserMessage: z.string().nullable().optional().openapi({
      description:
        "Exact user message string sent to the prompt-generator LLM. Includes the brand context fields (industry, audience, offerings, geography) — these influence which prompts get generated.",
    }),
    status: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .passthrough()
  .openapi("VisibilityScoreRun");

const VisibilityScoreRunWithDeltaSchema = VisibilityScoreRunBaseSchema.extend({
  visibility_score_delta: z.string().nullable(),
  share_of_voice_delta: z.string().nullable(),
  net_sentiment_delta: z.string().nullable(),
  position_delta: z.string().nullable(),
})
  .passthrough()
  .openapi("VisibilityScoreRunWithDelta");

const VisibilityScoreRunsListResponseSchema = z
  .object({
    runs: z.array(VisibilityScoreRunWithDeltaSchema),
    limit: z.number(),
    offset: z.number(),
  })
  .openapi("VisibilityScoreRunsListResponse");

const VisibilityScorePromptSchema = z
  .object({
    id: z.string().uuid(),
    promptIndex: z.number(),
    promptText: z.string(),
    judgeSystemPrompt: z.string().nullable().openapi({
      description: "Exact system prompt string sent to the judge LLM. Persisted for full debug transparency.",
    }),
    judgeUserMessage: z.string().nullable().openapi({
      description:
        "Exact user message string sent to the judge LLM. Equals `promptText` (server does NOT inject brand context into the judge call).",
    }),
    extractorSystemPrompt: z.string().nullable().openapi({
      description: "Exact system prompt string sent to the extractor LLM (the extractor analyzes the judge's output).",
    }),
    extractorUserMessage: z.string().nullable().openapi({
      description:
        "Exact user message string sent to the extractor LLM. Includes `Target brand: <name + domain>` + the judge response.",
    }),
    responseText: z.string(),
    responseLengthChars: z.number().nullable(),
    brandFound: z.boolean().nullable(),
    brandCount: z.number().nullable(),
    brandPosition: z.number().nullable(),
    urlFound: z.boolean().nullable(),
    urlCount: z.number().nullable(),
    brandAndUrlCoOccurrence: z.boolean().nullable(),
    maxBrandsInResponse: z.number().nullable(),
    sentiment: z.string().nullable(),
    sentimentScore: z.string().nullable(),
    citationUrls: z.array(z.string()).nullable(),
    latencyMs: z.number().nullable(),
    tokensInput: z.number().nullable(),
    tokensOutput: z.number().nullable(),
  })
  .openapi("VisibilityScorePrompt");

const VisibilityScoreCompetitorSchema = z
  .object({
    id: z.string().uuid(),
    promptIdFk: z.string().uuid(),
    competitorName: z.string(),
    competitorUrl: z.string().nullable(),
    position: z.number().nullable(),
    sentiment: z.string().nullable(),
    sentimentScore: z.string().nullable(),
    citationUrl: z.string().nullable(),
  })
  .openapi("VisibilityScoreCompetitor");

const VisibilityScoreTopCompetitorSchema = z
  .object({
    name: z.string(),
    url: z.string().nullable(),
    mention_count: z.number(),
    avg_position: z.number().nullable(),
    share_of_voice: z.number(),
    net_sentiment: z.number(),
  })
  .openapi("VisibilityScoreTopCompetitor");

const VisibilityScoreCitationOpportunitySchema = z
  .object({
    domain: z.string(),
    count: z.number(),
  })
  .openapi("VisibilityScoreCitationOpportunity");

const VisibilityScoreRunDetailResponseSchema = z
  .object({
    run: VisibilityScoreRunBaseSchema,
    prompts: z.array(VisibilityScorePromptSchema),
    competitors: z.array(VisibilityScoreCompetitorSchema),
    top_competitors: z.array(VisibilityScoreTopCompetitorSchema),
    citation_opportunities: z.array(VisibilityScoreCitationOpportunitySchema),
  })
  .openapi("VisibilityScoreRunDetailResponse");

const VisibilityScoreRunCreateRequestSchema = z
  .object({
    campaignId: z.string().uuid().optional(),
  })
  .openapi("VisibilityScoreRunCreateRequest");

const VisibilityScoreRunCreateResponseSchema = z
  .object({
    results: z.array(z.object({}).passthrough()),
  })
  .openapi("VisibilityScoreRunCreateResponse");

registry.registerPath({
  method: "get",
  path: "/v1/orgs/visibility-score-runs",
  tags: ["AI Visibility"],
  summary: "List visibility-score runs with deltas",
  description:
    "Pure pass-through to ai-visibility-score-service GET /orgs/visibility-score-runs. " +
    "Each row includes a delta block vs. the immediately previous run for the same brand. " +
    "Filter by brandId, domain, campaignId, or date range (from/to).",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().uuid().optional(),
      domain: z.string().optional(),
      campaignId: z.string().uuid().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().int().optional(),
      offset: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: { description: "List of visibility-score runs", content: { "application/json": { schema: VisibilityScoreRunsListResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/visibility-score-runs",
  tags: ["AI Visibility"],
  summary: "Run a visibility-score audit for a single brand",
  description:
    "Pass-through to ai-visibility-score-service POST /orgs/visibility-score-runs. " +
    "Runs an N-prompt LLM audit against the brand identified by `x-brand-id`. " +
    "Optional `campaignId` in the body associates the run with a campaign.",
  security: authed,
  request: {
    body: {
      content: { "application/json": { schema: VisibilityScoreRunCreateRequestSchema } },
    },
  },
  responses: {
    200: { description: "Run results", content: { "application/json": { schema: VisibilityScoreRunCreateResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/visibility-score-runs/{id}",
  tags: ["AI Visibility"],
  summary: "Get a single visibility-score run",
  description:
    "Pass-through to ai-visibility-score-service GET /orgs/visibility-score-runs/{id}. " +
    "Returns run + prompts[] + competitors[] + top_competitors[] + citation_opportunities[].",
  security: authed,
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: "Visibility-score run id" }),
    }),
  },
  responses: {
    200: { description: "Visibility-score run bundle", content: { "application/json": { schema: VisibilityScoreRunDetailResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Run not found", content: errorContent },
  },
});

// ===================================================================
// INVITES + WAITLIST (Wave 0.5 — DIS-64)
// ===================================================================
// api-service is a transparent proxy here per CLAUDE.md #2. The downstream
// client-service owns the entire invite/waitlist domain, including the
// claim orchestration (billing-service credit grants + transactional-email
// confirmations). All response shapes collapse to passthrough so downstream
// renames flow through without coordinated api-service edits (CLAUDE.md #8).
// ===================================================================

const InviteValidateRequestSchema = z.object({}).passthrough().openapi("InviteValidateRequest");
const InviteValidateResponseSchema = z.object({}).passthrough().openapi("InviteValidateResponse");
const WaitlistRequestAccessRequestSchema = z.object({}).passthrough().openapi("WaitlistRequestAccessRequest");
const WaitlistRequestAccessResponseSchema = z.object({}).passthrough().openapi("WaitlistRequestAccessResponse");
const WaitlistPositionResponseSchema = z.object({}).passthrough().openapi("WaitlistPositionResponse");
const OrgInvitesStatusResponseSchema = z.object({}).passthrough().openapi("OrgInvitesStatusResponse");
const OrgInvitesClaimRequestSchema = z.object({}).passthrough().openapi("OrgInvitesClaimRequest");
const OrgInvitesClaimResponseSchema = z.object({}).passthrough().openapi("OrgInvitesClaimResponse");

registry.registerPath({
  method: "post",
  path: "/v1/invites/validate",
  tags: ["Invites"],
  summary: "Validate an invite code (no auth)",
  description:
    "Public pass-through to client-service POST /public/invites/validate. " +
    "Returns whether the supplied invite code is currently redeemable. " +
    "Body + response shapes are owned by the downstream service.",
  request: {
    body: { content: { "application/json": { schema: InviteValidateRequestSchema } } },
  },
  responses: {
    200: { description: "Validation result", content: { "application/json": { schema: InviteValidateResponseSchema } } },
    400: { description: "Bad request (forwarded verbatim from downstream)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/waitlist/request-access",
  tags: ["Waitlist"],
  summary: "Request waitlist access (no auth)",
  description:
    "Public pass-through to client-service POST /public/waitlist/request-access. " +
    "Downstream inserts the waitlist row and fires the confirmation email. " +
    "Body + response shapes are owned by the downstream service.",
  request: {
    body: { content: { "application/json": { schema: WaitlistRequestAccessRequestSchema } } },
  },
  responses: {
    200: { description: "Waitlist position", content: { "application/json": { schema: WaitlistRequestAccessResponseSchema } } },
    400: { description: "Bad request (forwarded verbatim from downstream)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/waitlist/position",
  tags: ["Waitlist"],
  summary: "Look up waitlist position by email (no auth)",
  description:
    "Public pass-through to client-service GET /public/waitlist/position. " +
    "Response shape is owned by the downstream service.",
  request: {
    query: z.object({
      email: z
        .string()
        .email()
        .openapi({ description: "Email that signed up to the waitlist" }),
    }),
  },
  responses: {
    200: { description: "Waitlist position", content: { "application/json": { schema: WaitlistPositionResponseSchema } } },
    404: { description: "Email not on waitlist (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/{orgId}/invites/status",
  tags: ["Invites"],
  summary: "Get invite quota status for an org",
  description:
    "Pass-through to client-service GET /internal/orgs/{orgId}/invites/status. " +
    "Returns used / total quota and the org's invite code. " +
    "The {orgId} path segment MUST match the authenticated x-org-id; mismatch returns 403. " +
    "Response shape is owned by the downstream service.",
  security: authed,
  request: {
    params: z.object({
      orgId: z
        .string()
        .uuid()
        .openapi({ description: "Org UUID (must match authenticated org)" }),
    }),
  },
  responses: {
    200: { description: "Invite status", content: { "application/json": { schema: OrgInvitesStatusResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "orgId path does not match authenticated org", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/{orgId}/invites/claim",
  tags: ["Invites"],
  summary: "Claim an invite code for the authenticated org",
  description:
    "Pass-through to client-service POST /internal/invites/claim. " +
    "Send only { code }: the gateway supplies the downstream-required inviteeOrgId " +
    "from the authenticated identity, and discards any inviteeOrgId in the request body " +
    "so a caller can never claim on behalf of another org. " +
    "Downstream orchestrates: record claim row -> grant credits to inviter + invitee via " +
    "billing-service -> send the invite confirmation emails via " +
    "transactional-email-service. Idempotent on (code, inviteeOrgId). " +
    "The {orgId} path segment MUST match the authenticated x-org-id; mismatch returns 403. " +
    "Body + response shapes are owned by the downstream service.",
  security: authed,
  request: {
    params: z.object({
      orgId: z
        .string()
        .uuid()
        .openapi({ description: "Org UUID (must match authenticated org)" }),
    }),
    body: { content: { "application/json": { schema: OrgInvitesClaimRequestSchema } } },
  },
  responses: {
    200: { description: "Claim result", content: { "application/json": { schema: OrgInvitesClaimResponseSchema } } },
    400: { description: "Invalid code (forwarded verbatim from downstream)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "orgId path does not match authenticated org", content: errorContent },
    404: { description: "Unknown invite code (forwarded verbatim from downstream)", content: errorContent },
    409: {
      description:
        "Invite cap reached. Downstream body is forwarded field-for-field, including used / total.",
      content: { "application/json": { schema: OrgInvitesClaimResponseSchema } },
    },
  },
});

// ---------------------------------------------------------------------------
// Brand pause state — owned by CAMPAIGN-SERVICE (not brand-service).
// Proxies to campaign-service /brands/:brandId/pause.
// ---------------------------------------------------------------------------
const BrandPauseParam = z.object({
  brandId: z.string().describe("Brand ID"),
});

const BrandPauseRequestSchema = z
  .object({ paused: z.boolean().describe("Desired pause state for the brand") })
  .openapi("BrandPauseRequest");

// Passthrough — response shape owned by campaign-service (CLAUDE.md #8).
const BrandPauseResponseSchema = z.object({}).passthrough().openapi("BrandPauseResponse");

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/pause",
  tags: ["Campaigns"],
  summary: "Get a brand's pause state",
  description:
    "Proxy to campaign-service GET /brands/{brandId}/pause. " +
    "Returns the brand's pause state. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandPauseParam },
  responses: {
    200: { description: "Brand pause state", content: { "application/json": { schema: BrandPauseResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/brands/{brandId}/pause",
  tags: ["Campaigns"],
  summary: "Update a brand's pause state",
  description:
    "Proxy to campaign-service PATCH /brands/{brandId}/pause. " +
    "Body { paused: boolean }. Body + response shapes are owned by the downstream service.",
  security: authed,
  request: {
    params: BrandPauseParam,
    body: { content: { "application/json": { schema: BrandPauseRequestSchema } } },
  },
  responses: {
    200: { description: "Updated brand pause state", content: { "application/json": { schema: BrandPauseResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// Brand spendable budget — owned by CAMPAIGN-SERVICE (not brand-service).
// Proxies to campaign-service /brands/:brandId/spendable-budget.
// ---------------------------------------------------------------------------
const BrandSpendableBudgetParam = z.object({
  brandId: z.string().describe("Brand ID"),
});

// Passthrough — response shape owned by campaign-service (CLAUDE.md #8).
const BrandSpendableBudgetResponseSchema = z
  .object({})
  .passthrough()
  .openapi("BrandSpendableBudgetResponse");

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/spendable-budget",
  tags: ["Campaigns"],
  summary: "Get a brand's configured and actually-running daily budget",
  description:
    "Proxy to campaign-service GET /brands/{brandId}/spendable-budget. " +
    "Answers both figures for a brand: what the customer configured, and the part of it " +
    "attached to a campaign that is ongoing right now, with per-offer / per-campaign / " +
    "per-ceiling decompositions so no caller has to sum anything. Response shape is owned " +
    "by the downstream service.",
  security: authed,
  request: { params: BrandSpendableBudgetParam },
  responses: {
    200: {
      description: "Configured and running daily budget",
      content: { "application/json": { schema: BrandSpendableBudgetResponseSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// Brand reward tasks — owned by CLIENT-SERVICE (the reward-task ledger).
// Proxies to client-service /internal/brands/{brandId}/reward-tasks.
// ---------------------------------------------------------------------------
const BrandRewardTasksParam = z.object({
  brandId: z.string().describe("Brand ID"),
});

// Passthrough — response shape owned by client-service (CLAUDE.md #8).
const BrandRewardTasksResponseSchema = z
  .object({})
  .passthrough()
  .openapi("BrandRewardTasksResponse");

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/reward-tasks",
  tags: ["Rewards"],
  summary: "Get a brand's reward tasks and its per-offer / per-brand due counts",
  description:
    "Proxy to client-service GET /internal/brands/{brandId}/reward-tasks. " +
    "client-service owns the reward-task ledger; the org is the authenticated one, so a " +
    "caller cannot read a brand another org owns. Response shape is owned by the " +
    "downstream service and forwarded byte-for-byte.",
  security: authed,
  request: { params: BrandRewardTasksParam },
  responses: {
    200: {
      description: "The brand's reward tasks",
      content: { "application/json": { schema: BrandRewardTasksResponseSchema } },
    },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

// ===================================================================
// AUDIENCES (transparent proxy → human-service /orgs/audiences/*)
// ===================================================================
// Response schemas are passthrough — human-service owns the shape; api-service
// forwards bytes (CLAUDE.md rule #8). Request bodies are forwarded verbatim
// (rule #4), so the request body schemas below are passthrough too, present
// only for OpenAPI documentation.

const AudienceIdParam = z.object({
  id: z.string().describe("Audience ID"),
});

const AudienceResponse = z.object({}).passthrough().openapi("AudienceResponse");
const AudienceListResponse = z.object({}).passthrough().openapi("AudienceListResponse");
const AudienceMembersResponse = z.object({}).passthrough().openapi("AudienceMembersResponse");
const AudienceSuggestResponse = z.object({}).passthrough().openapi("AudienceSuggestResponse");
const AudienceStatsResponse = z.object({}).passthrough().openapi("AudienceStatsResponse");
const AudiencePassthroughBody = z.object({}).passthrough();

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/suggest",
  tags: ["Audiences"],
  summary: "Suggest candidate audiences from a natural-language prompt",
  description:
    "Proxy to human-service POST /orgs/audiences/suggest. Body { nlPrompt, brandId }. " +
    "Request + response shapes are owned by human-service — see its openapi.json. Forwarded untransformed.",
  security: authed,
  request: { body: { content: { "application/json": { schema: AudiencePassthroughBody } } } },
  responses: {
    200: { description: "Candidate audiences (human-service { candidates })", content: { "application/json": { schema: AudienceSuggestResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

const AudienceSplitResponse = z.object({}).passthrough().openapi("AudienceSplitResponse");
const AudienceSplitConfirmResponse = z.object({}).passthrough().openapi("AudienceSplitConfirmResponse");
const AudienceSplitEstimateResponse = z.object({}).passthrough().openapi("AudienceSplitEstimateResponse");

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/split",
  tags: ["Audiences"],
  summary: "Propose a split of a target audience into segments",
  description:
    "Proxy to human-service POST /orgs/audiences/split. Turns a target sentence into up to a few " +
    "non-overlapping segments; persists nothing. One LLM call plus a typed judgment, so it can take " +
    "up to a minute. Request + response shapes are owned by human-service. Downstream status and body " +
    "(400 validation, 502 on an LLM error) are forwarded verbatim.",
  security: authed,
  request: { body: { content: { "application/json": { schema: AudiencePassthroughBody } } } },
  responses: {
    200: { description: "Proposed segments (human-service shape)", content: { "application/json": { schema: AudienceSplitResponse } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    402: { description: "The org cannot afford the LLM call (forwarded verbatim)", content: errorContent },
    502: { description: "LLM error / human-service unreachable (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/split/confirm",
  tags: ["Audiences"],
  summary: "Create the kept segments of a split as audiences",
  description:
    "Proxy to human-service POST /orgs/audiences/split/confirm. Creates the segments the customer kept " +
    "as audiences under (brand, offer), all or nothing. Request + response shapes are owned by " +
    "human-service. Downstream status and body (400, 409 name conflict) are forwarded verbatim.",
  security: authed,
  request: { body: { content: { "application/json": { schema: AudiencePassthroughBody } } } },
  responses: {
    200: { description: "Created audiences (human-service shape)", content: { "application/json": { schema: AudienceSplitConfirmResponse } } },
    201: { description: "Created audiences (human-service shape)", content: { "application/json": { schema: AudienceSplitConfirmResponse } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: { description: "An audience with one of these names already exists (forwarded verbatim)", content: errorContent },
    502: { description: "human-service unreachable (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/split/estimate",
  tags: ["Audiences"],
  summary: "Estimate how many people each proposed segment holds",
  description:
    "Proxy to human-service POST /orgs/audiences/split/estimate. Body { brandId, offerId?, segments: " +
    "[{ name, description }] } (1 to 8 segments); returns { estimates: [{ name, estimatedPeople, " +
    "unavailableReason }] }. Persists nothing. Request + response shapes are owned by human-service. " +
    "Downstream status and body (400 validation, 502 on an outage) are forwarded verbatim.",
  security: authed,
  request: { body: { content: { "application/json": { schema: AudiencePassthroughBody } } } },
  responses: {
    200: { description: "Per-segment estimates (human-service shape)", content: { "application/json": { schema: AudienceSplitEstimateResponse } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Estimate provider / human-service unreachable (forwarded verbatim)", content: errorContent },
  },
});

const AudienceSignalResponse = z.object({}).passthrough().openapi("AudienceSignalResponse");

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/signal",
  tags: ["Audiences"],
  summary: "Create a buying-signal audience",
  description:
    "Proxy to human-service POST /orgs/audiences/signal. Creates an audience of people showing a buying " +
    "signal (first type: linkedin_engagement, people who engaged with competitor LinkedIn posts). Body " +
    "{ brandId, offerId?, name?, nlPrompt, status?, signal: { type, windowDays, competitorPages? } }; the " +
    "body's brandId is also forwarded as the x-brand-id identity header. Request + response shapes are owned " +
    "by human-service. Downstream status and body (400, 409 name conflict, the signal provider's named 4xx " +
    "such as a malformed competitor page) are forwarded verbatim.",
  security: authed,
  request: { body: { content: { "application/json": { schema: AudiencePassthroughBody } } } },
  responses: {
    201: { description: "Created audience (human-service { audience })", content: { "application/json": { schema: AudienceSignalResponse } } },
    400: { description: "Invalid body, or body brandId conflicts with x-brand-id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: { description: "An audience with this name already exists (forwarded verbatim)", content: errorContent },
    422: { description: "Signal criterion rejected by the provider (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error / human-service unreachable (forwarded verbatim)", content: errorContent },
  },
});

const AudiencePortfolioResponse = z.object({}).passthrough().openapi("AudiencePortfolioResponse");

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/portfolio",
  tags: ["Audiences"],
  summary: "Build the active audience portfolio of a brand + offer from its ICP",
  description:
    "Proxy to human-service POST /orgs/audiences/portfolio. Derives the active audiences (cold split " +
    "audiences + buying-signal audiences) for a brand + offer from the ICP text the customer validated. " +
    "Answers once the cold audiences exist (seconds) with status \"building\"; the buying-signal " +
    "audiences finish in the background and flip it to \"ready\". Poll the same POST until ready: a " +
    "replay of the same brand + offer returns the current set without re-spending. The gateway waits up " +
    "to 10 minutes upstream. Request + response shapes are owned by human-service; " +
    "downstream status and body (400, 409, 502) are forwarded verbatim.",
  security: authed,
  request: { body: { content: { "application/json": { schema: AudiencePassthroughBody } } } },
  responses: {
    200: { description: "The portfolio (human-service shape)", content: { "application/json": { schema: AudiencePortfolioResponse } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: { description: "Conflict (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error / human-service unreachable (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/stats",
  tags: ["Audiences"],
  summary: "Per-audience membership stats for a list of emails / personIds",
  description:
    "Proxy to human-service POST /orgs/audiences/stats. Request + response shapes owned by human-service. Forwarded untransformed.",
  security: authed,
  request: { body: { content: { "application/json": { schema: AudiencePassthroughBody } } } },
  responses: {
    200: { description: "Stats as returned by human-service", content: { "application/json": { schema: AudienceStatsResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences",
  tags: ["Audiences"],
  summary: "Create an audience",
  description:
    "Proxy to human-service POST /orgs/audiences. Request + response shapes owned by human-service. Forwarded untransformed.",
  security: authed,
  request: { body: { content: { "application/json": { schema: AudiencePassthroughBody } } } },
  responses: {
    200: { description: "Created audience", content: { "application/json": { schema: AudienceResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/audiences",
  tags: ["Audiences"],
  summary: "List audiences for an org",
  description:
    "Proxy to human-service GET /orgs/audiences. Optional brandId + status (lifecycle) filters + limit/offset pagination forwarded untransformed.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().uuid().optional().openapi({ description: "Brand ID filter" }),
      status: z.string().optional().openapi({ description: "Lifecycle filter (suggested|active|paused|archived) — forwarded to human-service" }),
      limit: z.coerce.number().int().optional().openapi({ description: "Max results (human-service enforces its own cap)" }),
      offset: z.coerce.number().int().optional().openapi({ description: "Pagination offset" }),
    }),
  },
  responses: {
    200: { description: "Audiences as returned by human-service", content: { "application/json": { schema: AudienceListResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/{id}/refresh-count",
  tags: ["Audiences"],
  summary: "Re-snapshot apollo + apify counts for an audience",
  description:
    "Proxy to human-service POST /orgs/audiences/{id}/refresh-count. Response shape owned by human-service. Forwarded untransformed.",
  security: authed,
  request: { params: AudienceIdParam },
  responses: {
    200: { description: "Updated audience counts", content: { "application/json": { schema: AudienceResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/{id}/avatar",
  tags: ["Audiences"],
  summary: "(Re)generate the audience's avatar",
  description:
    "Proxy to human-service POST /orgs/audiences/{id}/avatar. Optional body { prompt }. " +
    "human-service generates the avatar via chat-service (which owns the cost) and returns { audience } " +
    "with avatarUrl populated. Request + response shapes owned by human-service. Forwarded untransformed.",
  security: authed,
  request: {
    params: AudienceIdParam,
    body: { content: { "application/json": { schema: AudiencePassthroughBody } } },
  },
  responses: {
    200: { description: "Audience with regenerated avatar (human-service { audience })", content: { "application/json": { schema: AudienceResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/audiences/{id}/members",
  tags: ["Audiences"],
  summary: "List the canonical people who are members of an audience",
  description:
    "Proxy to human-service GET /orgs/audiences/{id}/members. limit/offset pagination forwarded untransformed.",
  security: authed,
  request: {
    params: AudienceIdParam,
    query: z.object({
      limit: z.coerce.number().int().optional().openapi({ description: "Max results (human-service enforces its own cap)" }),
      offset: z.coerce.number().int().optional().openapi({ description: "Pagination offset" }),
    }),
  },
  responses: {
    200: { description: "Members as returned by human-service", content: { "application/json": { schema: AudienceMembersResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

const AudiencePreviewResponse = z.object({}).passthrough().openapi("AudiencePreviewResponse");

registry.registerPath({
  method: "get",
  path: "/v1/orgs/audiences/{id}/preview",
  tags: ["Audiences"],
  summary: "A free sample of who an audience reaches",
  description:
    "Proxy to human-service GET /orgs/audiences/{id}/preview. Up to ~10 real companies and ~20 real people " +
    "matching the audience, never an email or a phone. Response shape owned by human-service. Forwarded untransformed; " +
    "upstream errors are forwarded with their status and body.",
  security: authed,
  request: { params: AudienceIdParam },
  responses: {
    200: { description: "Sample as returned by human-service", content: { "application/json": { schema: AudiencePreviewResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Audience not found for this org (forwarded verbatim)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

const AudiencePreviewEmailChecksResponse = z.object({}).passthrough().openapi("AudiencePreviewEmailChecksResponse");

registry.registerPath({
  method: "get",
  path: "/v1/orgs/audiences/{id}/preview/email-checks",
  tags: ["Audiences"],
  summary: "Where the email check of an audience preview stands",
  description:
    "Proxy to human-service GET /orgs/audiences/{id}/preview/email-checks. For the preview's first people: whether a " +
    "deliverable email was found and verified, by which finder. Free, never runs a reveal, never returns an address. " +
    "Response shape owned by human-service. Forwarded untransformed; upstream errors are forwarded with their status and body.",
  security: authed,
  request: { params: AudienceIdParam },
  responses: {
    200: { description: "Current state as returned by human-service", content: { "application/json": { schema: AudiencePreviewEmailChecksResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Audience not found for this org (forwarded verbatim)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / provider error (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/{id}/preview/email-checks/next",
  tags: ["Audiences"],
  summary: "Check one more person of an audience preview (billed)",
  description:
    "Proxy to human-service POST /orgs/audiences/{id}/preview/email-checks/next. Runs the billed email reveal + verification " +
    "for the next pending sampled person, charged to the caller's org, and returns the whole state. Call in a loop until done. " +
    "Never returns an address. Response shape owned by human-service. Forwarded untransformed; upstream errors are forwarded " +
    "with their status and body.",
  security: authed,
  request: { params: AudienceIdParam },
  responses: {
    200: { description: "State after this check, as returned by human-service", content: { "application/json": { schema: AudiencePreviewEmailChecksResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Audience not found for this org (forwarded verbatim)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / provider or verification error (forwarded verbatim)", content: errorContent },
  },
});

const AudiencePreviewCompaniesResponse = z.object({}).passthrough().openapi("AudiencePreviewCompaniesResponse");
const AudiencePreviewCompanyEmailChecksResponse = z
  .object({})
  .passthrough()
  .openapi("AudiencePreviewCompanyEmailChecksResponse");

registry.registerPath({
  method: "get",
  path: "/v1/orgs/audiences/{id}/preview/companies",
  tags: ["Audiences"],
  summary: "A page of the real companies an audience reaches",
  description:
    "Proxy to human-service GET /orgs/audiences/{id}/preview/companies. Free. The whole query string is forwarded verbatim " +
    "(offset and limit are the parameters documented today, not a whitelist). Response shape owned by human-service. Forwarded untransformed; upstream errors are forwarded with their status and body.",
  security: authed,
  request: {
    params: AudienceIdParam,
    query: z.object({
      offset: z.string().optional().describe("Forwarded verbatim to human-service"),
      limit: z.string().optional().describe("Forwarded verbatim to human-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Page as returned by human-service", content: { "application/json": { schema: AudiencePreviewCompaniesResponse } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Audience not found for this org (forwarded verbatim)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / provider error (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/audiences/{id}/preview/companies/email-checks",
  tags: ["Audiences"],
  summary: "Where the per-company email check of an audience preview stands",
  description:
    "Proxy to human-service GET /orgs/audiences/{id}/preview/companies/email-checks. Free, never runs a reveal, never returns " +
    "an address. Response shape owned by human-service. Forwarded untransformed; upstream errors are forwarded with their status and body.",
  security: authed,
  request: { params: AudienceIdParam },
  responses: {
    200: { description: "Current state as returned by human-service", content: { "application/json": { schema: AudiencePreviewCompanyEmailChecksResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Audience not found for this org (forwarded verbatim)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / provider error (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/audiences/{id}/preview/companies/{index}/email-check",
  tags: ["Audiences"],
  summary: "Check the email of the person to write to at one preview company (billed)",
  description:
    "Proxy to human-service POST /orgs/audiences/{id}/preview/companies/{index}/email-check. Runs the billed email reveal + " +
    "verification for that company's person, charged to the caller's org. No request body. Never returns an address. Response " +
    "shape owned by human-service. Forwarded untransformed; upstream errors are forwarded with their status and body.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().describe("Audience ID"),
      index: z.string().describe("Company index in the preview, forwarded verbatim"),
    }),
  },
  responses: {
    200: { description: "Result as returned by human-service", content: { "application/json": { schema: AudiencePreviewCompanyEmailChecksResponse } } },
    400: { description: "Invalid index (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    402: { description: "Insufficient credits (forwarded verbatim)", content: errorContent },
    404: { description: "Audience or company not found (forwarded verbatim)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / provider or verification error (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/audiences/{id}",
  tags: ["Audiences"],
  summary: "Get an audience by id",
  description:
    "Proxy to human-service GET /orgs/audiences/{id}. Response shape owned by human-service. Forwarded untransformed.",
  security: authed,
  request: { params: AudienceIdParam },
  responses: {
    200: { description: "Audience as returned by human-service", content: { "application/json": { schema: AudienceResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/orgs/audiences/{id}/status",
  tags: ["Audiences"],
  summary: "Change an audience's status (active / paused / archived)",
  description:
    "Proxy to human-service PATCH /orgs/audiences/{id}/status. Body { status } + response shapes owned by human-service. Forwarded untransformed.",
  security: authed,
  request: {
    params: AudienceIdParam,
    body: { content: { "application/json": { schema: AudiencePassthroughBody } } },
  },
  responses: {
    200: { description: "Updated audience", content: { "application/json": { schema: AudienceResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/orgs/audiences/{id}",
  tags: ["Audiences"],
  summary: "Update an audience",
  description:
    "Proxy to human-service PATCH /orgs/audiences/{id}. Request + response shapes owned by human-service. Forwarded untransformed.",
  security: authed,
  request: {
    params: AudienceIdParam,
    body: { content: { "application/json": { schema: AudiencePassthroughBody } } },
  },
  responses: {
    200: { description: "Updated audience", content: { "application/json": { schema: AudienceResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/orgs/audiences/{id}",
  tags: ["Audiences"],
  summary: "Delete an audience (cascades members)",
  description:
    "Proxy to human-service DELETE /orgs/audiences/{id}. Response shape owned by human-service. Forwarded untransformed.",
  security: authed,
  request: { params: AudienceIdParam },
  responses: {
    200: { description: "Deletion result as returned by human-service", content: { "application/json": { schema: AudienceResponse } } },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "human-service unreachable / not configured", content: errorContent },
  },
});

// ── CRM contacts + Matrix DMs (crm-service proxy) ────────────────────────────
// Transparent proxy of crm-service's org-scoped surface: CSV contact uploads and
// the Matrix DM ingest (WhatsApp / Telegram / Discord), both landing in the same
// contact registry. Request AND response shapes are owned by crm-service;
// passthrough only, per CLAUDE.md rules #6/#8 and its request-body corollary.
// crm-service's /internal/* routes (contacts/promote, matrix/sync, matrix/rebuild)
// are its cron-driven service-to-service tier and are deliberately not exposed.
const CrmPassthroughResponse = z.object({}).passthrough().openapi("CrmPassthroughResponse");
const CrmPassthroughRequest = z.object({}).passthrough().openapi("CrmPassthroughRequest");
const CrmUploadMultipartBody = z
  .object({
    file: z.string().openapi({ type: "string", format: "binary", description: "The CSV file to ingest" }),
    brandId: z.string().uuid().openapi({ description: "Brand the contacts belong to (required)" }),
    columnMapping: z
      .string()
      .optional()
      .openapi({ description: "Optional JSON column-mapping override" }),
  })
  .openapi("CrmUploadMultipartBody");

// The gateway forwards the inbound query string byte-for-byte, so a filter
// crm-service adds later needs no change here. `brandId` is documented because it
// is required downstream on every read; it is not the only param accepted.
const CrmBrandIdQuery = z.object({
  brandId: z.string().uuid().openapi({ description: "Brand ID (required by crm-service)" }),
});

const OrgUploadRequest = z
  .object({
    contentBase64: z
      .string()
      .describe("The file's bytes, base64. A `data:` URL is accepted; its media type is used when contentType is omitted."),
    folder: z.string().optional().describe("Key prefix in the bucket, e.g. `brand-logos`."),
    filename: z.string().optional().describe("Object filename; a UUID is minted when omitted."),
    contentType: z.string().optional().describe("MIME type; inferred from a data: URL when omitted."),
  })
  .passthrough()
  .openapi("OrgUploadRequest");

const OrgUploadResponse = z
  .object({
    id: z.string(),
    url: z.string().describe("Permanent public URL — renders in an <img> with no auth."),
    size: z.number(),
    contentType: z.string(),
  })
  .passthrough()
  .openapi("OrgUploadResponse");

registry.registerPath({
  method: "post",
  path: "/v1/orgs/uploads",
  tags: ["Uploads"],
  summary: "Upload an image the CUSTOMER owns and get its public URL",
  description:
    "Proxy to cloudflare-service POST /upload/base64, the ORG-scoped upload: the file belongs to the calling org, so a run is opened under it and the storage cost is declared against it. First caller is Brand Settings, where a customer replaces the logo their brand is shown with. The body is forwarded untransformed and the response shape (`{ id, url, size, contentType }`) is owned by cloudflare-service. Body size is bound by this gateway's 10mb JSON limit; base64 inflates a file by ~4/3, so roughly 7.5MB of image.",
  security: authed,
  request: { body: { content: { "application/json": { schema: OrgUploadRequest } } } },
  responses: {
    200: { description: "Stored; `url` is the public URL", content: { "application/json": { schema: OrgUploadResponse } } },
    400: { description: "Invalid body, forwarded verbatim from cloudflare-service", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "cloudflare-service unreachable, or the upload failed", content: errorContent },
  },
});

// ─── Google CRM (google-service /orgs/google/*) ─────────────────────────────
// Transparent passthrough: request and response bodies are owned by
// google-service (CLAUDE.md rule #8 and its request-body corollary). Query
// strings are byte-copied, so the params documented here are the ones known
// today, not a whitelist.
const GooglePassthroughResponse = z.object({}).passthrough().openapi("GooglePassthroughResponse");
const GooglePassthroughRequest = z.object({}).passthrough().openapi("GooglePassthroughRequest");
const googleErrorResponses = {
  400: { description: "Bad request, forwarded verbatim from google-service", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  404: { description: "Not found, forwarded verbatim from google-service (body carries a `reason`)", content: errorContent },
  500: { description: "Internal error", content: errorContent },
  502: { description: "google-service unreachable / not configured", content: errorContent },
};

const googleRoutes: Array<{
  method: "get" | "post" | "put" | "delete";
  path: string;
  summary: string;
  description: string;
  status?: number;
  body?: boolean;
  params?: z.AnyZodObject;
  query?: z.AnyZodObject;
}> = [
  {
    method: "post",
    path: "/v1/orgs/google/auth/start",
    summary: "Start connecting a Gmail mailbox (Google OAuth)",
    description:
      "Proxy to google-service POST /orgs/google/auth/start. Body `{ redirectUri? }` forwarded untransformed; returns `{ url, state }` where `url` is the Google consent screen. Requires x-user-id.",
    body: true,
  },
  {
    method: "get",
    path: "/v1/orgs/google/auth/callback",
    summary: "Complete Google OAuth (exchange code, store the mailbox)",
    description:
      "Proxy to google-service GET /orgs/google/auth/callback. The query string (`code`, `state`) is forwarded byte-identical.",
    query: z.object({ code: z.string().optional(), state: z.string().optional() }).passthrough(),
  },
  {
    method: "get",
    path: "/v1/orgs/google/accounts",
    summary: "List the org's connected Google mailboxes",
    description: "Proxy to google-service GET /orgs/google/accounts. Response `{ accounts: [...] }` owned by google-service.",
  },
  {
    method: "delete",
    path: "/v1/orgs/google/accounts/{email}",
    summary: "Disconnect a Google mailbox",
    description:
      "Proxy to google-service DELETE /orgs/google/accounts/{email}. Revokes the Google grant and deletes the mailbox and its mirror. The email is URL-encoded in the path. 404 `{ reason: \"account_not_found\" }` forwarded verbatim.",
    params: z.object({ email: z.string().openapi({ description: "Connected Google account email (URL-encoded)" }) }),
  },
  {
    method: "post",
    path: "/v1/orgs/google/sync",
    summary: "Start an async Gmail + contacts sync",
    description:
      "Proxy to google-service POST /orgs/google/sync. Answers 202 `{ jobId, status: \"running\" }`; the status is relayed as-is. Poll GET /v1/orgs/google/sync/{jobId}.",
    status: 202,
    body: true,
  },
  {
    method: "get",
    path: "/v1/orgs/google/sync/{jobId}",
    summary: "Poll a Google sync job",
    description: "Proxy to google-service GET /orgs/google/sync/{jobId}. 404 when the job belongs to another org.",
    params: z.object({ jobId: z.string() }),
  },
  {
    method: "get",
    path: "/v1/orgs/google/messages",
    summary: "List mirrored Gmail messages",
    description: "Proxy to google-service GET /orgs/google/messages. The whole query string is forwarded untransformed.",
    query: z
      .object({ limit: z.string().optional(), cursor: z.string().optional(), participant: z.string().optional() })
      .passthrough(),
  },
  {
    method: "get",
    path: "/v1/orgs/google/contacts",
    summary: "List mirrored Google contacts",
    description: "Proxy to google-service GET /orgs/google/contacts. The whole query string is forwarded untransformed.",
    query: z
      .object({ limit: z.string().optional(), cursor: z.string().optional(), query: z.string().optional() })
      .passthrough(),
  },
  {
    method: "get",
    path: "/v1/orgs/google/conversation",
    summary: "Read the whole exchange with one person from the mirror",
    description:
      "Proxy to google-service GET /orgs/google/conversation. `email` is required by google-service; the whole query string is forwarded untransformed. 404 reasons (`no_google_account_connected`, `no_messages`) forwarded verbatim.",
    query: z.object({ email: z.string().optional(), limit: z.string().optional() }).passthrough(),
  },
  {
    method: "get",
    path: "/v1/orgs/google/correspondents",
    summary: "List people the connected mailbox is in conversation with",
    description: "Proxy to google-service GET /orgs/google/correspondents. The whole query string is forwarded untransformed.",
    query: z.object({ limit: z.string().optional(), offset: z.string().optional() }).passthrough(),
  },
  {
    method: "put",
    path: "/v1/orgs/google/contact-links",
    summary: "Set the CRM links of a Google contact",
    description:
      "Proxy to google-service PUT /orgs/google/contact-links. Body `{ resourceName, orgIds, brandIds, featureSlugs, status? }` forwarded untransformed.",
    body: true,
  },
];

for (const route of googleRoutes) {
  registry.registerPath({
    method: route.method,
    path: route.path,
    tags: ["Google CRM"],
    summary: route.summary,
    description: route.description,
    security: authed,
    request: {
      ...(route.params ? { params: route.params } : {}),
      ...(route.query ? { query: route.query } : {}),
      ...(route.body
        ? { body: { content: { "application/json": { schema: GooglePassthroughRequest } } } }
        : {}),
    },
    responses: {
      [route.status ?? 200]: {
        description: "As returned by google-service",
        content: { "application/json": { schema: GooglePassthroughResponse } },
      },
      ...googleErrorResponses,
    },
  });
}

const crmErrorResponses = {
  400: { description: "Bad request, forwarded verbatim from crm-service", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  500: { description: "Internal error", content: errorContent },
  502: { description: "crm-service unreachable / not configured", content: errorContent },
};

registry.registerPath({
  method: "post",
  path: "/v1/orgs/contacts/upload",
  tags: ["CRM Contacts"],
  summary: "Upload a CSV of contacts (bronze ingest + async silver promotion)",
  description:
    "Proxy to crm-service POST /orgs/contacts/upload. Multipart body (field `file` = CSV, `brandId` required, optional `columnMapping`) is forwarded untransformed — the multipart boundary is preserved byte-for-byte. Requires x-user-id. Response shape owned by crm-service.",
  security: authed,
  request: { body: { content: { "multipart/form-data": { schema: CrmUploadMultipartBody } } } },
  responses: {
    200: { description: "Upload ingested (crm-service { uploadId, rowCount, status, mappingProvenance })", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/contacts",
  tags: ["CRM Contacts"],
  summary: "List silver contacts for a brand",
  description:
    "Proxy to crm-service GET /orgs/contacts. The whole query string is forwarded untransformed. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Contacts as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/contacts/uploads",
  tags: ["CRM Contacts"],
  summary: "List uploads and their status for a brand",
  description:
    "Proxy to crm-service GET /orgs/contacts/uploads. The whole query string is forwarded untransformed. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Uploads as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/contacts/serve-stats",
  tags: ["CRM Contacts"],
  summary: "Served vs remaining sendable counts for a brand",
  description:
    "Proxy to crm-service GET /orgs/contacts/serve-stats. The whole query string is forwarded untransformed, including a repeated or comma-separated `uploadIds` per-file scope. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Serve stats as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/contacts/serve-next",
  tags: ["CRM Contacts"],
  summary: "Serve the next batch of un-served contacts for a brand",
  description:
    "Proxy to crm-service POST /orgs/contacts/serve-next. Request body forwarded verbatim — crm-service owns its shape. Response shape owned by crm-service.",
  security: authed,
  request: { body: { content: { "application/json": { schema: CrmPassthroughRequest } } } },
  responses: {
    200: { description: "Served contacts as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/matrix/connections",
  tags: ["CRM Contacts"],
  summary: "Register (or update) a brand's Matrix DM connection",
  description:
    "Proxy to crm-service POST /orgs/matrix/connections — the WhatsApp / Telegram / Discord bridge a brand's inbound DMs arrive on. Request body forwarded verbatim. Requires x-user-id: crm-service persists the creator on the row so the sync cron can bill the org. Response shape owned by crm-service.",
  security: authed,
  request: { body: { content: { "application/json": { schema: CrmPassthroughRequest } } } },
  responses: {
    200: { description: "Connection as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/orgs/matrix/connections/{id}",
  tags: ["CRM Contacts"],
  summary: "Pause or resume a Matrix DM connection",
  description:
    "Proxy to crm-service PATCH /orgs/matrix/connections/{id}. Request body forwarded verbatim. Response shape owned by crm-service.",
  security: authed,
  request: {
    params: z.object({ id: z.string().uuid().openapi({ description: "Connection ID" }) }),
    body: { content: { "application/json": { schema: CrmPassthroughRequest } } },
  },
  responses: {
    200: { description: "Connection as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: { description: "No such connection (forwarded verbatim)", content: errorContent },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/matrix/connections",
  tags: ["CRM Contacts"],
  summary: "Matrix DM connection health for a brand",
  description:
    "Proxy to crm-service GET /orgs/matrix/connections. The whole query string is forwarded untransformed. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Connections as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/matrix/leads",
  tags: ["CRM Contacts"],
  summary: "Leads read out of a brand's inbound DM conversations",
  description:
    "Proxy to crm-service GET /orgs/matrix/leads — one row per conversation, carrying the LLM's reading plus the conversation counters and contact identity. The whole query string is forwarded untransformed. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Leads as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/matrix/links",
  tags: ["CRM Contacts"],
  summary: "Start linking a brand's WhatsApp / Telegram / Discord account",
  description:
    "Proxy to crm-service POST /orgs/matrix/links — starts a bridge login (QR or phone pairing code) the user completes on their phone. Request body forwarded verbatim. Requires x-user-id. Can take up to ~60s (pairing code). Status and body of every refusal are forwarded verbatim: 409 when the channel is not available yet, 422 when the bridge refused (e.g. a bad phone number). Response shape owned by crm-service.",
  security: authed,
  request: { body: { content: { "application/json": { schema: CrmPassthroughRequest } } } },
  responses: {
    200: { description: "Link as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    409: { description: "Channel unavailable (forwarded verbatim)", content: errorContent },
    422: { description: "The bridge refused the login (forwarded verbatim)", content: errorContent },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/matrix/links",
  tags: ["CRM Contacts"],
  summary: "Current link state per channel for a brand",
  description:
    "Proxy to crm-service GET /orgs/matrix/links — one link per channel, carrying the current QR / pairing code while the user scans. Polled every few seconds by the dashboard. The whole query string is forwarded untransformed. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Links as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/orgs/matrix/links/{channel}",
  tags: ["CRM Contacts"],
  summary: "Unlink a brand's WhatsApp / Telegram / Discord account",
  description:
    "Proxy to crm-service DELETE /orgs/matrix/links/{channel}. The whole query string is forwarded untransformed. Response shape owned by crm-service.",
  security: authed,
  request: {
    params: z.object({ channel: z.string().openapi({ description: "Channel (whatsapp, telegram, discord)" }) }),
    query: CrmBrandIdQuery,
  },
  responses: {
    200: { description: "Unlink result as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: { description: "No such link (forwarded verbatim)", content: errorContent },
    ...crmErrorResponses,
  },
});

// ── GoHighLevel mirror (crm-service proxy) ───────────────────────────────────
// A brand's GoHighLevel sub-account, mirrored: its contacts and its sales
// pipeline. The credential lives brand-scoped in key-service (see
// /v1/keys/brands/{brandId}) and crm-service resolves it server-side — no token
// crosses this surface. crm-service's /internal/gohighlevel/* sync + rebuild
// triggers are cron-driven and are not exposed.
const GhlConnectionIdParam = z.object({
  id: z.string().uuid().openapi({ description: "Connection ID" }),
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/gohighlevel/connections",
  tags: ["CRM Contacts"],
  summary: "Connect a brand to GoHighLevel",
  description:
    "Proxy to crm-service POST /orgs/gohighlevel/connections. Body (`{ brandId, locationId }`) forwarded verbatim. Requires x-user-id: crm-service persists the creator so the sync cron can attribute the org run it opens. The connection is written only once the credential has been PROVEN against GoHighLevel, so a token GoHighLevel refuses comes back 400 carrying the vendor's own status and message (`vendorStatus`, `vendorError`) field-for-field — that body is what tells the customer which field to fix. Response shape owned by crm-service.",
  security: authed,
  request: { body: { content: { "application/json": { schema: CrmPassthroughRequest } } } },
  responses: {
    200: { description: "Connection as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/orgs/gohighlevel/connections/{id}",
  tags: ["CRM Contacts"],
  summary: "Pause or resume a GoHighLevel connection",
  description:
    "Proxy to crm-service PATCH /orgs/gohighlevel/connections/{id}. Body forwarded verbatim — crm-service owns the status vocabulary. A paused connection is skipped by every sync pass. Response shape owned by crm-service.",
  security: authed,
  request: {
    params: GhlConnectionIdParam,
    body: { content: { "application/json": { schema: CrmPassthroughRequest } } },
  },
  responses: {
    200: { description: "Connection as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: { description: "No such connection (forwarded verbatim)", content: errorContent },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/orgs/gohighlevel/connections/{id}",
  tags: ["CRM Contacts"],
  summary: "Disconnect a brand from GoHighLevel",
  description:
    "Proxy to crm-service DELETE /orgs/gohighlevel/connections/{id}. The connection row goes and, with it, the mirrored records and the silver contacts derived from them. Response shape owned by crm-service.",
  security: authed,
  request: { params: GhlConnectionIdParam },
  responses: {
    200: { description: "Disconnection result as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: { description: "No such connection (forwarded verbatim)", content: errorContent },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/gohighlevel/connections",
  tags: ["CRM Contacts"],
  summary: "GoHighLevel connection health for a brand",
  description:
    "Proxy to crm-service GET /orgs/gohighlevel/connections — is it working, when did it last sync, why not. The whole query string is forwarded untransformed. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Connections as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/gohighlevel/contacts",
  tags: ["CRM Contacts"],
  summary: "A brand's mirrored GoHighLevel contacts",
  description:
    "Proxy to crm-service GET /orgs/gohighlevel/contacts. The whole query string is forwarded untransformed: `brandId` (required downstream), plus the `limit` / `offset` crm-service accepts today and anything it adds later. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Contacts as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/gohighlevel/contacts/origins",
  tags: ["CRM Contacts"],
  summary: "Where a brand's GoHighLevel contacts came from",
  description:
    "Proxy to crm-service GET /orgs/gohighlevel/contacts/origins — the brand's mirrored contacts counted by lead source, origin medium, contact type and tag, over the whole mirrored population. The whole query string is forwarded untransformed (`brandId` required downstream). Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Origin breakdown as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/gohighlevel/opportunities",
  tags: ["CRM Contacts"],
  summary: "A brand's GoHighLevel sales pipeline",
  description:
    "Proxy to crm-service GET /orgs/gohighlevel/opportunities — opportunities grouped by pipeline then stage, exactly as GoHighLevel groups them. The whole query string is forwarded untransformed. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Pipeline view as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

// ── PostHog + Stripe connections (crm-service proxy) ─────────────────────────
// A brand's PostHog project (visits) and Stripe account (payments), read-only
// sources of the person thread. The credential is stored through
// /v1/keys/brands/{brandId} (provider `posthog` / `stripe`); crm-service resolves
// it server-side. Its /internal/posthog/* + /internal/stripe/* tier is not exposed.
for (const [provider, label, createBody] of [
  ["posthog", "PostHog", "`{ brandId, projectId, region }` (region `us` | `eu`)"],
  ["stripe", "Stripe", "`{ brandId }`"],
] as const) {
  registry.registerPath({
    method: "post",
    path: `/v1/orgs/${provider}/connections`,
    tags: ["CRM Contacts"],
    summary: `Connect a brand to ${label}`,
    description:
      `Proxy to crm-service POST /orgs/${provider}/connections. Body (${createBody}) forwarded verbatim. Requires x-user-id: crm-service persists the creator so the sync cron can attribute the org run it opens. The connection is written only once the credential has been PROVEN against ${label}, so a credential ${label} refuses comes back 400 carrying \`{ type, error, vendorStatus, vendorError }\` field-for-field. Response shape owned by crm-service.`,
    security: authed,
    request: { body: { content: { "application/json": { schema: CrmPassthroughRequest } } } },
    responses: {
      200: { description: "Connection as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
      ...crmErrorResponses,
    },
  });

  registry.registerPath({
    method: "patch",
    path: `/v1/orgs/${provider}/connections/{id}`,
    tags: ["CRM Contacts"],
    summary: `Pause or resume a ${label} connection`,
    description:
      `Proxy to crm-service PATCH /orgs/${provider}/connections/{id}. Body (\`{ status }\`) forwarded verbatim — crm-service owns the status vocabulary. Response shape owned by crm-service.`,
    security: authed,
    request: {
      params: GhlConnectionIdParam,
      body: { content: { "application/json": { schema: CrmPassthroughRequest } } },
    },
    responses: {
      200: { description: "Connection as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
      404: { description: "No such connection (forwarded verbatim)", content: errorContent },
      ...crmErrorResponses,
    },
  });

  registry.registerPath({
    method: "delete",
    path: `/v1/orgs/${provider}/connections/{id}`,
    tags: ["CRM Contacts"],
    summary: `Disconnect a brand from ${label}`,
    description: `Proxy to crm-service DELETE /orgs/${provider}/connections/{id}. Response shape owned by crm-service.`,
    security: authed,
    request: { params: GhlConnectionIdParam },
    responses: {
      200: { description: "Disconnection result as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
      404: { description: "No such connection (forwarded verbatim)", content: errorContent },
      ...crmErrorResponses,
    },
  });

  registry.registerPath({
    method: "get",
    path: `/v1/orgs/${provider}/connections`,
    tags: ["CRM Contacts"],
    summary: `${label} connection health for a brand`,
    description: `Proxy to crm-service GET /orgs/${provider}/connections. The whole query string is forwarded untransformed. Response shape owned by crm-service.`,
    security: authed,
    request: { query: CrmBrandIdQuery },
    responses: {
      200: { description: "Connections as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
      ...crmErrorResponses,
    },
  });
}

// ── People (crm-service proxy) ───────────────────────────────────────────────
// One person, every channel (Gmail, cold email, WhatsApp / Telegram / Discord,
// GoHighLevel) merged into one thread with one state. crm-service requires
// x-user-id on all three. Its /internal/people/sync cron trigger is not exposed.
const CrmPeopleListQuery = CrmBrandIdQuery.extend({
  limit: z.string().optional().openapi({ description: "Page size, validated by crm-service" }),
  offset: z.string().optional().openapi({ description: "Page offset, validated by crm-service" }),
  source: z.string().optional().openapi({ description: "Channel filter, vocabulary owned by crm-service" }),
});
const CrmPeopleTimelineQuery = CrmBrandIdQuery.extend({
  personKey: z.string().openapi({ description: "Person key as returned by GET /v1/orgs/people (URL-encode it, e.g. email%3Aalice%40acme.com)" }),
});
registry.registerPath({
  method: "get",
  path: "/v1/orgs/people",
  tags: ["CRM Contacts"],
  summary: "A brand's people, every channel merged",
  description:
    "Proxy to crm-service GET /orgs/people — one row per person, every channel they reached the brand on merged into one state. The whole query string is forwarded untransformed (`brandId` required downstream, plus `limit`, `offset`, `source`). Requires x-user-id. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmPeopleListQuery },
  responses: {
    200: { description: "People as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/people/timeline",
  tags: ["CRM Contacts"],
  summary: "One person's merged thread across every channel",
  description:
    "Proxy to crm-service GET /orgs/people/timeline. The whole query string is forwarded byte-for-byte (`brandId`, `personKey` — a personKey such as `email:alice@acme.com` must be URL-encoded). Requires x-user-id. An unknown person comes back 404 with crm-service's body verbatim. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmPeopleTimelineQuery },
  responses: {
    200: { description: "Timeline as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: { description: "Person not found (forwarded verbatim)", content: errorContent },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/people/sync",
  tags: ["CRM Contacts"],
  summary: "Refresh a brand's merged people now",
  description:
    "Proxy to crm-service POST /orgs/people/sync. Body (`{ brandId }`) forwarded verbatim. Requires x-user-id. crm-service accepts the work and runs it in the background, answering 202; the status crosses unchanged. Response shape owned by crm-service.",
  security: authed,
  request: { body: { content: { "application/json": { schema: CrmPassthroughRequest } } } },
  responses: {
    202: { description: "Accepted, as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

// ===================================================================
// Mailing Lists (proxy to transactional-email-service /mailing-lists/:slug/*)
//
// Platform-level (org-less) lists of bare email addresses — "investors" is the
// first — that staff read, add to, prune, and mail a written update to from the
// staff console. STAFF-ONLY: authenticate + requireOrg + requireStaff (the org
// is identity, not scope; the allowlisted x-email is what gates access).
//
// Every request and response shape below is owned by transactional-email-service.
// Passthrough only — nothing is re-declared, nothing is capped, and a field added
// downstream later arrives at the caller with no change here.
// ===================================================================
const MailingListPassthroughResponse = z
  .object({})
  .passthrough()
  .openapi("MailingListPassthroughResponse");
const MailingListSubscribersAddRequest = z
  .object({})
  .passthrough()
  .openapi("MailingListSubscribersAddRequest");
const MailingListUpdateRequest = z
  .object({})
  .passthrough()
  .openapi("MailingListUpdateRequest");

const MailingListSlugParam = z.object({
  slug: z
    .string()
    .describe('List slug, e.g. "investors". Lower-case letters, digits and hyphens.'),
});

const mailingListErrorResponses = {
  400: { description: "Invalid slug, or a bad request forwarded verbatim from transactional-email-service", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Staff access required — the caller is not on the staff allowlist", content: errorContent },
  404: { description: "No such list (forwarded verbatim)", content: errorContent },
  500: { description: "Upstream error", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/mailing-lists/{slug}/subscribers",
  tags: ["Mailing Lists"],
  summary: "Read a mailing list's subscribers (staff only)",
  description:
    "Proxy to transactional-email-service GET /mailing-lists/{slug}/subscribers. Each " +
    "subscriber states whether the provider is currently suppressing it — the member used " +
    "the native unsubscribe, complained, or hard-bounced. That opt-out state is read live " +
    "from Postmark's broadcast stream on every request and is stored nowhere in this " +
    "gateway. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: MailingListSlugParam },
  responses: {
    200: { description: "Subscribers with live opt-out state", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListErrorResponses,
    502: { description: "Provider suppression state unavailable (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/mailing-lists/{slug}/subscribers",
  tags: ["Mailing Lists"],
  summary: "Add addresses to a mailing list in bulk (staff only)",
  description:
    "Proxy to transactional-email-service POST /mailing-lists/{slug}/subscribers. The body " +
    "carries a pasted blob of addresses; downstream parses it leniently, creates the list on " +
    "first use, and reports what was added, skipped and rejected. Re-pasting the same blob is " +
    "a no-op. The gateway forwards the body as-is and validates nothing — body and response " +
    "shapes are owned by the downstream service.",
  security: authed,
  request: {
    params: MailingListSlugParam,
    body: { content: { "application/json": { schema: MailingListSubscribersAddRequest } } },
  },
  responses: {
    200: { description: "What was added, skipped and rejected", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListErrorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/mailing-lists/{slug}/subscribers",
  tags: ["Mailing Lists"],
  summary: "Remove an address from a mailing list (staff only)",
  description:
    "Proxy to transactional-email-service DELETE /mailing-lists/{slug}/subscribers. The query " +
    "string is forwarded byte-for-byte, so `email` reaches downstream exactly as sent. " +
    "Removing an address is not the same as opting it out: suppression lives with the " +
    "provider, and a removed address that is still suppressed stays suppressed.",
  security: authed,
  request: {
    params: MailingListSlugParam,
    query: z.object({
      email: z.string().openapi({ description: "The address to remove (required)" }),
    }),
  },
  responses: {
    200: { description: "Removal outcome", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/mailing-lists/updates/preview",
  tags: ["Mailing Lists"],
  summary: "Render an update as a recipient will see it, without sending it (staff only)",
  description:
    "Proxy to transactional-email-service POST /mailing-lists/updates/preview. The body carries " +
    "a markdown body; downstream returns the HTML a recipient would receive, rendered by the " +
    "same code a real send uses, plus any image URLs no mail client renders. Nothing is sent, " +
    "nothing is recorded, no suppression list is read. It takes no list slug because a body " +
    "renders identically whoever receives it. Body and response shapes are owned by the " +
    "downstream service.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: MailingListUpdateRequest } } },
  },
  responses: {
    200: { description: "The body as it would arrive", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/mailing-lists/{slug}/updates",
  tags: ["Mailing Lists"],
  summary: "Send a written update to a mailing list (staff only)",
  description:
    "Proxy to transactional-email-service POST /mailing-lists/{slug}/updates. The body carries " +
    "a subject and a markdown body; downstream renders it to HTML, sends ONE message per " +
    "recipient (so no recipient is visible to another), skips members the provider is " +
    "suppressing, and appends the unsubscribe itself. A partial failure comes back as " +
    "`partial` with the failing addresses and reasons, never as a clean success. Body and " +
    "response shapes are owned by the downstream service.",
  security: authed,
  request: {
    params: MailingListSlugParam,
    body: { content: { "application/json": { schema: MailingListUpdateRequest } } },
  },
  responses: {
    200: { description: "Send outcome, including anyone skipped or failed", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/mailing-lists/{slug}/updates",
  tags: ["Mailing Lists"],
  summary: "Read the updates already sent to a mailing list (staff only)",
  description:
    "Proxy to transactional-email-service GET /mailing-lists/{slug}/updates. Returns every " +
    "update with its subject, the body as sent, when it went out, and how many people it " +
    "reached. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: MailingListSlugParam },
  responses: {
    200: { description: "Update history, newest first", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListErrorResponses,
  },
});

// ===================================================================
// Mailing-list releases (proxy to transactional-email-service
// /mailing-lists/:slug/releases and /mailing-lists/releases/:releaseId/*)
//
// A release is one written update sent to a list over several days at a stated
// daily pace — the only way to send the 30,013-address newsletter — watchable,
// re-paceable, pausable, resumable and cancellable from the staff console.
// STAFF-ONLY, same gate as the rest of the Mailing Lists family.
//
// Every request and response shape below is owned by transactional-email-service.
// Passthrough only. The status codes are contract too: 201 means a release was
// created, 200 means an identical live one already existed and was returned
// instead, and 409 is a refusal whose words the caller has to be able to read.
// ===================================================================
const MailingListReleaseRequest = z
  .object({})
  .passthrough()
  .openapi("MailingListReleaseRequest");

const MailingListReleaseIdParam = z.object({
  releaseId: z.string().describe("The release's id, as returned when it was created."),
});

const mailingListReleaseErrorResponses = {
  ...mailingListErrorResponses,
  409: {
    description:
      "The release refuses the transition, or refuses a pace it cannot deliver " +
      "(forwarded verbatim, with the reason)",
    content: errorContent,
  },
};

registry.registerPath({
  method: "post",
  path: "/v1/mailing-lists/{slug}/releases",
  tags: ["Mailing Lists"],
  summary: "Start a paced release of an update to a mailing list (staff only)",
  description:
    "Proxy to transactional-email-service POST /mailing-lists/{slug}/releases. The body " +
    "carries the same subject and markdown body a single-request update takes, plus the " +
    "daily limit the send is paced at; downstream enrols every subscriber and mails them " +
    "over as many days as that pace needs, without holding a connection open. Answers 201 " +
    "when a release was created and 200 when an identical one was already running — both " +
    "cross unchanged. Body and response shapes are owned by the downstream service.",
  security: authed,
  request: {
    params: MailingListSlugParam,
    body: { content: { "application/json": { schema: MailingListReleaseRequest } } },
  },
  responses: {
    200: { description: "An identical live release already existed and is returned instead", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    201: { description: "The release was created and has started", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListReleaseErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/mailing-lists/{slug}/releases",
  tags: ["Mailing Lists"],
  summary: "Read a mailing list's releases (staff only)",
  description:
    "Proxy to transactional-email-service GET /mailing-lists/{slug}/releases. Response " +
    "shape is owned by the downstream service.",
  security: authed,
  request: { params: MailingListSlugParam },
  responses: {
    200: { description: "The list's releases", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListReleaseErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/mailing-lists/releases/{releaseId}",
  tags: ["Mailing Lists"],
  summary: "Watch one release (staff only)",
  description:
    "Proxy to transactional-email-service GET /mailing-lists/releases/{releaseId}. Reports " +
    "where the release has got to — how many addresses are done, how many are left, and at " +
    "what pace. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: MailingListReleaseIdParam },
  responses: {
    200: { description: "The release's current state", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListReleaseErrorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/mailing-lists/releases/{releaseId}/pace",
  tags: ["Mailing Lists"],
  summary: "Change a release's daily pace (staff only)",
  description:
    "Proxy to transactional-email-service PATCH /mailing-lists/releases/{releaseId}/pace. " +
    "Downstream refuses a pace it cannot deliver, and refuses to re-pace a release that is " +
    "already finished; the refusal comes back as a 409 with its own words, which the caller " +
    "needs to read. Body and response shapes are owned by the downstream service.",
  security: authed,
  request: {
    params: MailingListReleaseIdParam,
    body: { content: { "application/json": { schema: MailingListReleaseRequest } } },
  },
  responses: {
    200: { description: "The release at its new pace", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListReleaseErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/mailing-lists/releases/{releaseId}/pause",
  tags: ["Mailing Lists"],
  summary: "Hold a release (staff only)",
  description:
    "Proxy to transactional-email-service POST /mailing-lists/releases/{releaseId}/pause. " +
    "Nothing further is sent until it is resumed. A release that is not in a pausable state " +
    "refuses with a 409 forwarded verbatim. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: MailingListReleaseIdParam },
  responses: {
    200: { description: "The release, now held", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListReleaseErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/mailing-lists/releases/{releaseId}/resume",
  tags: ["Mailing Lists"],
  summary: "Let a held release continue (staff only)",
  description:
    "Proxy to transactional-email-service POST /mailing-lists/releases/{releaseId}/resume. " +
    "A release that is not held refuses with a 409 forwarded verbatim. Response shape is " +
    "owned by the downstream service.",
  security: authed,
  request: { params: MailingListReleaseIdParam },
  responses: {
    200: { description: "The release, sending again", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListReleaseErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/mailing-lists/releases/{releaseId}/cancel",
  tags: ["Mailing Lists"],
  summary: "Stop a release for good (staff only)",
  description:
    "Proxy to transactional-email-service POST /mailing-lists/releases/{releaseId}/cancel. " +
    "Addresses that were never going to be mailed are settled rather than left pending. A " +
    "cancelled release cannot be resumed — sending the rest of the update is a new release. " +
    "Response shape is owned by the downstream service.",
  security: authed,
  request: { params: MailingListReleaseIdParam },
  responses: {
    200: { description: "The release, cancelled", content: { "application/json": { schema: MailingListPassthroughResponse } } },
    ...mailingListReleaseErrorResponses,
  },
});

// ===================================================================
// Platform uploads (proxy to cloudflare-service POST /internal/upload/base64)
//
// A platform asset — ours, not any customer org's. Staff pick a file in the
// browser, the gateway forwards the bytes to cloudflare-service's platform
// (org-less) upload, and the permanent public URL comes back for the composer
// to put in an email. STAFF-ONLY: authenticatePlatform + requireStaff.
//
// Request and response shapes are owned by cloudflare-service. Passthrough
// only — nothing is re-declared, nothing is capped, and a field added
// downstream later arrives at the caller with no change here.
// ===================================================================
const PlatformUploadRequest = z
  .object({})
  .passthrough()
  .openapi("PlatformUploadRequest");
const PlatformUploadResponse = z
  .object({})
  .passthrough()
  .openapi("PlatformUploadResponse");

registry.registerPath({
  method: "post",
  path: "/v1/platform-uploads",
  tags: ["Platform Uploads"],
  summary: "Upload a platform file and get its public URL (staff only)",
  description:
    "Proxy to cloudflare-service POST /internal/upload/base64. The body carries the file " +
    "as base64 (`contentBase64`, data-URL prefixes accepted) plus the optional `folder`, " +
    "`filename` and `contentType` cloudflare-service documents; it is forwarded as-is and " +
    "validated nowhere in this gateway. The file is stored on our own R2 as a PLATFORM " +
    "asset — no org owns it, no org is billed for it — and the response carries the " +
    "permanent public `url`, which renders in an <img> with no auth. A ~5MB image is ~6.7MB " +
    "base64, within this gateway's 10mb JSON body limit. Body and response shapes are owned " +
    "by the downstream service.",
  security: platformAuth,
  request: {
    body: { content: { "application/json": { schema: PlatformUploadRequest } } },
  },
  responses: {
    200: { description: "The stored file, including its permanent public URL", content: { "application/json": { schema: PlatformUploadResponse } } },
    400: { description: "Invalid body, forwarded verbatim from cloudflare-service", content: errorContent },
    401: { description: "Invalid or missing platform API key", content: errorContent },
    403: { description: "Staff access required — the caller is not on the staff allowlist", content: errorContent },
    502: { description: "Upload failed (forwarded verbatim), or the cloudflare-service env vars are unset", content: errorContent },
  },
});

// ===================================================================
// Qualification (proxy to lead-service /orgs/qualification/catalog,
// /orgs/brands/:brandId/offers/:offerId/qualification/*, /orgs/leads/:id/qualification).
// Downstream owns every body and response shape (rule #8).
// ===================================================================
const QualificationResponseSchema = z.object({}).passthrough().openapi("QualificationResponse");
const QualificationPassthroughBody = z.object({}).passthrough();
const QualificationOfferParams = z.object({
  id: z.string().describe("Brand ID (also forwarded as x-brand-id)"),
  offerId: z.string().describe("Offer ID"),
});
const QualificationCriterionParams = QualificationOfferParams.extend({
  criterionId: z.string().describe("Criterion ID"),
});
const qualificationResponses = (ok: number, okDescription: string) => ({
  [ok]: { description: okDescription, content: { "application/json": { schema: QualificationResponseSchema } } },
  400: { description: "Validation error (forwarded verbatim), or x-brand-id conflicting with the path", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  402: { description: "Insufficient credit (forwarded verbatim, spending routes)", content: errorContent },
  404: { description: "Not found (forwarded verbatim)", content: errorContent },
  500: { description: "Upstream error", content: errorContent },
});

registry.registerPath({
  method: "get",
  path: "/v1/qualification/catalog",
  tags: ["Leads"],
  summary: "Qualification check catalogue, with estimated cost per lead",
  description: "Pass-through to lead-service GET /orgs/qualification/catalog. Response shape is owned by lead-service.",
  security: authed,
  responses: qualificationResponses(200, "Downstream body, untouched"),
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/offers/{offerId}/qualification/suggestions",
  tags: ["Leads"],
  summary: "Suggest qualification criteria for an offer (spends; written OFF)",
  description:
    "Pass-through to lead-service POST /orgs/brands/{brandId}/offers/{offerId}/qualification/suggestions. " +
    "Spends on the org's behalf under a child run of the caller's run.",
  security: authed,
  request: { params: QualificationOfferParams, body: { content: { "application/json": { schema: QualificationPassthroughBody } } } },
  responses: qualificationResponses(200, "Downstream body, untouched"),
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/offers/{offerId}/qualification/criteria",
  tags: ["Leads"],
  summary: "Create a qualification criterion on an offer",
  description:
    "Pass-through to lead-service POST /orgs/brands/{brandId}/offers/{offerId}/qualification/criteria. Body is " +
    "forwarded verbatim; lead-service owns its shape and its 400 `unusable_probe`.",
  security: authed,
  request: { params: QualificationOfferParams, body: { content: { "application/json": { schema: QualificationPassthroughBody } } } },
  responses: qualificationResponses(201, "Created (downstream body, untouched)"),
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/qualification/criteria",
  tags: ["Leads"],
  summary: "List an offer's qualification criteria, with on/off, mode and pass rate",
  description: "Pass-through to lead-service GET /orgs/brands/{brandId}/offers/{offerId}/qualification/criteria.",
  security: authed,
  request: { params: QualificationOfferParams },
  responses: qualificationResponses(200, "Downstream body, untouched"),
});

registry.registerPath({
  method: "patch",
  path: "/v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}",
  tags: ["Leads"],
  summary: "Turn a qualification criterion on/off or change its mode",
  description:
    "Pass-through to lead-service PATCH /orgs/brands/{brandId}/offers/{offerId}/qualification/criteria/{criterionId}.",
  security: authed,
  request: { params: QualificationCriterionParams, body: { content: { "application/json": { schema: QualificationPassthroughBody } } } },
  responses: qualificationResponses(200, "Downstream body, untouched"),
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}",
  tags: ["Leads"],
  summary: "Archive a qualification criterion",
  description:
    "Pass-through to lead-service DELETE /orgs/brands/{brandId}/offers/{offerId}/qualification/criteria/{criterionId}.",
  security: authed,
  request: { params: QualificationCriterionParams },
  responses: qualificationResponses(200, "Downstream body, untouched"),
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}/sample",
  tags: ["Leads"],
  summary: "Run a qualification criterion on a sample of real leads (spends)",
  description:
    "Pass-through to lead-service POST /orgs/brands/{brandId}/offers/{offerId}/qualification/criteria/{criterionId}/sample. " +
    "Body `{limit}` or `{leadIds}` is forwarded verbatim. Spends on the org's behalf under a child run of the caller's run.",
  security: authed,
  request: { params: QualificationCriterionParams, body: { content: { "application/json": { schema: QualificationPassthroughBody } } } },
  responses: qualificationResponses(200, "Downstream body, untouched"),
});

registry.registerPath({
  method: "get",
  path: "/v1/leads/{id}/qualification",
  tags: ["Leads"],
  summary: "What the qualification checks say about one lead",
  description:
    "Pass-through to lead-service GET /orgs/leads/{id}/qualification: per enabled criterion, the verdict, the " +
    "evidence and the screenshot. The query string is forwarded verbatim (lead-service documents `brandId`, " +
    "required, and `offerId`, optional, today).",
  security: authed,
  request: {
    params: z.object({ id: z.string().describe("Lead ID") }),
    query: z.object({ brandId: z.string().describe("Brand ID"), offerId: z.string().optional().describe("Offer ID") }).passthrough(),
  },
  responses: qualificationResponses(200, "Downstream body, untouched"),
});
