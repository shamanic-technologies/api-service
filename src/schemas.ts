import { z } from "zod";
// Side effect: zod 3 wording for default validation messages (API response shape).
import "./lib/zod-v3-messages.js";
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
export const SalesFunnelCapSchema = z
  .object({
    salesFunnelId: z.string().optional(),
    salesFunnelCampaignId: z.string().nullable().optional(),
    amountCents: z.string().optional().describe("The campaign's max budget for the period, in cents (decimal string, as billing-service sends it)"),
    period: z.string().optional(),
    consumedCents: z.string().nullable().optional().describe("Spent so far in the period, in cents; null when it could not be measured"),
    reservedCents: z.string().optional(),
  })
  .passthrough()
  .openapi("SalesFunnelCap");

export const ErrorResponseSchema = z
  .object({
    error: z.string().describe("Error message"),
    reason: z
      .string()
      .optional()
      .describe(
        "On a 402 only: present when the spend was refused because the campaign (sales funnel) reached its MAX BUDGET " +
          "(`sales_funnel_max_budget_reached`) or its max budget could not be read (`sales_funnel_max_budget_unreadable`). " +
          "Adding credit does not help: raise the campaign's max budget. Absent on a plain insufficient-balance refusal.",
      ),
    sales_funnel_cap: SalesFunnelCapSchema.optional().describe("On a 402 with `reason`: the cap billing-service applied, verbatim"),
    message: z.string().optional().describe("Plain-words explanation, when the error carries one"),
  })
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
    "It describes every operation you can call with your API key. The response carries an `ETag`; send it back as " +
    "`If-None-Match` and an unchanged document answers 304 with no body.",
  request: {
    query: z.object({
      view: z.enum(["full", "onboarding"]).optional().describe(
        "`onboarding`: only the operations that open a first client (brand, offer, audience, email preview, prepay, campaign), in order, with what each answers (about 100 KB). Omit for the full document.",
      ),
    }),
  },
  responses: {
    304: { description: "Not modified: the copy named by `If-None-Match` is current. No body." },
    200: {
      description: "OpenAPI 3.0 specification (header `ETag` names this version)",
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
  stepStats: z.array(z.record(z.string(), z.unknown())).describe("Per-step breakdown"),
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

// Why a workflow was deprecated, who decided and when (DEPRECATION-REASON-1020). Owned by
// workflow-service; documented here so staff reading a deprecated workflow know the block exists.
const WorkflowDeprecationSchema = z
  .object({
    reason: z.string().describe("Plain-language reason the workflow was deprecated ('Not specified' for deprecations recorded before reasons existed)"),
    decidedBy: z.string().nullable().describe("Who decided: the staff member's email, else `user:<id>`; null for deprecations recorded before 2026-10-20"),
    decidedAt: z.string().nullable().describe("When it was deprecated (ISO 8601); null for deprecations recorded before 2026-10-20"),
  })
  .passthrough()
  .nullable()
  .describe("Why, by whom and when this workflow was deprecated; null when it is not deprecated. Owned by workflow-service.")
  .openapi("WorkflowDeprecation");

const deprecationReasonField = z
  .string()
  .optional()
  .describe(
    "Plain-language reason for deprecating, shown to staff on the workflow later (e.g. 'Spam complaints above 0.3% on Gmail'). " +
    "Forwarded verbatim to workflow-service, which owns whether it is required.",
  );
const deprecationDecidedByField = z
  .string()
  .optional()
  .describe(
    "Who decided the deprecation, when it is not the caller. Absent = workflow-service records the authenticated staff " +
    "member's email, which this gateway forwards as `x-email`.",
  );

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
    deprecation: WorkflowDeprecationSchema.optional(),
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

const researchDocs: Array<{ path: string; downstream: string; summary: string; schema: string; query?: boolean }> = [
  { path: "/v1/features/research", downstream: "/internal/research", summary: "Live Research file (staff only)", schema: "ResearchFileResponse", query: true },
  { path: "/v1/features/research/conclusions", downstream: "/internal/research/conclusions", summary: "Live Research conclusion studies (staff only)", schema: "ResearchConclusionsResponse" },
  { path: "/v1/features/research/studies", downstream: "/internal/research/studies", summary: "Live Research measured studies (staff only)", schema: "ResearchStudiesResponse" },
  { path: "/v1/features/research/catalog", downstream: "/internal/research/catalog", summary: "Live Research catalogue: workflow, template and model pages per pipe (staff only)", schema: "ResearchCatalogResponse", query: true },
  { path: "/v1/features/research/templates", downstream: "/internal/research/templates", summary: "Live Research template texts by template id (staff only)", schema: "ResearchTemplatesResponse" },
  { path: "/v1/features/research/performance", downstream: "/internal/research/performance", summary: "Live Research performance: every workflow x template x LLM combination per pipe, pipe totals and since-inception series (staff only)", schema: "ResearchPerformanceResponse", query: true },
];

for (const doc of researchDocs) {
  registry.registerPath({
    method: "get",
    path: doc.path,
    tags: ["Features"],
    summary: doc.summary,
    description:
      "features-service's live, fleet-wide Research studies for the staff Research page. The actual basis reveals margin, so staff-only: " +
      "platform API key + a STAFF_EMAILS x-email, refused with 403 before any downstream call. No org context. " +
      `Transparent proxy to features-service GET ${doc.downstream}; query forwarded verbatim; status and body owned by features-service ` +
      "(503 research_not_computed_yet before its first build).",
    security: platformAuth,
    ...(doc.query
      ? { request: { query: z.object({ basis: z.string().optional().openapi({ description: "user (billed) or actual (vendor cost). Documented today, not a whitelist." }) }).passthrough() } }
      : {}),
    responses: {
      200: { description: "Research — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi(doc.schema) } } },
      400: { description: "Invalid parameters", content: errorContent },
      401: { description: "Unauthorized", content: errorContent },
      403: { description: "Not staff", content: errorContent },
      503: { description: "Research not computed yet", content: errorContent },
    },
  });
}

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
  path: "/v1/public/indexes",
  tags: ["Features"],
  summary: "Public fleet indexes",
  description:
    "Our public fleet indexes, for example the SCEO Cost Per Click Index (what our best proven cold email workflow pays for one website visit, recorded every day): each index with its latest value, status and day, plus the rule that sets a status. " +
    "Proxied to features-service GET /public/indexes. The caller's query string is forwarded verbatim. Status and body are piped as is (producer-owned). No authentication required.",
  responses: {
    200: { description: "Fleet indexes — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicFleetIndexesResponse") } } },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/indexes/{slug}",
  tags: ["Features"],
  summary: "One public fleet index with its daily history",
  description:
    "One fleet index (slug from GET /v1/public/indexes) with its daily points (day, value, status). " +
    "Proxied to features-service GET /public/indexes/{slug}. Status and body are piped as is: an unknown slug is the producer's 404 `index_not_found`. No authentication required.",
  request: { params: z.object({ slug: z.string().openapi({ description: "Index slug, as listed by GET /v1/public/indexes" }) }) },
  responses: {
    200: { description: "One fleet index and its daily points — pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicFleetIndexResponse") } } },
    404: { description: "Unknown index slug (`index_not_found`)", content: errorContent },
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
  path: "/v1/features/audit/security-advisories",
  tags: ["Features"],
  summary: "Open security advisories per prod repo per day, with the red/green verdict (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org context. " +
    "Byte passthrough to features-service GET /internal/security-advisories: the last `days` UTC days of the owner's daily npm/pnpm audit per " +
    "prod repo (critical/high/moderate/low, packages with high/critical findings, audit error), fleet totals per day, and the served verdict the " +
    "Monitoring hub renders as-is (red on any critical/high or failed audit in the latest report, on no report for more than 36 hours, or when " +
    "nothing was ever reported). Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      days: z.string().optional().openapi({ description: "Window in UTC days, 1 to 365, default 30 (features-service validates it)" }),
    }).passthrough(),
  },
  responses: {
    200: { description: "Pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StaffSecurityAdvisoriesResponse") } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream service error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/features/audit/box-health",
  tags: ["Features"],
  summary: "Is the production box overloaded? Red/green verdict, daily + 48 h series, top containers (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide, no org context. " +
    "Byte passthrough to features-service GET /internal/box-health: the served verdict from the latest box sample (red on load average 5 min > " +
    "1.5 x cores, MemAvailable < 1024 MB, swap > 50 % or no swap, an OOM kill in the last 24 hours, or no sample for 20 minutes) with its " +
    "thresholds and reasons, a daily series per UTC day (mean/max load, min MemAvailable, max swap %, OOM kills; days without samples absent), " +
    "every sample of the last 48 hours, the latest sample, and the top 10 containers by CPU and by memory averaged over the last hour. " +
    "Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      days: z.string().optional().openapi({ description: "Window in UTC days, 1 to 90, default 30 (features-service validates it)" }),
    }).passthrough(),
  },
  responses: {
    200: { description: "Pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("StaffBoxHealthResponse") } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
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
    "nothing. This endpoint answers even when no organization is named. A key never carries admin or beta powers; a staff " +
    "member's key may call the few operations listed under the `Staff (key)` tag of `GET /v1/me/openapi.json`. " +
    "Pass `q` to find one organization or brand by name, domain or id (a staff key reaches every organization, so the full list is long). " +
    "Authenticate with `Authorization: Bearer <key>`. On 401 the body's `code` says why and `fix` says what to do.",
  security: authed,
  request: {
    query: z.object({
      q: z.string().optional().openapi({ description: "Find an organization or brand: text matched (case-insensitive, substring) against each organization's id and name and each brand's id, name and domain. An organization that matches keeps all its brands; otherwise only its matching brands are listed. Example: `leadingislearning`." }),
    }),
  },
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
    featureInputs: z.record(z.string(), z.unknown()).describe("Opaque feature inputs. Validated by key-presence against features-service, never inspected by api-service."),
    maxBudgetDailyUsd: z.union([z.string(), z.number()]).optional().describe("Max daily budget in USD"),
    maxBudgetWeeklyUsd: z.union([z.string(), z.number()]).optional().describe("Max weekly budget in USD"),
    maxBudgetMonthlyUsd: z.union([z.string(), z.number()]).optional().describe("Max monthly budget in USD"),
    maxBudgetTotalUsd: z.union([z.string(), z.number()]).optional().describe("Max total budget in USD"),
    maxLeads: z.number().int().optional().describe("Maximum number of leads to contact"),
    endDate: z.string().optional().describe("Campaign end date"),
    // Campaign v2 — per-campaign configuration (owned by campaign-service).
    // Faithful passthrough: types mirror campaign-service's create contract exactly.
    goal: z.string().min(1).nullable().optional().describe("Campaign's own optimization goal. Vocabulary owned by campaign-service — not enumerated here."),
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

// The CUSTOMER view of a generated email (security hotfix 2026-10-12). The gateway projects
// every content-generation-service generation row onto this allowlist for any non-staff
// caller (src/lib/customer-email-view.ts): the prompt, raw model output, raw variables,
// token counts, model, prompt type, workflow slugs and run costs never reach a customer.
// Documented field-by-field on purpose: this is a shape api-service constructs (rule #8's
// exception), and the document must not advertise a field a customer cannot receive.
const GeneratedEmailSequenceStepSchema = z
  .object({
    step: z.number().describe("1-based position in the cadence"),
    subject: z.string().nullable().optional().describe("Step subject, when the step carries its own"),
    bodyHtml: z.string().nullable().describe("Step body as HTML"),
    bodyText: z.string().nullable().describe("Step body as plain text"),
    daysSinceLastStep: z.number().nullable().describe("Delay in days after the previous step (0 for step 1)"),
  })
  .openapi("GeneratedEmailSequenceStep");

export const GeneratedEmailSchema = z
  .object({
    id: z.string().describe("Generation ID"),
    leadId: z.string().nullable().optional().describe("Lead the email was written for"),
    campaignId: z.string(),
    brandIds: z.array(z.string()).optional().describe("Brands the email was written for"),
    subject: z.string().nullable().describe("Email subject line"),
    bodyHtml: z.string().nullable().describe("First email body as HTML"),
    bodyText: z.string().nullable().describe("First email body as plain text"),
    bodySource: z.enum(["column", "sequence", "none"]).optional().describe("Where bodyText/bodyHtml were read from; `none` = no readable copy"),
    sequence: z.array(GeneratedEmailSequenceStepSchema).nullable().describe("Every step of the planned cadence"),
    leadFirstName: z.string().nullable(),
    leadLastName: z.string().nullable(),
    leadCompany: z.string().nullable(),
    leadTitle: z.string().nullable(),
    leadIndustry: z.string().nullable(),
    leadOrganizationDomain: z.string().nullable().optional().describe("Company domain from lead enrichment"),
    clientCompanyName: z.string().nullable(),
    createdAt: z.string().describe("ISO timestamp"),
  })
  .openapi("GeneratedEmail");

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
    featureInputs: z.record(z.string(), z.unknown()).nullable().describe("Free-form JSONB inputs for the feature"),
    maxBudgetDailyUsd: z.string().nullable().describe("Max daily budget in USD"),
    maxBudgetWeeklyUsd: z.string().nullable().describe("Max weekly budget in USD"),
    maxBudgetMonthlyUsd: z.string().nullable().describe("Max monthly budget in USD"),
    maxBudgetTotalUsd: z.string().nullable().describe("Max total budget in USD"),
    maxLeads: z.number().nullable().describe("Maximum number of leads"),
    // Campaign v2 — per-campaign configuration (owned by campaign-service, forwarded byte-identical).
    goal: z.enum(["signup", "meetingBooked", "purchase"]).nullable().describe("Campaign's own optimization goal"),
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
    "neither infers nor defaults either: campaign-service's own 400 comes back verbatim.\n\n" +
    "A campaign does not pick who its pipes find or contact: each pipe's lead strategy decides that. " +
    "Browse and extend the strategies with the lead-strategy catalogue (`/v1/tactics`, `/v1/strategies`, `/v1/plays`).",
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


// GET /v1/offers/{offerId}/trigger-events[/summary] -> campaign-service GET /internal/offers/{offerId}/trigger-events[/summary].
// Passthrough: campaign-service owns the query validation and both bodies.
const OfferTriggerEventsSummaryResponseSchema = z
  .object({})
  .passthrough()
  .openapi("OfferTriggerEventsSummaryResponse");
// One trigger event, as campaign-service serves it (its `TriggerEvent` schema, served openapi 2026-10-14).
// These response schemas DOCUMENT the producer's fields and validate nothing: every trigger-event route
// pipes the upstream bytes (`pipeExternalService`), so a field campaign-service adds still reaches the
// caller today; the document learns it here. Owner gap 2026-10-14: the 201 of POST /v1/trigger-events was
// published as `{}`, so an agent could not read `event.outcome` / `skipReason` / `ranCampaignIds`.
const TriggerEventSchema = z
  .object({
    id: z.string().openapi({ description: "The event id." }),
    triggerId: z.string().nullable().openapi({ description: "The trigger type (GET /v1/public/channels `triggers[].id`)." }),
    step: z.string().nullable(),
    orgId: z.string(),
    brandId: z.string(),
    offerId: z.string(),
    leadId: z.string().nullable().openapi({
      description:
        "The lead the reporting service named on the occurrence. Null on an event you push with `person`: that person is filed as a lead of each campaign that runs, read them in `ranLeads`.",
    }),
    requestedByCampaignId: z.string().nullable(),
    recordedVia: z.string().openapi({ description: "Who recorded it, e.g. `trigger_events` for a push through this route." }),
    occurredAt: z.string().openapi({ description: "ISO date-time." }),
    dueAt: z.string().openapi({ description: "ISO date-time it fires (or fired)." }),
    status: z.string().openapi({ description: "`pending` (due later, or held a few minutes while the person is filed) | `firing` | `done`." }),
    outcome: z.string().nullable().openapi({
      description: "`ran` (at least one campaign ran) | `skipped` (see `skipReason`) | `failed` (every run failed); null until `status` is `done`.",
    }),
    skipReason: z.string().nullable().openapi({
      description:
        "Why nothing ran, one reason: a campaign's own (e.g. `unfunded`, `run_in_flight`, `person_suppressed`), else `campaign_off`, `no_campaign`, `no_leg`; `run_failed` when `outcome` is `failed`. Null when it ran.",
      example: "no_campaign",
    }),
    ranCampaignIds: z.array(z.string()).openapi({ description: "The campaigns that ran for it (empty unless `outcome` is `ran`)." }),
    ranLeads: z
      .array(z.object({ campaignId: z.string(), leadId: z.string() }))
      .openapi({
        description:
          "Per campaign that ran: the lead the event's person was filed as on that campaign. Empty when no run carried a lead.",
      }),
    performedByCaller: z.boolean(),
    processedAt: z.string().nullable().openapi({ description: "ISO date-time the outcome was written; null until done." }),
    detail: z.unknown().nullable().openapi({
      description: "Every per-campaign answer: `{legKeys, triggered[], skipped[], offCampaignIds}`, plus the `person` and `item` you sent.",
    }),
  })
  .passthrough()
  .openapi("TriggerEvent");
const ReportTriggerEventResponseSchema = z
  .object({
    event: TriggerEventSchema,
    replayed: z.boolean().openapi({ description: "`true` when `idempotencyKey` named an event already recorded (answered 200)." }),
  })
  .passthrough()
  .openapi("ReportTriggerEventResponse");
const OfferTriggerEventsListResponseSchema = z
  .object({ events: z.array(TriggerEventSchema) })
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

// POST /v1/trigger-events -> campaign-service POST /internal/trigger-events/public (the public door). The body is forwarded
// byte-identical: this schema DOCUMENTS the producer's fields and validates nothing (rule #8 corollary).
const ReportTriggerEventRequestSchema = z
  .object({
    triggerId: z.string().openapi({
      description:
        "A declared trigger id (GET /v1/public/channels `triggers[].id`), e.g. `email_pushed_via_api` to have an email you wrote sent. Unknown = 400 `unknown_trigger`.",
      example: "email_pushed_via_api",
    }),
    brandId: z.string().uuid().openapi({ description: "Your brand (GET /v1/brands). Not one of your organization's brands = 404 `brand_not_in_org`." }),
    offerId: z.string().uuid().openapi({ description: "The brand's offer the occurrence is about." }),
    person: z
      .object({
        email: z.string().email().optional().openapi({
          description:
            "The person's email. Optional when `phone` is given in E.164 form: one of the two is required (neither = 400 naming `person.email`, nothing recorded).",
          example: "sam@employer.co.uk",
        }),
        name: z.string().optional(),
        phone: z.string().optional().openapi({
          description:
            "The person's phone number in E.164 form (`+` and country code, e.g. `+33612345678`; spaces and dashes are dropped). With no `email`, the phone alone identifies the person (e.g. someone who only gave their WhatsApp number): send `person: {phone, name?}`. It is also used to infer the person's timezone when you state none.",
          example: "+33612345678",
        }),
        timezone: z.string().optional().openapi({
          description:
            "The person's IANA timezone name (e.g. `Europe/London`, `America/New_York`, `UTC`), so every message lands in their business hours. An offset such as `GMT+1` or `+01:00` is refused (400 naming `person.timezone`, nothing recorded). Absent = inferred from what we hold, notably the phone (a +44 number = Europe/London) or the email. A stated timezone always wins over an inferred one.",
          example: "Europe/London",
        }),
      })
      .passthrough()
      .optional()
      .openapi({ description: "Who the occurrence is about, by identity: `email`, or an E.164 `phone` when you have no email (one of the two is required). Each campaign the trigger reaches files them as a lead of the brand and runs for them." }),
    item: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({
        description:
          "What the occurrence carries, any JSON (at most 20,000 characters), handed verbatim to the workflow that runs. For `email_pushed_via_api`: the email you wrote, `{subject, bodyHtml?, bodyText?}` (at least one body), sent as written.",
        example: { subject: "Hiring in Leeds?", bodyText: "Hi Sam,\nI saw you are hiring..." },
      }),
    idempotencyKey: z.string().optional().openapi({ description: "Unique per organization: a retry returns the first event (`replayed: true`), recorded once." }),
    occurredAt: z.string().optional().openapi({ description: "When it happened (ISO date-time). Absent = now." }),
    dueAt: z.string().optional().openapi({ description: "When it must fire (ISO date-time). Later than now = recorded `pending` and fired then." }),
  })
  .passthrough()
  .openapi("ReportTriggerEventRequest");

registry.registerPath({
  method: "post",
  path: "/v1/trigger-events",
  tags: ["Campaigns"],
  summary: "Push an email to send, or fire any trigger: report one occurrence for a person",
  description:
    "Report ONE occurrence of a trigger on your brand and offer, with your own API key. Every live campaign of yours whose " +
    "reactive step answers that trigger runs for the person named (same funding and rules as any campaign run). " +
    "Example: push an email you wrote (`triggerId: email_pushed_via_api`, `person.email`, `item: {subject, bodyText}`) and " +
    "your Email Sending campaign sends it as written from our inboxes. Proxy to campaign-service POST /internal/trigger-events/public: " +
    "body forwarded as is, status and refusals relayed verbatim. The answer's `event.outcome` says what ran (`ran`) or why not " +
    "(`skipped` + reason, e.g. `no_campaign`, `unfunded`); a person still being filed leaves the event `pending` a few minutes. " +
    "Read events back with GET /v1/offers/{offerId}/trigger-events. `performed` is not accepted here (400 `performed_not_reportable`). " +
    "A trigger the platform computes itself (served `callable: false` by GET /v1/public/channels, e.g. a delay or a poll) cannot be reported: 400 `trigger_not_callable`, nothing recorded.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: ReportTriggerEventRequestSchema } } },
  },
  responses: {
    201: {
      description: "Recorded (and, when due now, fired: `event.outcome`). Body relayed verbatim from campaign-service.",
      content: { "application/json": { schema: ReportTriggerEventResponseSchema } },
    },
    200: {
      description: "`idempotencyKey` named an event already recorded: that event, `replayed: true`.",
      content: { "application/json": { schema: ReportTriggerEventResponseSchema } },
    },
    400: {
      description:
        "Refused, nothing recorded: `unknown_trigger`, `trigger_not_callable` (a trigger the platform computes itself, not reportable by you), a malformed body (campaign-service, verbatim) or `performed_not_reportable`.",
      content: errorContent,
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "The brand is not one of this organization's brands (`code: brand_not_in_org`).", content: errorContent },
    502: { description: "The trigger list could not be read (`catalogue_unavailable`), nothing recorded.", content: errorContent },
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

// /v1/sales-funnel-campaigns[/{id}] -> campaign-service /sales-funnel-campaigns[/{id}], same paths.
// Passthrough: campaign-service owns the bodies, the query vocabulary and every refusal `reason`.
const SalesFunnelCampaignRequestSchema = z.object({}).passthrough().openapi("SalesFunnelCampaignRequest");
const SalesFunnelCampaignResponseSchema = z.object({}).passthrough().openapi("SalesFunnelCampaignResponse");
const SalesFunnelCampaignListResponseSchema = z.object({}).passthrough().openapi("SalesFunnelCampaignListResponse");
const salesFunnelCampaignDescription =
  "A SALES FUNNEL CAMPAIGN (owner 2026-10-10) is brand x offer x sales funnel: it owns one unit (an ordinary " +
  "campaign) per pipe of the funnel and is run or paused as a whole. Its money is the funnel's caps at billing " +
  "(GET /v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps); no max budget = held unfunded. " +
  "The org is the authenticated one. Status and body (with `reason` on a refusal) relayed verbatim. " +
  "HOW each pipe behaves is fixed by the funnel's plays (`<leg>@<channel>~<strategy id>` in the funnel id; see the Plays tag: " +
  "tactic, strategy, play on a pipe, a funnel carrying it, a campaign on that funnel). To change a behaviour (for example " +
  "replies that carry an offer document as an attachment), launch a campaign on a funnel carrying the right play, created " +
  "with `status: stopped` until the client agrees.";

const BrandSalesFunnelCampaignRowsResponseSchema = z.object({}).passthrough().openapi("BrandSalesFunnelCampaignRowsResponse");

registry.registerPath({
  method: "get",
  path: "/v1/features/brands/{brandId}/sales-funnel-campaigns",
  tags: ["Campaigns"],
  summary: "A brand's sales funnel campaigns as the Campaigns table reads them",
  description:
    "Proxy to features-service GET /brands/{brandId}/sales-funnel-campaigns. One row per sales funnel campaign: name, face, " +
    "type and its label (Daily or the trigger), structured path, money invested since inception and ROI, all served by " +
    "features-service. The org is the authenticated one. Query forwarded verbatim (documented today: offerId, pricing; " +
    "not a whitelist). Status and body relayed verbatim.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string() }),
    query: z.object({ offerId: z.string().optional(), pricing: z.string().optional() }).passthrough(),
  },
  responses: {
    200: { description: "{ salesFunnelCampaigns: [...] }", content: { "application/json": { schema: BrandSalesFunnelCampaignRowsResponseSchema } } },
    400: { description: "Refused by features-service, forwarded verbatim", content: errorContent },
    404: { description: "brand_not_found, forwarded verbatim", content: errorContent },
    502: { description: "campaign-service unreadable, forwarded verbatim", content: errorContent },
  },
});

const SalesFunnelCampaignActivityResponseSchema = z.object({}).passthrough().openapi("SalesFunnelCampaignActivityResponse");

registry.registerPath({
  method: "get",
  path: "/v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/activity",
  tags: ["Campaigns"],
  summary: "One sales funnel campaign's funnel in people and each pipe's work",
  description:
    "Proxy to features-service GET /brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/activity. The whole " +
    "funnel in people (step counts and step-to-step rates) and each pipe's work (daily series, AI Instant Call figures), " +
    "all served by features-service. The org is the authenticated one. No query parameters documented today; any query " +
    "is forwarded verbatim. Status and body relayed verbatim.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string(), salesFunnelCampaignId: z.string() }),
    query: z.object({}).passthrough(),
  },
  responses: {
    200: { description: "The campaign's funnel and pipes activity", content: { "application/json": { schema: SalesFunnelCampaignActivityResponseSchema } } },
    400: { description: "Refused by features-service, forwarded verbatim", content: errorContent },
    404: { description: "sales_funnel_campaign_not_found or brand_not_found, forwarded verbatim", content: errorContent },
    502: { description: "A producer unreadable, forwarded verbatim", content: errorContent },
  },
});

const CampaignNextStepsResponseSchema = z.object({}).passthrough().openapi("CampaignNextStepsResponse");

registry.registerPath({
  method: "get",
  path: "/v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/next-steps",
  tags: ["Campaigns"],
  summary: "What comes next in one campaign: leads queued, when they go out, and the typical time to a positive reply",
  description:
    "Proxy to features-service GET /brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/next-steps. For one campaign " +
    "(a sales funnel campaign id, or one of its pipes' campaign ids): `emailSendQueue` = leads whose first email waits in our " +
    "email sender, follow-ups queued, and `firstEmailsFrom` = when the sending window next opens in each lead's own business " +
    "hours (`sendWindow`); `timeToFirstPositiveReply` = the measured median days from a lead's first email to its first " +
    "positive reply, on this campaign once it holds enough replies (`basis: campaign`), else the same pipes across every " +
    "client (`basis: pipe_fleet`), else `learning: true` (say it is too early to tell). Since inception. Each part fails soft " +
    "to a named null. The org is the authenticated one. Any query is forwarded verbatim. Status and body relayed verbatim.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string(), salesFunnelCampaignId: z.string() }),
    query: z.object({}).passthrough(),
  },
  responses: {
    200: { description: "The campaign's next steps", content: { "application/json": { schema: CampaignNextStepsResponseSchema } } },
    404: { description: "sales_funnel_campaign_not_found or brand_not_found, forwarded verbatim", content: errorContent },
    502: { description: "campaign-service unreadable, forwarded verbatim", content: errorContent },
  },
});

const CampaignSpendChartsResponseSchema = z.object({}).passthrough().openapi("CampaignSpendChartsResponse");

registry.registerPath({
  method: "get",
  path: "/v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/spend-charts",
  tags: ["Campaigns"],
  summary: "Daily spend and convergence charts of one campaign and each of its pipes",
  description:
    "Proxy to features-service GET /brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/spend-charts. Why a day " +
    "costs what it costs and whether it is converging: one point per UTC day since the campaign's first activity, for the " +
    "campaign and each of its pipes: the measured cost per outcome (served while Learning, flagged), the conversion by entry " +
    "cohort (recent cohorts flagged not mature), the Learning flag, what the day's spend bought per action (new prospects, " +
    "first contacts, follow-ups...) and the expected values the lines converge to. `pricing=net` = what the org pays " +
    "(default gross). The org is the authenticated one. Any query is forwarded verbatim. Status and body relayed verbatim.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string(), salesFunnelCampaignId: z.string() }),
    query: z.object({
      pricing: z.string().optional().openapi({ example: "net" }).describe("gross | net — validated by features-service"),
    }).passthrough(),
  },
  responses: {
    200: { description: "The campaign's and its pipes' charts", content: { "application/json": { schema: CampaignSpendChartsResponseSchema } } },
    400: { description: "pricing_unrecognised, forwarded verbatim", content: errorContent },
    404: { description: "brand_not_found or sales_funnel_campaign_not_found, forwarded verbatim", content: errorContent },
    502: { description: "A spend or people read failed, forwarded verbatim", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/sales-funnel-campaigns",
  tags: ["Campaigns"],
  summary: "List the org's sales funnel campaigns, each with its units",
  description:
    "Proxy to campaign-service GET /sales-funnel-campaigns. " +
    salesFunnelCampaignDescription +
    " Query forwarded verbatim (documented today: brandId, offerId, salesFunnelId, status; not a whitelist).",
  security: authed,
  request: {
    query: z
      .object({
        brandId: z.string().optional(),
        offerId: z.string().optional(),
        salesFunnelId: z.string().optional(),
        status: z.string().optional().openapi({ description: "ongoing | stopped (campaign-service's vocabulary)" }),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "{ salesFunnelCampaigns: [...] }", content: { "application/json": { schema: SalesFunnelCampaignListResponseSchema } } },
    400: { description: "Refused by campaign-service, forwarded verbatim", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/sales-funnel-campaigns",
  tags: ["Campaigns"],
  summary: "Launch a sales funnel as one campaign (brand x offer x sales funnel)",
  description:
    "Proxy to campaign-service POST /sales-funnel-campaigns. " +
    salesFunnelCampaignDescription +
    " Body { brandId, offerId, salesFunnelId, status: ongoing | stopped } forwarded untouched. 201 when created, 200 for an existing identity.",
  security: authed,
  request: { body: { content: { "application/json": { schema: SalesFunnelCampaignRequestSchema } } } },
  responses: {
    200: { description: "Existing campaign", content: { "application/json": { schema: SalesFunnelCampaignResponseSchema } } },
    201: { description: "Created", content: { "application/json": { schema: SalesFunnelCampaignResponseSchema } } },
    400: { description: "Refused (reason unknown_sales_funnel | no_pipe | pipe_not_runnable), forwarded verbatim", content: errorContent },
    409: { description: "Refused (reason no_workflow | payment_declined | no_payment_method), forwarded verbatim", content: errorContent },
    502: { description: "Dependency unavailable, forwarded verbatim", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/sales-funnel-campaigns/{id}",
  tags: ["Campaigns"],
  summary: "One sales funnel campaign with its units",
  description: "Proxy to campaign-service GET /sales-funnel-campaigns/{id}. " + salesFunnelCampaignDescription,
  security: authed,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "{ salesFunnelCampaign }", content: { "application/json": { schema: SalesFunnelCampaignResponseSchema } } },
    404: { description: "Not found in this org, forwarded verbatim", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/sales-funnel-campaigns/{id}",
  tags: ["Campaigns"],
  summary: "Run or pause the whole sales funnel campaign",
  description:
    "Proxy to campaign-service PATCH /sales-funnel-campaigns/{id}. " +
    salesFunnelCampaignDescription +
    " Body { status: activate | stop } forwarded untouched; every unit moves with it.",
  security: authed,
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: SalesFunnelCampaignRequestSchema } } },
  },
  responses: {
    200: { description: "{ salesFunnelCampaign } after the move", content: { "application/json": { schema: SalesFunnelCampaignResponseSchema } } },
    400: { description: "Refused by campaign-service, forwarded verbatim", content: errorContent },
    404: { description: "Not found in this org, forwarded verbatim", content: errorContent },
    409: { description: "Payment hold (reason payment_declined | no_payment_method), forwarded verbatim", content: errorContent },
    502: { description: "billing_unavailable, forwarded verbatim", content: errorContent },
  },
});

const SalesFunnelCampaignDeleteResponseSchema = z.object({}).passthrough().openapi("SalesFunnelCampaignDeleteResponse");

registry.registerPath({
  method: "delete",
  path: "/v1/sales-funnel-campaigns/{id}",
  tags: ["Campaigns"],
  summary: "Delete a sales funnel campaign created by mistake (stopped, never ran)",
  description:
    "Proxy to campaign-service DELETE /sales-funnel-campaigns/{id}. " +
    salesFunnelCampaignDescription +
    " Removes a campaign created by mistake together with its units: only a STOPPED campaign that never ran and never " +
    "spent can go. A campaign that is running (stop it first) or has any history is refused. No body.",
  security: authed,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "{ deleted: true, salesFunnelCampaignId, unitIds }", content: { "application/json": { schema: SalesFunnelCampaignDeleteResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Not found in this org, forwarded verbatim", content: errorContent },
    409: { description: "Refused (reason sales_funnel_campaign_ongoing | sales_funnel_campaign_has_history), forwarded verbatim", content: errorContent },
    502: { description: "Dependency unavailable (reason runs_unavailable | billing_unavailable), forwarded verbatim", content: errorContent },
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
  path: "/v1/campaigns/{id}/sourcing-stats",
  tags: ["Campaigns"],
  summary: "What one sourcing pipe of a sales funnel found and kept, since inception",
  description:
    "Pass-through to lead-service GET /orgs/campaigns/{campaignId}/sourcing-stats. For one source campaign of a " +
    "sales funnel (Apollo cold filters, Apollo buying signals, LinkedIn engagement): the people and companies it " +
    "found, how many of them were kept (served to an outreach campaign of the offer), and the daily series. " +
    "lead-service derives the figures; api-service forwards status and body untransformed. The read is org-scoped " +
    "downstream on the authenticated org. Refer to lead-service openapi.json (`SourcingStatsResponse`) for the " +
    "exact response shape.",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "The source pipe's found / kept figures, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("CampaignSourcingStatsResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Not a campaign of this caller's org", content: errorContent },
    409: { description: "The campaign is not a lead source (not a sourcing pipe)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "A service lead-service reads to answer is down", content: errorContent },
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
    "Get all generated emails for a campaign across all runs: the lead each was written for and the subject and body of every step.",
  security: authed,
  request: { params: CampaignIdParam },
  responses: {
    200: {
      description: "Campaign emails",
      content: {
        "application/json": {
          schema: z
            .object({
              emails: z.array(GeneratedEmailSchema),
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
  summary: "List or search a brand's leads (find a lead by email, name or company)",
  description:
    "Pass-through to lead-service GET /orgs/leads. Filter by brandId and/or campaignId (at least one required). " +
    "To find one person, pass `q`: their email (or part of it), name, job title or company name; every word must match. " +
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
      q: z.string().optional().openapi({ description: "Search: a person's email (or part of it), name, job title or company name. Case-insensitive substring; with several words, each must match one of those fields. Example: `jane@acme.com`." }),
      status: z.string().optional().openapi({ description: "Comma-separated lead statuses to include (lead-service decides the default set)" }),
    }).passthrough(),
  },
  responses: {
    200: {
      description: "Leads as returned by lead-service GET /orgs/leads (LeadDetail[] under `leads`).",
      content: {
        "application/json": {
          schema: z
            .object({
              leads: z.array(z.record(z.string(), z.unknown())).describe(
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
  method: "get",
  path: "/v1/campaigns/{campaignId}/leads/by-lead/{leadId}",
  tags: ["Leads"],
  summary: "Read one person's lead on one campaign",
  description:
    "Pass-through to lead-service GET /orgs/campaigns/{campaignId}/leads/by-lead/{leadId}. Use it when you hold a " +
    "PERSON's lead id and a campaign and want that person's lead record there: for example after POST /v1/trigger-events, " +
    "take `campaignId` and `ranLeads[].leadId` from its answer and read each pushed person's lead directly, instead of " +
    "listing the campaign's leads and searching for them (a list misses people past its page). " +
    "Answers the same `{ leadDetail }` body as GET /v1/leads/{id}; `leadDetail.id` is the row id the per-row reads take " +
    "(GET /v1/leads/{id}, its history and step statements). The campaign in the path is the delivery scope (status, " +
    "replies). A person holds at most one lead row per campaign. " +
    "404 with `code: lead_not_on_campaign` means this person is not a lead of this campaign in your org (another org's row " +
    "answers the same 404): if you just pushed them, the campaign has not picked them up yet. " +
    "400 when `leadId` is not a uuid, or when `campaignId` is also sent as a query parameter (it belongs in the path only). " +
    "The query string is forwarded verbatim; the parameters listed here are the ones documented today, not a whitelist. " +
    "Refer to lead-service openapi.json for the exact response shape: api-service forwards it untransformed.",
  security: authed,
  request: {
    params: z.object({
      campaignId: z.string().openapi({
        description: "The campaign id (e.g. `campaignId` from the POST /v1/trigger-events answer).",
      }),
      leadId: z.string().openapi({
        description:
          "The PERSON's lead id (e.g. `ranLeads[].leadId` from POST /v1/trigger-events), not a lead row id. A non-uuid value is a 400.",
      }),
    }),
    query: z.object({
      brandId: z.string().uuid().optional().openapi({
        description: "Brand scope, same as on GET /v1/leads/{id}.",
      }),
      include: z.string().optional().openapi({
        description: "`campaigns` nests this person's campaigns of the brand under the record, same as on the list.",
      }),
    }).passthrough(),
  },
  responses: {
    200: {
      description: "The person's lead record on this campaign as returned by lead-service (`{ leadDetail }`).",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("CampaignLeadByPersonResponse"),
        },
      },
    },
    400: { description: "leadId is not a uuid, or campaignId was sent as a query parameter", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: {
      description: "`code: lead_not_on_campaign`: this person is not a lead of this campaign in the caller's org",
      content: errorContent,
    },
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
  method: "put",
  path: "/v1/leads/{id}/disqualification",
  tags: ["Leads"],
  summary: "Mark one lead Disqualified, with an optional note",
  description:
    "Pass-through to lead-service PUT /orgs/leads/{id}/disqualification. Puts the \"Disqualified\" tag on a lead " +
    "(its own tag, beside the step tags), with an optional free note saying why. Every body field is optional: " +
    "`brandId` and `offerId` narrow the scope, `note` is stored verbatim. The body is forwarded VERBATIM and " +
    "lead-service owns its refusals, which reach the caller with their own status and body. The caller's org " +
    "AND user are forwarded: lead-service records who marked the lead. " +
    "List a brand's disqualified leads with GET /v1/leads/disqualifications?brandId=<id>[&offerId=<id>]. " +
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
          schema: z.object({}).passthrough().openapi("LeadDisqualificationRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The lead as marked, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadDisqualificationResponse"),
        },
      },
    },
    400: { description: "Invalid request (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/leads/{id}/disqualification",
  tags: ["Leads"],
  summary: "Remove the Disqualified mark from one lead",
  description:
    "Pass-through to lead-service DELETE /orgs/leads/{id}/disqualification, the undo of the PUT on the same path. " +
    "The scope rides the query string (`brandId`, `offerId`), forwarded verbatim. The caller's org AND user are " +
    "forwarded. Refer to lead-service openapi.json for the exact response shape.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "The `id` of a lead as returned by GET /v1/leads.",
      }),
    }),
    query: z
      .object({
        brandId: z.string().optional().openapi({ description: "Brand scope of the mark." }),
        offerId: z.string().optional().openapi({ description: "Offer scope of the mark." }),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "The lead after the mark was removed, as returned by lead-service.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadDisqualificationWithdrawalResponse"),
        },
      },
    },
    400: { description: "Invalid request (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/leads/{id}/not-a-person",
  tags: ["Leads"],
  summary: "Mark a lead as NOT a real person (a test, a staff mailbox)",
  description:
    "Pass-through to lead-service PUT /orgs/leads/{id}/not-a-person. States that this lead is not a real person " +
    "(our own test, a staff mailbox, a fake signup): it leaves every figure of the org (lead lists, counts, positive " +
    "replies, signups, ROI) and its conversions are set aside. Nothing is deleted: DELETE on the same path lifts it. " +
    "Body `{note?}` forwarded VERBATIM. A lead whose every email is a staff address is marked automatically. " +
    "List the marked leads with GET /v1/leads/not-a-person[?leadId=<id>]. Refer to lead-service openapi.json for shapes.",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({ description: "The `id` of a lead as returned by GET /v1/leads, or the lead's own id." }),
    }),
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("LeadNotAPersonRequest") } } },
  },
  responses: {
    200: { description: "The lead's marks, as returned by lead-service.", content: { "application/json": { schema: z.object({}).passthrough().openapi("LeadNotAPersonResponse") } } },
    400: { description: "Invalid request (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/leads/{id}/not-a-person",
  tags: ["Leads"],
  summary: "Lift the not-a-real-person mark from a lead",
  description:
    "Pass-through to lead-service DELETE /orgs/leads/{id}/not-a-person, the undo of the PUT: the lead counts again and the " +
    "conversions the mark set aside stand back up. An automatic staff-address mark stays (answered in `stillMarkedBy`).",
  security: authed,
  request: {
    params: z.object({
      id: z.string().openapi({ description: "The `id` of a lead as returned by GET /v1/leads, or the lead's own id." }),
    }),
  },
  responses: {
    200: { description: "As returned by lead-service.", content: { "application/json": { schema: z.object({}).passthrough().openapi("LeadNotAPersonLiftResponse") } } },
    400: { description: "Invalid request (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/conversions",
  tags: ["Leads"],
  summary: "List a brand's conversion events (signups, sales, meetings) and whether each counts",
  description:
    "Pass-through to lead-service GET /orgs/brands/{brandId}/conversions. Newest first; each event says whether it COUNTS " +
    "(`counted`) and, when set aside, why. Use it to find the id of a wrongly attributed conversion before withdrawing it. " +
    "Query (`event`, `leadId`, `email`, `limit` 1..200) forwarded verbatim.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string() }),
    query: z
      .object({
        event: z.string().optional(),
        leadId: z.string().optional(),
        email: z.string().optional(),
        limit: z.string().optional(),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "As returned by lead-service.", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandConversionsListResponse") } } },
    400: { description: "Invalid filter (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{brandId}/conversions/{conversionId}/withdraw",
  tags: ["Leads"],
  summary: "Withdraw a wrongly attributed conversion",
  description:
    "Pass-through to lead-service POST /orgs/brands/{brandId}/conversions/{conversionId}/withdraw. Sets aside one conversion " +
    "(a signup or sale your website tag reported, attributed to the wrong person or a test of ours): it stops counting " +
    "everywhere. Body `{note}` (required, your words) forwarded VERBATIM; the caller's user is recorded. A CRM conversion " +
    "answers 409 `crm_evidence`, a person's own step statement 409 `use_step_statements`. Undo: DELETE .../withdrawal.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string(), conversionId: z.string() }),
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("WithdrawConversionRequest") } } },
  },
  responses: {
    200: { description: "As returned by lead-service.", content: { "application/json": { schema: z.object({}).passthrough().openapi("WithdrawConversionResponse") } } },
    400: { description: "Invalid request (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such conversion for this brand of the org", content: errorContent },
    409: { description: "Corrected elsewhere (`code` says where)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{brandId}/conversions/{conversionId}/withdrawal",
  tags: ["Leads"],
  summary: "Undo a conversion withdrawal",
  description:
    "Pass-through to lead-service DELETE /orgs/brands/{brandId}/conversions/{conversionId}/withdrawal. Stands back up a " +
    "conversion a person withdrew; anything set aside for another reason answers 409 `not_withdrawn_by_a_person`.",
  security: authed,
  request: { params: z.object({ brandId: z.string(), conversionId: z.string() }) },
  responses: {
    200: { description: "As returned by lead-service.", content: { "application/json": { schema: z.object({}).passthrough().openapi("RestoreConversionResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such conversion for this brand of the org", content: errorContent },
    409: { description: "not_withdrawn_by_a_person", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/leads/{id}/answered-outside",
  tags: ["Leads"],
  summary: "State that you answered this person outside the platform",
  description:
    "Pass-through to lead-service POST /orgs/leads/{id}/answered-outside. Records that the caller answered this " +
    "person from outside the platform (their own inbox, which no system of ours sees), so the person stops waiting " +
    "on the brand and leaves the list read at GET /v1/leads/awaiting-reply?brandId=. No request body. The caller's " +
    "org AND user identity are forwarded, because lead-service records who answered. Status and body are " +
    "lead-service's, forwarded unchanged. Refer to lead-service openapi.json for the exact response shape.",
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
          description: "Optional brand scope. Documented today, not a whitelist: the query string is forwarded verbatim.",
        }),
      })
      .passthrough(),
  },
  responses: {
    201: {
      description: "The statement as recorded by lead-service, and whether the person is still awaiting a reply.",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("LeadAnsweredOutsideResponse"),
        },
      },
    },
    400: { description: "Invalid lead id or no user (lead-service states the reason)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No such lead in this caller's org or brand", content: errorContent },
    500: { description: "Internal error", content: errorContent },
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
    name: z.string().min(1).optional().describe("Brand name. With `url`: the display name. Without `url`: the brand's identity (a no-website brand)"),
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
  summary: "Create (or find) a brand",
  description:
    "Create the brand from its website `url` (add `name` for its display name), or from a `name` alone for a no-website brand. " +
    "The same website twice answers the same brand. The answer's `brandId` is the id every brand route takes (`/v1/brands/{id}/...`).",
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
// Brand – Offer steps (proxy to brand-service /orgs/brands/:id/offers/:offerId/steps[/:stepKey]).
// The funnel steps the client stated its business has for one offer (owner 2026-10-12). Passthrough:
// brand-service owns { offerId, stated, steps, statedAt[, changed] } and every refusal.
// ===================================================================
const OfferStepsResponseSchema = z.object({}).passthrough().openapi("OfferStepsResponse");
const OfferStepParams = BrandOfferParams.extend({
  stepKey: z.string().describe("A features-service step key (GET /v1/public/catalogue/steps lists them), e.g. purchase"),
});
const OFFER_STEPS_MODEL =
  "The funnel steps the client stated its business has for this offer (features-service step keys such as " +
  "conversation, booking_call, meeting_booked, purchase). stated false (steps null) = the offer never stated its " +
  "steps, a different answer from stated true with an empty list. Never legs, channels or sales paths.";

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/steps",
  tags: ["Brand"],
  summary: "Read the steps an offer's business has",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/offers/{offerId}/steps. " + OFFER_STEPS_MODEL +
    " Answers { offerId, stated, steps, statedAt }. Read them before proposing a sales funnel: a funnel " +
    "through a step the offer does not have is a question to ask the client, not a default.",
  security: authed,
  request: { params: BrandOfferParams },
  responses: {
    200: { description: "The offer's stated steps", content: { "application/json": { schema: OfferStepsResponseSchema } } },
    400: { description: "Invalid brand or offer ID format (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "No such brand, or no such offer on it (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

const OFFER_STEP_WRITE_RESPONSES = {
  200: { description: "The steps after the write, with changed (false = no-op)", content: { "application/json": { schema: OfferStepsResponseSchema } } },
  400: { description: "Invalid ID, or reason unknown_step (a key outside the step catalogue; knownSteps lists the valid ones), forwarded verbatim", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
  404: { description: "No such brand, or no such offer on it (forwarded verbatim)", content: errorContent },
  500: { description: "Upstream error", content: errorContent },
  502: { description: "reason step_catalogue_unavailable: the step catalogue could not be read, nothing written (forwarded verbatim)", content: errorContent },
};

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/offers/{offerId}/steps/{stepKey}",
  tags: ["Brand"],
  summary: "State one step of an offer (idempotent)",
  description:
    "Proxy to brand-service PUT /orgs/brands/{brandId}/offers/{offerId}/steps/{stepKey}. " + OFFER_STEPS_MODEL +
    " Adds ONE step, only after the client confirmed their business has it. No body. Already stated = 200 " +
    "with changed false. Answers { offerId, stated, steps, statedAt, changed }.",
  security: authed,
  request: { params: OfferStepParams },
  responses: OFFER_STEP_WRITE_RESPONSES,
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{id}/offers/{offerId}/steps/{stepKey}",
  tags: ["Brand"],
  summary: "Remove one step of an offer (idempotent)",
  description:
    "Proxy to brand-service DELETE /orgs/brands/{brandId}/offers/{offerId}/steps/{stepKey}. " + OFFER_STEPS_MODEL +
    " Removes ONE step. Not stated = 200 with changed false. Answers { offerId, stated, steps, statedAt, changed }.",
  security: authed,
  request: { params: OfferStepParams },
  responses: OFFER_STEP_WRITE_RESPONSES,
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers",
  tags: ["Brand"],
  summary: "List a brand's offers",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/offers. An OFFER is one thing the brand sells; its id is what " +
    "offer-scoped routes take (economics, steps, documents, sales funnels, campaigns). Archived offers are hidden unless " +
    "`includeArchived=true`. Query string forwarded verbatim; status and body owned by brand-service.",
  security: authed,
  request: {
    params: z.object({ id: z.string().describe("Brand ID") }),
    query: z.object({ includeArchived: z.string().optional().describe("`true` to list archived offers too") }).passthrough(),
  },
  responses: {
    200: { description: "The brand's offers", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandOffersListResponse") } } },
    400: { description: "Invalid brand ID format (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "No such brand (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}",
  tags: ["Brand"],
  summary: "Read one offer",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/offers/{offerId}. Query string forwarded verbatim; status and body owned by brand-service.",
  security: authed,
  request: { params: BrandOfferParams },
  responses: {
    200: { description: "The offer", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandOfferResponse") } } },
    400: { description: "Invalid brand or offer ID format (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "No such brand, or no such offer on it (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ===================================================================
// Brand – Offer documents (proxy to brand-service /orgs/brands/:id/offers/:offerId/documents[/:documentId]).
// Files the client owns about one offer, which the AI responder can attach when a prospect replies.
// Responses are passthrough: brand-service owns { document[, created] } / { documents } and every refusal.
// The request bodies below are documentation only; nothing is validated or stripped here.
// ===================================================================
const OfferDocumentResponseSchema = z.object({}).passthrough().openapi("OfferDocumentResponse");
const OfferDocumentParams = BrandOfferParams.extend({
  documentId: z.string().describe("Document ID (from the list or the upload answer)"),
});
const OFFER_DOCUMENTS_MODEL =
  "Documents are files the client owns about ONE offer (a one-pager, a case study, a spec sheet, an FAQ), sent as an " +
  "email attachment on a reply to a prospect. Uploading one changes no campaign by itself: a document is attached only " +
  "(a) when you reply yourself with `POST /v1/replies` and list it in `attachments` [{ document_id }], or (b) by a " +
  "WORKFLOW that attaches offer documents, reading this list (fileName + description) to pick the file that helps. " +
  "Which workflow a campaign's pipe runs is chosen by its PLAY, not by you directly: to make a campaign's AI meeting " +
  "booking replies carry an attachment, find (`GET /v1/tactics?q=attach`) or create (`POST /v1/tactics`) a tactic " +
  "describing that attachment behaviour, a strategy requiring it (`POST /v1/strategies`), add it as a play on the " +
  "pipe `ai-meeting-booking|conversation_to_meeting_booked` (`POST /v1/plays`), then pick a sales funnel running that " +
  "play (`GET /v1/offers/{offerId}/sales-funnels`, its id carries `@ai-meeting-booking~<strategy id>`) and launch it " +
  "with `POST /v1/sales-funnel-campaigns`. Write each description as when the file helps a prospect. " +
  "Accepted: pdf, docx, pptx, xlsx, doc, ppt, xls, csv, txt, md, png, jpg/jpeg, gif, webp; at most 5 MB per file " +
  "and 25 files per offer. The file extension decides the type and must match the content.";
const OfferDocumentJsonUpload = z
  .object({
    fileName: z.string().describe("File name WITH its extension; the extension decides the type, e.g. case-study.pdf"),
    description: z.string().describe("What the file is and when it helps a prospect (1 to 1000 characters). Required."),
    contentBase64: z.string().describe("The file bytes, base64 (at most 5 MB decoded)."),
  })
  .passthrough()
  .openapi("OfferDocumentJsonUpload");
const OfferDocumentMultipartUpload = z
  .object({
    file: z.string().openapi({ type: "string", format: "binary", description: "The file (at most 5 MB)." }),
    description: z.string().describe("What the file is and when it helps a prospect. Required."),
    fileName: z.string().optional().describe("Overrides the uploaded file name (must keep an accepted extension)."),
  })
  .openapi("OfferDocumentMultipartUpload");
const OfferDocumentPatch = z
  .object({
    fileName: z.string().optional().describe("New name; must keep the same type of extension."),
    description: z.string().optional().describe("New description (1 to 1000 characters)."),
  })
  .passthrough()
  .openapi("OfferDocumentPatch");
const OFFER_DOCUMENT_ERRORS = {
  400: { description: "Invalid ID, body or file (reason names it), forwarded verbatim", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
  404: { description: "No such brand, offer or document (forwarded verbatim)", content: errorContent },
  500: { description: "Upstream error", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/documents",
  tags: ["Brand"],
  summary: "List an offer's documents",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/offers/{offerId}/documents. " + OFFER_DOCUMENTS_MODEL +
    " Answers { documents }, oldest first, metadata only (no file bytes).",
  security: authed,
  request: { params: BrandOfferParams },
  responses: {
    200: { description: "The offer's documents", content: { "application/json": { schema: OfferDocumentResponseSchema } } },
    ...OFFER_DOCUMENT_ERRORS,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/offers/{offerId}/documents",
  tags: ["Brand"],
  summary: "Upload a document to an offer",
  description:
    "Proxy to brand-service POST /orgs/brands/{brandId}/offers/{offerId}/documents. " + OFFER_DOCUMENTS_MODEL +
    " Send JSON { fileName, description, contentBase64 } or multipart/form-data (file, description, optional fileName). " +
    "201 { document, created: true }; the same bytes already on this offer answer 200 { document, created: false } " +
    "(a retry stores nothing twice).",
  security: authed,
  request: {
    params: BrandOfferParams,
    body: {
      content: {
        "application/json": { schema: OfferDocumentJsonUpload },
        "multipart/form-data": { schema: OfferDocumentMultipartUpload },
      },
    },
  },
  responses: {
    200: { description: "Same bytes already on this offer: the stored document, created false", content: { "application/json": { schema: OfferDocumentResponseSchema } } },
    201: { description: "Document stored, created true", content: { "application/json": { schema: OfferDocumentResponseSchema } } },
    ...OFFER_DOCUMENT_ERRORS,
    409: { description: "reason too_many_documents: the offer already holds 25 files (forwarded verbatim)", content: errorContent },
    413: { description: "reason file_too_large: the file is over 5 MB (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/documents/{documentId}",
  tags: ["Brand"],
  summary: "Read one offer document",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/offers/{offerId}/documents/{documentId}. " + OFFER_DOCUMENTS_MODEL +
    " Answers { document }, metadata only.",
  security: authed,
  request: { params: OfferDocumentParams },
  responses: {
    200: { description: "The document", content: { "application/json": { schema: OfferDocumentResponseSchema } } },
    ...OFFER_DOCUMENT_ERRORS,
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/brands/{id}/offers/{offerId}/documents/{documentId}",
  tags: ["Brand"],
  summary: "Rename or re-describe an offer document",
  description:
    "Proxy to brand-service PATCH /orgs/brands/{brandId}/offers/{offerId}/documents/{documentId}. " + OFFER_DOCUMENTS_MODEL +
    " Send fileName, description, or both. Answers { document }.",
  security: authed,
  request: {
    params: OfferDocumentParams,
    body: { content: { "application/json": { schema: OfferDocumentPatch } } },
  },
  responses: {
    200: { description: "The updated document", content: { "application/json": { schema: OfferDocumentResponseSchema } } },
    ...OFFER_DOCUMENT_ERRORS,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{id}/offers/{offerId}/documents/{documentId}",
  tags: ["Brand"],
  summary: "Delete an offer document",
  description:
    "Proxy to brand-service DELETE /orgs/brands/{brandId}/offers/{offerId}/documents/{documentId}. " + OFFER_DOCUMENTS_MODEL +
    " Answers { deleted: true, documentId }.",
  security: authed,
  request: { params: OfferDocumentParams },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OfferDocumentResponseSchema } } },
    ...OFFER_DOCUMENT_ERRORS,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/documents/{documentId}/content",
  tags: ["Brand"],
  summary: "Download an offer document's file",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/offers/{offerId}/documents/{documentId}/content. " + OFFER_DOCUMENTS_MODEL +
    " Answers the raw file bytes under the document's own Content-Type, with Content-Disposition (attachment, the file name) " +
    "and X-Document-Sha256 (hex SHA-256 of the bytes).",
  security: authed,
  request: { params: OfferDocumentParams },
  responses: {
    200: {
      description: "The file bytes",
      content: { "application/octet-stream": { schema: z.string().openapi({ type: "string", format: "binary" }) } },
    },
    ...OFFER_DOCUMENT_ERRORS,
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
// Brand – competitors (proxy to brand-service /orgs/brands/{brandId}/competitors[/discover])
// Customer surface (org + user). Passthrough: brand-service owns every body and
// which website is judged to be each competitor.
// ===================================================================
const BrandCompetitorsSchema = z.object({}).passthrough().openapi("BrandCompetitors");
const DiscoverBrandCompetitorsBodySchema = z
  .object({
    refresh: z
      .boolean()
      .optional()
      .describe("true recomputes even when a stored answer exists; omitted/false reuses the stored answer."),
  })
  .passthrough()
  .openapi("DiscoverBrandCompetitorsBody");

const BRAND_COMPETITORS_NOTE =
  "The brand's direct competitors. Answers { brandId, status: not_computed | computed, discoveredAt, provenance, " +
  "competitors: [{ name, domain, websiteConfidence, linkedinUrl, linkedinSource }], competitorsWithoutWebsite: " +
  "[{ name }] }. A competitor is listed with a website only when that site was judged to be that company; otherwise " +
  "it is in competitorsWithoutWebsite. Shape owned by brand-service (passthrough).";

const brandCompetitorsErrors = {
  400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Brand not in caller's org (forwarded verbatim)", content: errorContent },
  404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
  500: { description: "Upstream error", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/competitors",
  tags: ["Brand"],
  summary: "Read the brand's competitors",
  description:
    "Proxy to brand-service GET /orgs/brands/{brandId}/competitors. Reads what is stored: never computes, never " +
    "spends; status not_computed means discovery has not run yet. " + BRAND_COMPETITORS_NOTE,
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "The stored answer (or not_computed)", content: { "application/json": { schema: BrandCompetitorsSchema } } },
    ...brandCompetitorsErrors,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{id}/competitors/discover",
  tags: ["Brand"],
  summary: "Discover the brand's competitors",
  description:
    "Proxy to brand-service POST /orgs/brands/{brandId}/competitors/discover. Computes once and stores the answer; " +
    "later calls reuse it unless { refresh: true }. Spends org credits (402 when the org cannot pay). " +
    BRAND_COMPETITORS_NOTE,
  security: authed,
  request: {
    params: BrandIdParam,
    body: { required: false, content: { "application/json": { schema: DiscoverBrandCompetitorsBodySchema } } },
  },
  responses: {
    200: { description: "The stored or freshly computed answer", content: { "application/json": { schema: BrandCompetitorsSchema } } },
    ...brandCompetitorsErrors,
    402: { description: "Insufficient credits (forwarded verbatim)", content: errorContent },
    422: { description: "Nothing known about the brand to discover from (forwarded verbatim)", content: errorContent },
    502: { description: "A downstream step failed (forwarded verbatim)", content: errorContent },
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
  security: platformAuth,
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

// Offer-level user fields (the dashboard's "Your offer, in six points" and "What you give away"
// steps). Routed by OFFER_ROUTES in src/routes/brand.ts since they shipped; documented here so an
// agent following the first-client path can find them. Shapes are brand-service's (snapshots).
registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/user-fields",
  tags: ["Brand"],
  summary: "Get one offer's confirmed user-facing fields",
  description:
    "Proxy to brand-service GET /orgs/brands/{id}/offers/{offerId}/user-fields: each offer field with its value and " +
    "provenance (`confirmed`, else an auto-extracted `suggested` prefill). Response shape is owned by brand-service.",
  security: authed,
  request: { params: BrandOfferParam },
  responses: {
    200: { description: "The offer's user-facing fields with provenance", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferUserFieldsResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand or offer not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/offers/{offerId}/user-fields",
  tags: ["Brand"],
  summary: "Confirm (upsert) one offer's user-facing fields",
  description:
    "Proxy to brand-service PUT /orgs/brands/{id}/offers/{offerId}/user-fields. Upserts the confirmed values the " +
    "client states about this offer (its key points, what it gives for free, what it never gives) and returns the " +
    "updated view. Body + response shapes are owned by brand-service; its 4xx propagate verbatim.",
  security: authed,
  request: {
    params: BrandOfferParam,
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferUserFieldsRequest") } } },
  },
  responses: {
    200: { description: "The updated offer fields with provenance", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferUserFieldsUpdateResponse") } } },
    400: { description: "Validation error / unknown key (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand or offer not found (forwarded verbatim)", content: errorContent },
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
                dimensions: z.record(z.string(), z.string().nullable()).describe("Dimension key-value pairs (e.g. { brandId: '...' })"),
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
    config: z.record(z.string(), z.unknown()).optional().describe("Node-specific configuration"),
    inputMapping: z.record(z.string(), z.unknown()).optional().describe("Maps input variables to this node"),
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
    reason: deprecationReasonField,
    decidedBy: deprecationDecidedByField,
  })
  .passthrough()
  .openapi("WorkflowDynastyStatusRequest", { example: { status: "deprecated", reason: "Spam complaints above 0.3% on Gmail" } });

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

const workflowForkDescription =
  "Copies a workflow with a stated change into a NEW dynasty. `changes` is a JSON Patch (RFC 6902: `add`, " +
  "`replace`, `remove`, `test`) applied in order to a copy of the source DAG (`{nodes, edges}`, read it with " +
  "GET /v1/workflows/{id}); everything it does not name stays byte-identical. Under `/nodes` a non-numeric " +
  "path segment names a node by its `id`, e.g. `{ op: \"add\", path: \"/nodes/fetch-lead/config/body\", value: {...} }`. " +
  "The copy is validated like any stored workflow, deployed, and serves every pipe its source serves (active at once); " +
  "the source is never modified. Optional `description` (defaults to the source's: say what the copy does " +
  "differently, workflows are judged on their DAG and description) and `tags`. Responses come back from " +
  "workflow-service verbatim: 201 `{ workflow, sourceWorkflow, changesApplied }`; 400 change leaves the DAG " +
  "identical or the result is invalid; 404; 409 the same copy already exists (`existingWorkflowId`, so a re-run " +
  "is idempotent); 422 a change cannot apply (`changeIndex`).";

const WorkflowForkRequestSchema = z
  .object({
    changes: z.array(z.object({
      op: z.string().describe("\"add\" | \"replace\" | \"remove\" | \"test\""),
      path: z.string().describe("JSON Pointer into the DAG; under /nodes a non-numeric segment is a node id"),
      value: z.any().optional().describe("Required except for remove"),
    }).passthrough()).describe("The stated change, applied in order. Validated by workflow-service."),
    description: z.string().optional().describe("The copy's description. Defaults to the source's."),
    tags: z.array(z.string()).optional().describe("The copy's tags. Defaults to the source's."),
  })
  .passthrough()
  .openapi("WorkflowForkRequest");

const workflowForkResponses = {
  201: {
    description: "Forked: `{ workflow, sourceWorkflow, changesApplied }` (pass-through from workflow-service)",
    content: { "application/json": { schema: z.object({}).passthrough().openapi("WorkflowForkResponse") } },
  },
  400: { description: "Invalid body, no-op change or invalid resulting DAG (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  404: { description: "Workflow / dynasty not found (forwarded verbatim)", content: errorContent },
  409: { description: "The copy already exists: `existingWorkflowId` (forwarded verbatim)", content: errorContent },
  422: { description: "A change cannot apply: `changeIndex` (forwarded verbatim)", content: errorContent },
  502: { description: "Upstream failure (forwarded verbatim)", content: errorContent },
};

registry.registerPath({
  method: "post",
  path: "/v1/workflows/{id}/fork",
  tags: ["Workflows"],
  summary: "Fork a workflow version with a stated change",
  description: "Transparent proxy to workflow-service POST /workflows/{id}/fork. The copy branches from exactly this version. " + workflowForkDescription,
  security: authed,
  request: {
    params: z.object({ id: z.string().uuid().describe("Workflow version id") }),
    body: { content: { "application/json": { schema: WorkflowForkRequestSchema } } },
  },
  responses: workflowForkResponses,
});

registry.registerPath({
  method: "post",
  path: "/v1/workflows/dynasty/{workflowDynastySlug}/fork",
  tags: ["Workflows"],
  summary: "Fork a workflow dynasty with a stated change",
  description:
    "Transparent proxy to workflow-service POST /workflows/dynasty/{workflowDynastySlug}/fork. The dynasty slug " +
    "resolves to its currently-active version, which the copy branches from. " + workflowForkDescription,
  security: authed,
  request: {
    params: z.object({ workflowDynastySlug: z.string().describe("Stable dynasty slug") }),
    body: { content: { "application/json": { schema: WorkflowForkRequestSchema } } },
  },
  responses: workflowForkResponses,
});

registry.registerPath({
  method: "put",
  path: "/v1/workflows/dynasty/{workflowDynastySlug}/status",
  tags: ["Workflows"],
  summary: "Set workflow dynasty status",
  description:
    "Activate or deprecate a workflow dynasty by its stable dynasty slug. Proxied verbatim to workflow-service. " +
    "Deprecating hides the dynasty from selection; reactivating restores it. Staff only: a dynasty is cross-org, " +
    "so a distribute.you staff member's own key or the platform key with a staff x-email; any other key gets 403 `staff_only`.",
  security: platformAuth,
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
    403: { description: "Not staff", content: errorContent },
    404: { description: "Workflow dynasty not found", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/workflows/summaries",
  tags: ["Workflows"],
  summary: "List what each workflow of a feature does, without its DAG",
  description:
    "A light listing to choose a workflow: per version its id, workflowSlug, workflowName, workflowDynastySlug, " +
    "workflowDynastyName, featureSlug, description (what it does, in plain words), status, workflowDynastyStatus, " +
    "version, tags, contentModel, contentPromptType, createdAt, updatedAt. Never the DAG: GET /v1/workflows returns " +
    "every DAG (hundreds of KB per feature); read one DAG on demand with GET /v1/workflows/{id}. Sorted by dynasty, " +
    "newest version first. Transparent proxy to workflow-service GET /workflows/summaries: the query string is " +
    "forwarded verbatim; the parameters below are the ones it documents today, not a whitelist. Response is producer-owned.",
  security: authed,
  request: {
    query: z
      .object({
        featureSlug: z.string().optional().describe("Exact match on the feature slug (e.g. ai-meeting-booking)."),
        workflowDynastySlug: z.string().optional().describe("One lineage, every version (the unversioned slug)."),
        status: z
          .string()
          .optional()
          .describe("active (default: executable, version active AND dynasty not retired) | deprecated | all."),
      })
      .passthrough(),
  },
  responses: {
    200: {
      description: "{ workflows: [...] } without DAGs, pass-through from workflow-service",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("WorkflowSummariesResponse") } },
    },
    400: { description: "Refused by workflow-service, forwarded verbatim", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
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
    reason: deprecationReasonField,
    decidedBy: deprecationDecidedByField,
  })
  .passthrough()
  .openapi("WorkflowStatusRequest", { example: { status: "deprecated", reason: "Replaced by v4, which books more meetings" } });

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
    "and reaches the caller field-for-field. Staff only (a workflow is cross-org): a staff member's own key or " +
    "the platform key with a staff x-email; any other key gets 403 `staff_only`.",
  security: platformAuth,
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
            inputs: z.record(z.string(), z.any()).optional().describe("Runtime inputs accessible via $ref:flow_input.fieldName"),
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
  security: platformAuth, // STAFF ONLY (requireStaff): prompts are platform-wide IP
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
  security: platformAuth, // STAFF ONLY (requireStaff): prompts are platform-wide IP
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
      .record(z.string(), z.unknown())
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
    args: z.record(z.string(), z.unknown()).describe("Input arguments passed to the tool, as a JSON object"),
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
        "Response includes `balance_cents` (current balance) and `required_cents` (minimum needed). " +
        "When `reason` is `sales_funnel_max_budget_reached` / `sales_funnel_max_budget_unreadable`, the campaign's MAX BUDGET " +
        "refused the spend instead (`sales_funnel_cap` carries it): raise the max budget, adding credit does not help.",
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

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/runway",
  tags: ["Billing"],
  summary: "Get account runway",
  description:
    "How many days the prepaid balance lasts at the org's daily budget — pass-through from billing-service " +
    "(`state`: days, depleted, no_budget, budget_unavailable, not_prepaid; plus balance_cents, daily_budget_cents, " +
    "configured_daily_budget_cents, days_left, days_left_exact, runs_out_at). Body and status forwarded verbatim.",
  security: authed,
  responses: {
    200: {
      description: "Runway info — pass-through from billing-service",
      content: {
        "application/json": {
          schema: z.object({}).passthrough().openapi("RunwayResponse"),
        },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No billing account for this org", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "Billing upstream unavailable", content: errorContent },
  },
});

// Monthly charge limit — "the card is never charged more than $X a month".
// Pass-through to billing-service /v1/accounts/monthly_charge_limit (PR #740).
const MONTHLY_CHARGE_LIMIT_ANSWER =
  "`{org_id, monthly_charge_limit_cents (null = no limit), period: \"calendar_month_utc\", period_start, period_end, " +
  "charged_this_period_cents, remaining_cents, limit_reached, limit_reached_at, refused_amount_cents, updated_at}`. " +
  "No billing account needed (onboarding may state it before any payment). Body and status forwarded verbatim.";

export const SetMonthlyChargeLimitRequestSchema = z
  .object({
    monthly_charge_limit_cents: z
      .number()
      .int()
      .min(0)
      .openapi({ description: "Most the org's card may be charged per calendar month (UTC), in cents", example: 50000 }),
  })
  .openapi("SetMonthlyChargeLimitRequest");

const MonthlyChargeLimitResponseSchema = z.object({}).passthrough().openapi("MonthlyChargeLimitResponse");

for (const [method, summary, lead] of [
  ["get", "Get the monthly charge limit", "Read the org's monthly card charge limit and this month's charges."],
  ["put", "Set the monthly charge limit", "Set the most the org's card may be charged per calendar month (UTC)."],
  ["delete", "Remove the monthly charge limit", "Remove the org's monthly card charge limit."],
] as const) {
  registry.registerPath({
    method,
    path: "/v1/billing/accounts/monthly_charge_limit",
    tags: ["Billing"],
    summary,
    description: `${lead} Pass-through from billing-service. Answer: ${MONTHLY_CHARGE_LIMIT_ANSWER}`,
    security: authed,
    ...(method === "put"
      ? { request: { body: { content: { "application/json": { schema: SetMonthlyChargeLimitRequestSchema } } } } }
      : {}),
    responses: {
      200: {
        description: "Monthly charge limit state — pass-through from billing-service",
        content: { "application/json": { schema: MonthlyChargeLimitResponseSchema } },
      },
      ...(method === "put"
        ? { 400: { description: "Invalid monthly_charge_limit_cents (billing-service's refusal, verbatim)", content: errorContent } }
        : {}),
      401: { description: "Unauthorized", content: errorContent },
      500: { description: "Internal error", content: errorContent },
      502: { description: "Billing upstream unavailable", content: errorContent },
    },
  });
}

// Pay balance — postpaid "Pay $X now". Pass-through to billing-service
// POST /v1/accounts/pay_balance: no body, every refusal forwarded verbatim.
const PayBalanceRefusalSchema = z.object({}).passthrough().openapi("PayBalanceRefusal");

registry.registerPath({
  method: "post",
  path: "/v1/billing/accounts/pay_balance",
  tags: ["Billing"],
  summary: "Pay what a postpaid account owes now",
  description:
    "Charges the org's saved card, off-session, for exactly the amount the postpaid account owes " +
    "(billing-service computes it; no body). Transparent proxy to billing-service " +
    "POST /v1/accounts/pay_balance: status and body forwarded verbatim. Refusals carry a stable " +
    "`code` and, where relevant, `owed_cents`: 402 `charge_declined`; 409 `not_postpaid`, " +
    "`balance_below_minimum_charge`, `no_chargeable_payment_method`, `card_not_chargeable_off_session`; " +
    "429 `charge_backoff`; 502 `upstream_error`; 404 no billing account. The gateway adds no retry.",
  security: authed,
  responses: {
    200: {
      description: "Charged — pass-through from billing-service (`{ charged_cents, account }`)",
      content: {
        "application/json": { schema: z.object({}).passthrough().openapi("PayBalanceResponse") },
      },
    },
    401: { description: "Unauthorized", content: errorContent },
    402: {
      description: "Card declined, no money taken: `{ error, code: \"charge_declined\", owed_cents }`",
      content: { "application/json": { schema: PayBalanceRefusalSchema } },
    },
    404: { description: "No billing account for this org (billing-service, verbatim)", content: errorContent },
    409: {
      description:
        "Nothing charged: `code` is `not_postpaid`, `balance_below_minimum_charge`, " +
        "`no_chargeable_payment_method` or `card_not_chargeable_off_session`; body carries `owed_cents`",
      content: { "application/json": { schema: PayBalanceRefusalSchema } },
    },
    429: {
      description:
        "`code: \"charge_backoff\"` (billing holds off after a recent failed charge) or the gateway's own rate limiter",
      headers: {
        "Retry-After": { description: "Seconds to wait before retrying.", schema: { type: "integer" as const } },
      },
      content: { "application/json": { schema: PayBalanceRefusalSchema } },
    },
    500: { description: "Internal error", content: errorContent },
    502: {
      description: "`code: \"upstream_error\"` — no answer from the card processor; not a decline",
      content: { "application/json": { schema: PayBalanceRefusalSchema } },
    },
  },
});

// Top-up minimums — the smallest top-up and auto-reload threshold this org may set.
// Pass-through to billing-service /v1/accounts/topup_minimums. GET: any org member.
// PUT: staff only (requireStaffActor), listed in STAFF_KEY_OPERATIONS.
const TOPUP_MINIMUMS_ANSWER =
  "`{org_id, free_credit_offer, topup_minimum_cents, reload_threshold_minimum_cents, topup_minimum_source, " +
  "reload_threshold_minimum_source (\"account\" | \"offer_default\"), offer_default_topup_minimum_cents, " +
  "offer_default_reload_threshold_minimum_cents, set_by, set_at}`. null = no minimum. Body and status forwarded verbatim.";

const TopupMinimumsResponseSchema = z.object({}).passthrough().openapi("TopupMinimumsResponse");

export const SetTopupMinimumsRequestSchema = z
  .object({
    topup_minimum_cents: z
      .number()
      .int()
      .nullable()
      .optional()
      .openapi({ description: "Smallest top-up this org may make (checkout, on-demand charge, auto-reload amount), in cents. null = back to the offer default", example: 1000 }),
    reload_threshold_minimum_cents: z
      .number()
      .int()
      .nullable()
      .optional()
      .openapi({ description: "Smallest auto-reload threshold this org may set, in cents. null = back to the offer default", example: 1000 }),
  })
  .passthrough()
  .openapi("SetTopupMinimumsRequest");

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/topup_minimums",
  tags: ["Billing"],
  summary: "Get the org's top-up minimums",
  description:
    "Read the smallest top-up and the smallest auto-reload threshold the org in context may set, and whether each " +
    `comes from the org itself or its offer default. Pass-through from billing-service. Answer: ${TOPUP_MINIMUMS_ANSWER}`,
  security: authed,
  responses: {
    200: { description: "Minimums in force — pass-through from billing-service", content: { "application/json": { schema: TopupMinimumsResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No billing account for this org (billing-service's answer, verbatim)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/billing/accounts/topup_minimums",
  tags: ["Billing"],
  summary: "Set the org's top-up minimums (staff only)",
  description:
    "Set the smallest top-up and/or the smallest auto-reload threshold for ONE org (name it with `orgId` or a brand). " +
    "Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key " +
    "gets 403 `staff_only`. The staff email is recorded as `set_by`. billing-service validates the body; a top-up or " +
    "threshold below the minimum is refused there with `code` + `minimum_cents`. " +
    `Pass-through from billing-service PUT /v1/accounts/topup_minimums. Answer: ${TOPUP_MINIMUMS_ANSWER}`,
  security: platformAuth,
  request: { body: { content: { "application/json": { schema: SetTopupMinimumsRequestSchema } } } },
  responses: {
    200: { description: "Minimums in force — pass-through from billing-service", content: { "application/json": { schema: TopupMinimumsResponseSchema } } },
    400: { description: "Invalid body (billing-service's refusal, verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "No billing account for this org (billing-service's answer, verbatim)", content: errorContent },
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
  path: "/v1/subscriber-links/{linkId}",
  tags: ["Platform"],
  summary: "Resolve a newsletter link id to its subscriber (server-to-server)",
  description:
    "Who a newsletter link's `dy_sub` id names. Platform API key only, and refused 403 " +
    "(`server_to_server_only`) when the request carries any user/org identity header, so a " +
    "browser-facing proxy cannot read a subscriber's email. Pass-through from " +
    "transactional-email-service: 200 valid (subscriber + list), 400 tampered, 404 unknown, 410 revoked.",
  security: platformAuth,
  request: {
    params: z.object({
      linkId: z.string().openapi({ description: "The opaque `dy_sub` value from the link" }),
    }),
  },
  responses: {
    200: {
      description: "Valid link: the subscriber and list (pass-through)",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("SubscriberLinkResolution") } },
    },
    400: { description: "Tampered link id (pass-through body)", content: errorContent },
    401: { description: "Missing or invalid platform API key", content: errorContent },
    403: { description: "Request carries a user/org identity (server_to_server_only)", content: errorContent },
    404: { description: "Unknown link id (pass-through body)", content: errorContent },
    410: { description: "Revoked link (pass-through body)", content: errorContent },
  },
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
  summary: "Grant free credit to an organization (staff only)",
  description:
    "Give an organization free credit: an amount in cents and a note. Name the organization with `orgId` " +
    "(or a brand with `brandId`). Staff only: a distribute.you staff member's own API key, or the platform key " +
    "with a staff x-email; any other key gets 403 `staff_only`. Idempotent on `idempotencyKey`: a retry with the " +
    "same key grants nothing more, a new key stacks a new grant. Transparent proxy to billing-service " +
    "POST /v1/credits/grant, which validates the body and owns the response.",
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

export const BillingAbsorbedCostsResponseSchema = z.object({}).passthrough().openapi("BillingAbsorbedCostsResponse");

registry.registerPath({
  method: "get",
  path: "/v1/billing/absorbed-costs",
  tags: ["Billing"],
  summary: "Cost the platform absorbs per customer, per month since inception (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email). Byte passthrough to billing-service " +
    "GET /internal/absorbed-costs (spend with no campaign + card fees, per customer, per month); " +
    "query string forwarded verbatim, status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z
      .object({
        fresh: z.string().optional().openapi({ description: "`true` bypasses billing-service's cache. Documented today, not a whitelist: the query string is forwarded verbatim." }),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "Absorbed costs — pass-through from billing-service", content: { "application/json": { schema: BillingAbsorbedCostsResponseSchema } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
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
  path: "/v1/runs/stats/outcome-coverage",
  tags: ["Runs"],
  summary: "Share of spend whose run declared its outcome, per UTC day (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide. " +
    "Byte passthrough to runs-service GET /internal/stats/outcome-coverage: per UTC day, the share of spend whose run declared the outcome it produced, fleet-wide and per service. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      since: z.string().optional().openapi({ description: "Start of the window (runs-service validates it)" }),
      until: z.string().optional().openapi({ description: "End of the window (runs-service validates it)" }),
      serviceName: z.string().optional().openapi({ description: "Restrict to one service" }),
      taskName: z.string().optional().openapi({ description: "Restrict to one task" }),
    }).passthrough(),
  },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("OutcomeCoverageStatsResponse") } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/runs/outcome-costs/ledger-check",
  tags: ["Runs"],
  summary: "Cost ledger to-the-cent check per org-day (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide. " +
    "Byte passthrough to runs-service GET /internal/outcome-costs/ledger-check: every org-day balances on gross, net and vendor, failing org-days listed. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      since: z.string().optional().openapi({ description: "Start of the window (runs-service validates it)" }),
      until: z.string().optional().openapi({ description: "End of the window (runs-service validates it)" }),
      rows: z.string().optional().openapi({ description: "Max failing org-days listed (runs-service validates it)" }),
    }).passthrough(),
  },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("OutcomeCostLedgerCheckResponse") } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/runs/outcome-costs/reconciliation",
  tags: ["Runs"],
  summary: "Cost ledger reconciliation per UTC day (staff only)",
  description:
    "Staff-only (platform API key + STAFF_EMAILS x-email), fleet-wide. " +
    "Byte passthrough to runs-service GET /internal/outcome-costs/reconciliation: per UTC day since the first day of spend, fleet-wide spend split into declared production, normal loss, unpooled loss, undeclared and support, plus undeclared services, unknown-provenance outcomes and the reconciled verdict. Query string forwarded verbatim (the parameters below are the ones documented today, not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      since: z.string().optional().openapi({ description: "YYYY-MM-DD, default the first day of spend (runs-service validates it)" }),
      until: z.string().optional().openapi({ description: "YYYY-MM-DD inclusive, default yesterday UTC (runs-service validates it)" }),
    }).passthrough(),
  },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("OutcomeCostReconciliationResponse") } } },
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

// Agent skill tree, read-only, any authenticated caller (src/routes/agent-skills.ts)
const AGENT_SKILLS_MODEL =
  "The skill tree is the method our Copilot follows to organize a client's request on distribute.you (offers, catalogue, sales funnels, " +
  "campaigns, budget, workflows, tactics and plays): markdown skills in a tree, `index` first. Your own agent can follow the same method: " +
  "read the tree, then load a skill when its description matches the ask. Read-only; the same for every client.";
registry.registerPath({
  method: "get", path: "/v1/skills", tags: ["Skills"], security: authed,
  summary: "List the agent skill tree",
  description: `${AGENT_SKILLS_MODEL} Answers { skills: [{ slug, parentSlug, title, description, position, version, ... }] } without content. Byte passthrough to chat-service GET /internal/skills; status and body owned by it.`,
  responses: {
    200: { description: "The skill tree", content: { "application/json": { schema: z.object({}).passthrough().openapi("AgentSkillsListResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});
registry.registerPath({
  method: "get", path: "/v1/skills/{slug}", tags: ["Skills"], security: authed,
  summary: "Read one agent skill",
  description: `${AGENT_SKILLS_MODEL} Answers one skill with its markdown \`content\` (start with \`index\`). Byte passthrough to chat-service GET /internal/skills/{slug}; a 404 for an unknown slug comes back verbatim.`,
  request: { params: z.object({ slug: z.string().openapi({ description: "A skill slug from GET /v1/skills, e.g. `index`, `offers`, `campaigns`" }) }) },
  responses: {
    200: { description: "The skill with its content", content: { "application/json": { schema: z.object({}).passthrough().openapi("AgentSkillResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Unknown skill (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

// Requests to the team from any agent (src/routes/agent-requests.ts → chat-service /orgs/staff-requests)
const StaffRequestPieceSchema = z.object({
  piece: z.string(),
  outcome: z.enum(["exists", "create", "needs_code"]),
  detail: z.string().optional(),
});
export const AgentStaffRequestBodySchema = z
  .object({
    kind: z.enum(["bug", "feature", "skill_upgrade", "contact_human"]).openapi({
      description: "bug: something exists but fails. feature: a piece needs code (a new outcome or trigger included). skill_upgrade: a skill or a service doc misled you. contact_human: your user wants a person.",
    }),
    repo: z.string().optional().openapi({ description: "bug / feature: the fleet repo that owns the piece (e.g. features-service, campaign-service, crm-service). skill_upgrade: the repo whose docs are wrong (or send skillSlug)." }),
    skillSlug: z.string().optional().openapi({ description: "skill_upgrade: the skill to upgrade (a slug from GET /v1/skills)." }),
    title: z.string().optional().openapi({ description: "bug / feature / skill_upgrade: short title." }),
    userRequest: z.string().optional().openapi({ description: "bug / feature: your user's words." }),
    missingPiece: z.string().optional().openapi({ description: "bug / feature: what is broken or missing, and what you checked first." }),
    pieceKey: z.string().optional().openapi({ description: "Kebab-case dedupe key (default: from the title). Reuse the one GET /v1/staff-requests shows for the same need." }),
    decomposition: z.array(StaffRequestPieceSchema).optional(),
    newStepOrTrigger: z
      .object({
        kind: z.enum(["step", "trigger"]),
        name: z.string().openapi({ description: "The new outcome (step) or trigger, in your user's words." }),
        tool: z.string().openapi({ description: "Your user's tool where the real event happens (CRM, form, payments, site...)." }),
        event: z.string().openapi({ description: "The real event in that tool that would fill it." }),
        example: z.string().openapi({ description: "One person or case it would have fired for." }),
      })
      .optional()
      .openapi({ description: "kind feature only: a NEW outcome or trigger is a feature request, never a catalogue row (nothing would fill it)." }),
    problem: z.string().optional().openapi({ description: "skill_upgrade: what is wrong." }),
    proposedChange: z.string().optional().openapi({ description: "skill_upgrade: the text you propose, ready to paste." }),
    reason: z.string().optional().openapi({ description: "contact_human: why a person is needed." }),
    message: z.string().optional().openapi({ description: "contact_human: your user's message." }),
    urgency: z.enum(["normal", "urgent"]).optional(),
  })
  .openapi("AgentStaffRequestBody");
const AGENT_REQUESTS_MODEL =
  "The same requests our Copilot files (request_staff, request_skill_upgrade, contact_human), for your agent: same record, same GitHub issue " +
  "in the repo that owns the piece, same Telegram ping to the team. A new outcome or trigger is only ever a feature request (kind feature + newStepOrTrigger): " +
  "there is no route that creates one. Check GET /v1/staff-requests and the API first: an existing route or running campaign is the answer, not a request.";
registry.registerPath({
  method: "post", path: "/v1/staff-requests", tags: ["Skills"], security: authed,
  summary: "File a request to the team: bug, feature (a new outcome or trigger included), skill upgrade, or a person",
  description: `${AGENT_REQUESTS_MODEL} bug / feature / skill_upgrade open an issue and ping the team; contact_human pings the owner now (no issue, one ping per org every 10 minutes). Deduplicated per org on (repo, kind, pieceKey): a repeat answers 200 duplicate:true and counts it. Byte passthrough to chat-service POST /orgs/staff-requests.`,
  request: { body: { content: { "application/json": { schema: AgentStaffRequestBodySchema } } } },
  responses: {
    201: { description: "Filed: { requestId, kind, destination, issueUrl, staffPinged, ... }", content: { "application/json": { schema: z.object({}).passthrough().openapi("AgentStaffRequestResult") } } },
    200: { description: "Already filed by this org (requestCount bumped)", content: { "application/json": { schema: z.object({}).passthrough() } } },
    400: { description: "Refused with its reason (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Unknown skillSlug (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});
registry.registerPath({
  method: "get", path: "/v1/staff-requests", tags: ["Skills"], security: authed,
  summary: "List your org's requests to the team",
  description: `${AGENT_REQUESTS_MODEL} Answers { requests: [{ requestId, kind, repo, pieceKey, title, issueUrl, requestCount, createdAt }] }, newest first, 50 max. Byte passthrough to chat-service GET /orgs/staff-requests.`,
  responses: {
    200: { description: "The org's requests", content: { "application/json": { schema: z.object({}).passthrough().openapi("AgentStaffRequestList") } } },
    401: { description: "Unauthorized", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

// Tactics, strategies and plays — shared catalogue, any authenticated caller (src/routes/plays.ts)
const PLAYS_MODEL =
  "A TACTIC is a yes/no tag our judge puts on every workflow version, judged on the tactic's description (for example \"Catch-all\": sends to addresses whose mail server accepts every address). " +
  "A STRATEGY is a rule over tactics: the tactics a workflow must follow (`requires`) and must not follow (`excludes`), for example \"Valid + Catch-all\". " +
  "A PLAY is a pipe x a strategy (a pipe is one channel x one leg, id `<channel slug>|<leg key>`, e.g. `sales-cold-email-outreach|lead_found_to_website_visit`): the pipe runs only the workflows its strategy allows, picked by ROI. " +
  "Every pipe has a default play (id = the bare pipe id); another play's id is `<pipe id>~<strategy id>`. " +
  "This catalogue is shared by every client: read it before creating, names and descriptions are unique fleet-wide. " +
  "It is HOW you change what a campaign does (for example \"its AI meeting booking replies carry an offer document as an attachment\"): " +
  "(1) a tactic naming the behaviour (`GET /v1/tactics?q=...` first, else `POST /v1/tactics`); (2) a strategy requiring it (`POST /v1/strategies`); " +
  "(3) a play = that strategy on the pipe that should behave so (`POST /v1/plays`, e.g. pipe `ai-meeting-booking|conversation_to_meeting_booked`); " +
  "(4) a sales funnel running that play: in `GET /v1/offers/{offerId}/sales-funnels` each pipe of a funnel id reads `<leg>@<channel>` for its default play " +
  "and `<leg>@<channel>~<strategy id>` for another play; (5) a sales funnel campaign on that funnel (`POST /v1/sales-funnel-campaigns`, " +
  "create it with `status: stopped`, then run it when the client agrees). An existing campaign keeps its own funnel and plays: a new behaviour is a new campaign. " +
  "A new tactic is judged on every workflow within minutes; a strategy no workflow follows yet runs nothing (its play shows `runnable: false`). " +
  "A new tactic reaches no older strategy by itself: a strategy that names nothing about it lets its workflows through either way, so exclude it (or require it) there. " +
  "Editing a strategy's tactics or description is staff only (`PATCH /v1/strategies/{id}`), because it changes what every client's campaigns on its plays run.";
const playsCommon = (s: string) => `${s} ${PLAYS_MODEL} Byte passthrough to features-service; status and body (including 400/404/409 with a named \`reason\`) owned by it.`;
const playsListQuery = z.object({ q: z.string().optional().openapi({ description: "Text to find by name or id" }), limit: z.string().optional().openapi({ description: "Rows per page, 1..25 (default 10)" }) }).passthrough();
const playsErrors = {
  400: { description: "Invalid request, `reason` names it (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  502: { description: "Upstream error", content: errorContent },
  503: { description: "Catalogue figures not computed yet (forwarded verbatim)", content: errorContent },
};
const playsOk = (name: string) => ({ description: "Pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi(name) } } });

registry.registerPath({
  method: "get", path: "/v1/tactics", tags: ["Plays"], security: authed,
  summary: "List tactics",
  description: playsCommon("One page of tactics (id, name, description, how many workflows were judged on it and how many follow it). Query string forwarded verbatim (documented today: q, limit; not a whitelist)."),
  request: { query: playsListQuery },
  responses: { 200: playsOk("TacticsListResponse"), ...playsErrors },
});
registry.registerPath({
  method: "get", path: "/v1/tactics/{id}", tags: ["Plays"], security: authed,
  summary: "Read one tactic",
  description: playsCommon("One tactic with every workflow version judged on it (follows yes/no, probability)."),
  request: { params: z.object({ id: z.string().openapi({ description: "A tactic id (its name slugged, e.g. `catch-all`)" }) }) },
  responses: { 200: playsOk("TacticDetailResponse"), 404: { description: "Unknown tactic (forwarded verbatim)", content: errorContent }, ...playsErrors },
});
registry.registerPath({
  method: "post", path: "/v1/tactics", tags: ["Plays"], security: authed,
  summary: "Create a tactic",
  description: playsCommon("Declare a new tactic. Every workflow version is then judged on its description within minutes, so describe precisely what a workflow DOES, not what it is called. Name and description must be unique (409 `tactic_name_taken` / `tactic_description_taken`); the id is the name slugged. The author is recorded from your API key; any `createdBy` you send is replaced."),
  request: { body: { content: { "application/json": { schema: z.object({
    name: z.string().min(1).max(60).openapi({ description: "Short unique name, e.g. `Catch-all` (1 to 60 characters, else 400 `name_required` / `name_too_long`)" }),
    description: z.string().min(1).max(500).openapi({ description: "Unique, precise: what a workflow following it does (1 to 500 characters, else 400 `description_required` / `description_too_long`)" }),
  }).passthrough().openapi("CreateTacticRequest") } } } },
  responses: { 201: playsOk("CreateTacticResponse"), 409: { description: "Name or description taken (forwarded verbatim)", content: errorContent }, ...playsErrors },
});

registry.registerPath({
  method: "patch", path: "/v1/tactics/{id}", tags: ["Plays"], security: authed,
  summary: "Edit a tactic's description",
  description: playsCommon("Replace a tactic's description. Editing re-judges every workflow version on the new words within minutes; the old verdicts keep serving until each is replaced. The description must stay unique (409 `tactic_description_taken`) and at most 500 characters (400 `description_too_long`); an unknown tactic is 404 `tactic_not_found`. The answer carries the tactic, `changed`, `previousDescription`, `updatedBy` and `updatedAt`. The editor is recorded from your API key; any `updatedBy` you send is replaced."),
  request: {
    params: z.object({ id: z.string().openapi({ description: "A tactic id (its name slugged, e.g. `catch-all`)" }) }),
    body: { content: { "application/json": { schema: z.object({
      description: z.string().min(1).max(500).openapi({ description: "The new description, unique, at most 500 characters: what a workflow following the tactic does" }),
    }).passthrough().openapi("EditTacticRequest") } } },
  },
  responses: { 200: playsOk("EditTacticResponse"), 404: { description: "Unknown tactic (forwarded verbatim)", content: errorContent }, 409: { description: "Description taken (forwarded verbatim)", content: errorContent }, ...playsErrors },
});

registry.registerPath({
  method: "get", path: "/v1/strategies", tags: ["Plays"], security: authed,
  summary: "List strategies",
  description: playsCommon("One page of strategies (id, name, description, tactics required and excluded, pipes that already catalogue a play on it). Query string forwarded verbatim (documented today: q, limit; not a whitelist)."),
  request: { query: playsListQuery },
  responses: { 200: playsOk("StrategiesListResponse"), ...playsErrors },
});
registry.registerPath({
  method: "get", path: "/v1/strategies/{id}", tags: ["Plays"], security: authed,
  summary: "Read one strategy",
  description: playsCommon("One strategy: its tactics required and excluded and the pipes that catalogue a play on it."),
  request: { params: z.object({ id: z.string().openapi({ description: "A strategy id, e.g. `valid-catch-all`" }) }) },
  responses: { 200: playsOk("StrategyDetailResponse"), 404: { description: "Unknown strategy (forwarded verbatim)", content: errorContent }, ...playsErrors },
});
registry.registerPath({
  method: "post", path: "/v1/strategies", tags: ["Plays"], security: authed,
  summary: "Create a strategy",
  description: playsCommon("Declare a new strategy over existing tactics (at least one tactic in `requires` or `excludes`, never the same tactic in both). Name and description must be unique (409 `strategy_name_taken` / `strategy_description_taken`); a strategy with the same rule as an existing one is 409 `strategy_rule_taken` (use that one); an unknown tactic is 404 `tactic_not_found`. Then add it to a pipe with `POST /v1/plays`. The author is recorded from your API key; any `createdBy` you send is replaced."),
  request: { body: { content: { "application/json": { schema: z.object({
    name: z.string().min(1).max(60).openapi({ description: "Unique name, e.g. `Valid + Catch-all` (1 to 60 characters, else 400 `name_required` / `name_too_long`)" }),
    description: z.string().min(1).max(500).openapi({ description: "Unique description of what the strategy allows (1 to 500 characters, else 400 `description_required` / `description_too_long`)" }),
    requires: z.array(z.string()).optional().openapi({ description: "Tactic ids a workflow must follow" }),
    excludes: z.array(z.string()).optional().openapi({ description: "Tactic ids a workflow must not follow" }),
  }).passthrough().openapi("CreateStrategyRequest") } } } },
  responses: { 201: playsOk("CreateStrategyResponse"), 404: { description: "Unknown tactic (forwarded verbatim)", content: errorContent }, 409: { description: "Name, description or rule taken (forwarded verbatim)", content: errorContent }, ...playsErrors },
});

registry.registerPath({
  method: "patch", path: "/v1/strategies/{id}", tags: ["Plays"], security: platformAuth,
  summary: "Edit a strategy's tactics or description (staff only)",
  description: playsCommon("Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. Change a strategy's `requires`, `excludes` and/or `description`. Each list you send is the FULL new list (a field you leave out is unchanged; sending none of the three is 400 `edit_empty`). Use it when a new tactic leaks into an older strategy that names nothing about it: add the tactic to that strategy's `excludes`. The edit changes what every client's campaigns on this strategy's plays run. Refusals: 400 `requires_invalid` / `excludes_invalid` / `description_too_long` / `tactic_required_and_excluded` / `strategy_empty`; 404 `strategy_not_found` / `tactic_not_found`; 409 `strategy_description_taken` / `strategy_rule_taken` (another strategy already has this rule) / `default_play_runs_nothing` (a pipe's default play on it would run no workflow). The answer carries the strategy, `changed`, `previous {requires, excludes, description}`, `createdBy`, `createdAt`, `updatedBy`, `updatedAt`. The editor is recorded as the authenticated staff email; any `updatedBy` you send is replaced. Byte passthrough to features-service PATCH /internal/catalogue/strategies/{id}."),
  request: {
    params: z.object({ id: z.string().openapi({ description: "A strategy id, e.g. `valid-catch-all`" }) }),
    body: { content: { "application/json": { schema: z.object({
      requires: z.array(z.string()).optional().openapi({ description: "The FULL new list of tactic ids a workflow must follow (absent = unchanged)" }),
      excludes: z.array(z.string()).optional().openapi({ description: "The FULL new list of tactic ids a workflow must not follow (absent = unchanged)" }),
      description: z.string().optional().openapi({ description: "The new unique description (absent = unchanged)" }),
    }).passthrough().openapi("EditStrategyRequest") } } },
  },
  responses: {
    200: playsOk("EditStrategyResponse"),
    403: { description: "Not staff (`staff_only`)", content: errorContent },
    404: { description: "Unknown strategy or tactic (forwarded verbatim)", content: errorContent },
    409: { description: "Description or rule taken, or a default play would run nothing (forwarded verbatim)", content: errorContent },
    ...playsErrors,
  },
});

registry.registerPath({
  method: "get", path: "/v1/plays", tags: ["Plays"], security: authed,
  summary: "List the plays of a pipe",
  description: playsCommon("The plays a pipe catalogues (default play first) with their fleet cost, ROI and status. Pass `pipe` to list one pipe's plays; without it, every pipe cataloguing plays. Query string forwarded verbatim (documented today: pipe, limit; not a whitelist)."),
  request: { query: z.object({ pipe: z.string().optional().openapi({ description: "A pipe id, e.g. `sales-cold-email-outreach|lead_found_to_website_visit`" }), limit: z.string().optional().openapi({ description: "Rows per page, 1..25 (default 10)" }) }).passthrough() },
  responses: { 200: playsOk("PlaysListResponse"), ...playsErrors },
});
registry.registerPath({
  method: "get", path: "/v1/plays/{id}", tags: ["Plays"], security: authed,
  summary: "Read one play",
  description: playsCommon("One play: its pipe, strategy, fleet cost and ROI, why it is still learning, and the workflows its strategy rules out."),
  request: { params: z.object({ id: z.string().openapi({ description: "A play id: `<pipe id>` (default play) or `<pipe id>~<strategy id>`, URL-encoded" }) }) },
  responses: { 200: playsOk("PlayDetailResponse"), 404: { description: "Unknown play (forwarded verbatim)", content: errorContent }, ...playsErrors },
});
registry.registerPath({
  method: "post", path: "/v1/plays", tags: ["Plays"], security: authed,
  summary: "Add a play to a pipe",
  description: playsCommon("Add an existing strategy to a pipe as a new play, so campaigns on that pipe can run it (for example strategy `valid-catch-all` on pipe `sales-cold-email-outreach|lead_found_to_website_visit`). Idempotent: a play that already exists answers 200 with `created: false`; a new one 201. Unknown pipe or strategy is a 404 `*_not_found`. The author is recorded from your API key; any `createdBy` you send is replaced."),
  request: { body: { content: { "application/json": { schema: z.object({
    pipeId: z.string().min(1).max(200).openapi({ description: "Pipe id, `<channel slug>|<leg key>` (at most 200 characters)" }),
    strategyId: z.string().min(1).max(100).openapi({ description: "Strategy id (GET /v1/strategies, at most 100 characters)" }),
  }).passthrough().openapi("CreatePlayRequest") } } } },
  responses: { 200: playsOk("PlayAlreadyExistsResponse"), 201: playsOk("CreatePlayResponse"), 404: { description: "Unknown pipe or strategy (forwarded verbatim)", content: errorContent }, ...playsErrors },
});

// Agent catalogue (staff) — features-service /internal/catalogue/* (PR #1482)
registry.registerPath({
  method: "get",
  path: "/v1/catalogue/steps",
  tags: ["Features"],
  summary: "List catalogue steps",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. Steps are the outcomes a lead moves through (Lead found, Positive reply, Meeting booked, Paid client...): the words every leg, pipe and funnel is built from. " +
    "Byte passthrough to features-service GET /internal/catalogue/steps: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: q, limit (1..25, default 10); not a whitelist); status and body owned by the downstream service.",
  security: authed,
  request: { query: z.object({ q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueStepsListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/steps/{id}",
  tags: ["Features"],
  summary: "Read one catalogue step",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. Steps are the outcomes a lead moves through (Lead found, Positive reply, Meeting booked, Paid client...): the words every leg, pipe and funnel is built from. " +
    "Byte passthrough to features-service GET /internal/catalogue/steps/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: authed,
  request: { params: z.object({ id: z.string().openapi({ description: "a step key or label" }) }), query: z.object({  }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueStepsDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/sales-paths",
  tags: ["Features"],
  summary: "List catalogue sales paths",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. A sales path is a chain of legs from Start (or a trigger) to Paid client, with no channel yet: pick one, then the pipes that work each leg (GET /v1/catalogue/pipes?paths=<id>). With a customer key the list keeps only what we run today (`runnable=true` is forced; a staff key passes `runnable` as sent). " +
    "Byte passthrough to features-service GET /internal/catalogue/sales-paths: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: containsSteps, q, limit; not a whitelist); status and body owned by the downstream service.",
  security: authed,
  request: { query: z.object({ containsSteps: z.string().optional().openapi({ description: "Comma list of step keys or labels: the paths containing at least one" }), q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueSalesPathsListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/sales-paths/{id}",
  tags: ["Features"],
  summary: "Read one catalogue sales path",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. A sales path is a chain of legs from Start (or a trigger) to Paid client, with no channel yet: pick one, then the pipes that work each leg (GET /v1/catalogue/pipes?paths=<id>). " +
    "Byte passthrough to features-service GET /internal/catalogue/sales-paths/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: authed,
  request: { params: z.object({ id: z.string().openapi({ description: "a sales path id (leg keys joined by `+`, sent as `%2B`)" }) }), query: z.object({  }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueSalesPathsDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/channels",
  tags: ["Features"],
  summary: "List catalogue channels",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. A channel is what works a leg (cold email, AI meeting booking, your own team...). With a customer key the list keeps only what we run today (`runnable=true` is forced; a staff key passes `runnable` as sent). " +
    "Byte passthrough to features-service GET /internal/catalogue/channels: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: forPaths, legKeys, q, limit; not a whitelist); status and body owned by the downstream service.",
  security: authed,
  request: { query: z.object({ forPaths: z.string().optional().openapi({ description: "Comma list of sales path ids" }), legKeys: z.string().optional(), q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueChannelsListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/channels/{id}",
  tags: ["Features"],
  summary: "Read one catalogue channel",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. A channel is what works a leg (cold email, AI meeting booking, your own team...). " +
    "Byte passthrough to features-service GET /internal/catalogue/channels/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: authed,
  request: { params: z.object({ id: z.string().openapi({ description: "a channel slug" }) }), query: z.object({  }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueChannelsDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/pipes",
  tags: ["Features"],
  summary: "List catalogue pipes",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. A pipe is one channel working one leg (id `<channel slug>|<leg key>`): a sales funnel names one pipe per leg (POST /v1/catalogue/sales-funnels). With a customer key the list keeps only what we run today (`runnable=true` is forced; a staff key passes `runnable` as sent). " +
    "Byte passthrough to features-service GET /internal/catalogue/pipes: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: paths, channels, legKeys, q, limit; not a whitelist); status and body owned by the downstream service.",
  security: authed,
  request: { query: z.object({ paths: z.string().optional().openapi({ description: "Comma list of sales path ids" }), channels: z.string().optional().openapi({ description: "Comma list of channel slugs" }), legKeys: z.string().optional(), q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CataloguePipesListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/pipes/{id}",
  tags: ["Features"],
  summary: "Read one catalogue pipe",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. A pipe is one channel working one leg (id `<channel slug>|<leg key>`): a sales funnel names one pipe per leg (POST /v1/catalogue/sales-funnels). " +
    "Byte passthrough to features-service GET /internal/catalogue/pipes/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: authed,
  request: { params: z.object({ id: z.string().openapi({ description: "a pipe id `<channel slug>|<leg key>`" }) }), query: z.object({  }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CataloguePipesDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/catalogue/pipes",
  tags: ["Features"],
  summary: "Create a pipe: a channel on a new leg, proactive or reactive on a trigger (staff only)",
  description:
    "Fleet-wide catalogue write, usable by every org (like tactics, strategies and plays). Staff only: a distribute.you staff member's own " +
    "API key, or the platform key with a staff x-email; a customer key gets 403 `staff_only` (a customer builds sales funnels from the pipes we run, and asks for a new channel with a feature request). A pipe = a channel (GET /v1/catalogue/channels) " +
    "working one leg, from one step to the next (GET /v1/catalogue/steps). `mode: \"proactive\"` runs on its own budget and names no trigger; " +
    "`mode: \"reactive\"` names the trigger that asks for it (`triggerId`, GET /v1/catalogue/triggers), e.g. an AI instant call on Form submitted " +
    "toward Booking call. A leg out of a real step with no known conversion rate needs `conversionRatePct`. `published: false` = a draft. " +
    "Where a pipe on a trigger starts: at Start (`fromStep: null`, leg `start_to_<toStep>`), and the trigger starts it, like every running " +
    "reactive campaign; or out of a real step a trigger stands for (Positive reply, Form submitted). NEVER at Lead found: refused 400 " +
    "`reactive_pipe_from_lead_found`. A trigger's fromStep is where a lead stands when it fires, not where a reactive pipe starts. To reuse a " +
    "proactive pipe leaving that step, head a sales funnel with the trigger instead (POST /v1/catalogue/sales-funnels with `triggerId`). " +
    "A pipe created by mistake is retired with POST /v1/catalogue/pipes/{pipeId}/retire. " +
    "The workflow a pipe runs is never picked here: features-service runs the best ROI workflow written for the channel. " +
    "`createdBy` is recorded as the authenticated staff email (a body value is replaced). Answers 201 with the pipe (id `<channel slug>|<leg key>`, " +
    "readable at GET /v1/catalogue/pipes/{id}). Refusals forwarded verbatim: 400 `channel_slug_required` / `from_step_required` / `step_unrecognised` / " +
    "`leg_goes_nowhere` / `mode_unrecognised` / `trigger_required` / `proactive_leg_has_trigger` / `conversion_rate_required` / `reactive_pipe_from_lead_found`; 404 `channel_not_found` / " +
    "`trigger_not_found`; 409 `leg_exists` / `trigger_not_fired` (nothing fires that trigger yet). Byte passthrough to features-service POST /internal/catalogue/pipes.",
  security: platformAuth,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              channelSlug: z.string().openapi({ description: "The channel working the leg (GET /v1/catalogue/channels)" }),
              fromStep: z.string().nullable().openapi({ description: "The step the leg starts from (GET /v1/catalogue/steps); null = from Start (an entry leg, where a pipe on a trigger starts). Never `lead_found` for a reactive pipe (400 `reactive_pipe_from_lead_found`). Required, never defaulted" }),
              toStep: z.string().openapi({ description: "The step the leg leads to (GET /v1/catalogue/steps)" }),
              mode: z.string().openapi({ description: "`proactive` (own budget, no trigger) or `reactive` (runs when its trigger fires)" }),
              triggerId: z.string().optional().openapi({ description: "Reactive only: the trigger that asks for this pipe (GET /v1/catalogue/triggers)" }),
              conversionRatePct: z.number().optional().openapi({ description: "Share (0, 100] of people at fromStep who reach toStep, when no rate is known for that leg" }),
              published: z.boolean().optional().openapi({ description: "false = a draft (default true)" }),
              requestedByOrgId: z.string().nullable().optional().openapi({ description: "The org whose request led to this pipe, if any (provenance only: the pipe stays usable by every org)" }),
            })
            .passthrough()
            .openapi("CreatePipeRequest"),
        },
      },
    },
  },
  responses: {
    201: { description: "The pipe as created, pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CreatePipeResponse") } } },
    400: { description: "Invalid request, `reactive_pipe_from_lead_found` included (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff (`staff_only`)", content: errorContent },
    404: { description: "Unknown channel or trigger (forwarded verbatim)", content: errorContent },
    409: { description: "`leg_exists` / `trigger_not_fired` (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/catalogue/pipes/{pipeId}/retire",
  tags: ["Features"],
  summary: "Retire a pipe created by mistake (staff only)",
  description:
    "Takes a pipe out of the catalogue: it leaves every catalogue read (lists, sales paths, funnels to build). Use it for a pipe created " +
    "by mistake. Declaring the same leg again (POST /v1/catalogue/pipes) brings it back. Staff only: a distribute.you staff member's own " +
    "API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. `retiredBy` is recorded as the authenticated " +
    "staff email (a body value is replaced). Answers 200 `{object: \"pipe\", id, name, retired: true, retiredAt, retiredBy, note}`. " +
    "Refusals forwarded verbatim: 400 `note_invalid` (note over 500 characters); 404 `pipe_not_found`; 409 `pipe_coded` (the pipe is " +
    "stated in code, not in the catalogue store), `pipe_in_use` (a campaign of any org runs or ran it), `pipe_in_sales_funnel` (a declared " +
    "sales funnel names it); 502 `campaigns_unreadable` (could not check the campaigns, nothing retired). " +
    "Byte passthrough to features-service POST /internal/catalogue/pipes/{id}/retire.",
  security: platformAuth,
  request: {
    params: z.object({ pipeId: z.string().openapi({ description: "a pipe id `<channel slug>|<leg key>` (GET /v1/catalogue/pipes), URL-encoded (it carries `|`)" }) }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ note: z.string().max(500).nullable().optional().openapi({ description: "Why it is retired (500 characters at most)" }) })
            .passthrough()
            .openapi("RetirePipeRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "The retired pipe, pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RetirePipeResponse") } } },
    400: { description: "`note_invalid` (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff (`staff_only`)", content: errorContent },
    404: { description: "`pipe_not_found` (forwarded verbatim)", content: errorContent },
    409: { description: "`pipe_coded` / `pipe_in_use` / `pipe_in_sales_funnel` (forwarded verbatim)", content: errorContent },
    502: { description: "`campaigns_unreadable` or upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/catalogue/plays/{playId}/retire",
  tags: ["Features"],
  summary: "Retire a play from its pipe (staff only)",
  description:
    "Takes a non-default play off its pipe: the campaigns that ran it keep running on the pipe's default play, with no client action. " +
    "Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. " +
    "`retiredBy` is recorded as the authenticated staff email (a body value is replaced). Answers 200 `{changed, retiredPlayId, retiredAt, runsNow}` " +
    "(`runsNow` = the play those campaigns run from now on). Refusals forwarded verbatim: 400 `retiredBy_required` / `note_invalid`; " +
    "404 `pipe_not_found` / `play_not_found`; 409 `default_play_not_retirable` (set another default first with PUT /v1/catalogue/pipes/{pipeId}/default-play). " +
    "Byte passthrough to features-service POST /internal/catalogue/plays/{id}/retire.",
  security: platformAuth,
  request: {
    params: z.object({ playId: z.string().openapi({ description: "a play id `<pipe id>~<strategy id>` (GET /v1/catalogue/plays), URL-encoded (it carries `|` and `~`)" }) }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ note: z.string().max(500).nullable().optional().openapi({ description: "Why it is retired (500 characters at most)" }) })
            .passthrough()
            .openapi("RetirePlayRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Retire outcome, pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RetirePlayResponse") } } },
    400: { description: "`retiredBy_required` / `note_invalid` (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff (`staff_only`)", content: errorContent },
    404: { description: "`pipe_not_found` / `play_not_found` (forwarded verbatim)", content: errorContent },
    409: { description: "`default_play_not_retirable` (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/catalogue/sales-funnels",
  tags: ["Features"],
  summary: "Declare a sales funnel from its pipes",
  description:
    "Fleet-wide catalogue write, usable by every org. Any API key: a customer's own key may declare one from the pipes we run today " +
    "(lists from GET /v1/catalogue/pipes with that key show only those; a pipe we do not run is refused 400 `pipe_not_runnable`, naming it and why); a staff key, " +
    "or the platform key with a staff x-email, may use any pipe. `pipeIds` = one pipe id (GET /v1/catalogue/pipes) or play id " +
    "(`<pipe id>~<strategy id>`, GET /v1/catalogue/plays?pipe=) per leg of a sales path, in order, ONE channel per leg; a bare pipe id " +
    "runs its default play. Works for a reactive funnel too (e.g. Form submitted -> AI Instant Call -> Booking call -> your team). " +
    "Idempotent: 201 `created: true` when new, 200 `created: false` when already declared; either way the funnel detail (its id is what " +
    "POST /v1/sales-funnel-campaigns takes). `createdBy` is recorded as the authenticated caller (staff email, else your key's email; a body value is replaced), and for a customer key `requestedByOrgId` is the org the key acts in. " +
    "Refusals forwarded verbatim: 400 `pipe_ids_required` / `pipe_not_runnable` / `trigger_step_mismatch` / `trigger_without_step` / `bare_leg_refused` / `one_channel_per_leg` / `leg_without_channel` / " +
    "`funnel_invalid`; 404 `pipe_not_found` / `trigger_not_found`. Byte passthrough to features-service POST /internal/catalogue/sales-funnels.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              pipeIds: z.array(z.string()).openapi({ description: "One pipe or play id per leg of a sales path, in order" }),
              triggerId: z.string().optional().openapi({ description: "Optional: a trigger (GET /v1/catalogue/triggers) that heads the funnel. The first pipe must leave from the step that trigger starts from; this is how a proactive pipe is reused on a trigger" }),
              requestedByOrgId: z.string().nullable().optional().openapi({ description: "Staff only: the org whose request led to this funnel (provenance only: the funnel stays usable by every org). Set from your key for a customer" }),
            })
            .passthrough()
            .openapi("CreateSalesFunnelRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Already declared: the funnel, pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("SalesFunnelAlreadyDeclaredResponse") } } },
    201: { description: "Declared: the funnel, pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CreateSalesFunnelResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        404: { description: "Unknown pipe or play (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/catalogue/sales-paths",
  tags: ["Features"],
  summary: "Declare a sales path: the legs in order, optionally headed by a trigger",
  description:
    "Fleet-wide catalogue write, usable by every org. Any API key: a customer's own key may declare one only from legs some pipe we run today works " +
    "(a leg no running pipe works is refused 400 `leg_not_runnable`, naming it); a staff key, or the platform key with a staff x-email, may use any leg. A sales path is the chain of legs " +
    "a lead walks, from Start (or from a trigger's step) to Paid client, with no channel yet (GET /v1/catalogue/sales-paths lists the " +
    "existing ones; GET /v1/catalogue/steps the words). `legKeys` = the legs in order, each `<from step>_to_<to step>` and each worked by " +
    "some pipe (GET /v1/catalogue/pipes?legKeys=). `triggerId` (GET /v1/catalogue/triggers) puts a trigger at the head: the first leg " +
    "must leave from that trigger's step, so a reactive funnel reuses the proactive pipes. Next step: a sales funnel naming one pipe per " +
    "leg (POST /v1/catalogue/sales-funnels). Idempotent: 201 `created: true` when new, 200 `created: false` when it exists; either way " +
    "the path row (id, name, legs). `createdBy` is recorded as the authenticated caller (a body value is replaced). Refusals forwarded " +
    "verbatim: 400 `leg_keys_required` / `leg_not_runnable` / `path_invalid` / `trigger_step_mismatch` / `trigger_without_step`; 404 `trigger_not_found`. " +
    "Byte passthrough to features-service POST /internal/catalogue/sales-paths.",
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              legKeys: z.array(z.string()).openapi({ description: "The legs in order, e.g. [\"start_to_lead_found\", \"lead_found_to_conversation\", \"conversation_to_paid_client\"]" }),
              triggerId: z.string().optional().openapi({ description: "Optional: a trigger (GET /v1/catalogue/triggers) at the head; the first leg must leave from its step" }),
            })
            .passthrough()
            .openapi("CreateSalesPathRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Already declared: the path, pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("SalesPathAlreadyDeclaredResponse") } } },
    201: { description: "Declared: the path, pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CreateSalesPathResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff (platform key without a staff x-email)", content: errorContent },
    404: { description: "Unknown trigger (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});


registry.registerPath({
  method: "get",
  path: "/v1/catalogue/sales-funnels",
  tags: ["Features"],
  summary: "List catalogue sales funnels",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. A sales funnel is a sales path with one pipe per leg; its id is what POST /v1/sales-funnel-campaigns takes. With a customer key the list keeps only what we run today (`runnable=true` is forced; a staff key passes `runnable` as sent). " +
    "Byte passthrough to features-service GET /internal/catalogue/sales-funnels: one page of rows (id, name, icon, line, costUsd, roi, status, ...). Query string forwarded verbatim (documented today: paths, containsChannels, q, limit; not a whitelist); status and body owned by the downstream service.",
  security: authed,
  request: { query: z.object({ paths: z.string().optional().openapi({ description: "Comma list of sales path ids" }), containsChannels: z.string().optional().openapi({ description: "Comma list of channel slugs: funnels containing at least one" }), q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueSalesFunnelsListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/sales-funnels/{id}",
  tags: ["Features"],
  summary: "Read one catalogue sales funnel",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. A sales funnel is a sales path with one pipe per leg; its id is what POST /v1/sales-funnel-campaigns takes. " +
    "Byte passthrough to features-service GET /internal/catalogue/sales-funnels/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: authed,
  request: { params: z.object({ id: z.string().openapi({ description: "a sales funnel id" }) }), query: z.object({  }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueSalesFunnelsDetailResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
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
    "Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. Fleet-wide, no org scoping. " +
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
    "Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. Fleet-wide, no org scoping. " +
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
  path: "/v1/catalogue/triggers",
  tags: ["Features"],
  summary: "List catalogue triggers",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. A trigger is an entry door that starts a reactive funnel: an OUTCOME trigger (an outcome was just reached, the only kind callable from outside, through POST /v1/trigger-events) or a CONDITION trigger (computed by us: an outcome + a delay + still not another, or an integration state). New triggers are never created here: ask for one with a feature request. " +
    "Byte passthrough to features-service GET /internal/catalogue/triggers: one page of triggers, what starts a reactive pipe (id, name, icon, eventIcon, line, fromStep, firedBy, coded, pipeCount, ...). Query string forwarded verbatim (documented today: q, limit; not a whitelist); status and body owned by the downstream service.",
  security: authed,
  request: { query: z.object({ q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueTriggersListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/triggers/{id}",
  tags: ["Features"],
  summary: "Read one catalogue trigger",
  description:
    "Any API key: a customer's own key reads it too (a staff key, or the platform key with a staff x-email, as before). Fleet-wide, no org scoping. A trigger is an entry door that starts a reactive funnel: an OUTCOME trigger (an outcome was just reached, the only kind callable from outside, through POST /v1/trigger-events) or a CONDITION trigger (computed by us: an outcome + a delay + still not another, or an integration state). New triggers are never created here: ask for one with a feature request. " +
    "Byte passthrough to features-service GET /internal/catalogue/triggers/{id}: the trigger and the reactive pipes it starts. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: authed,
  request: { params: z.object({ id: z.string().openapi({ description: "a trigger id (e.g. positive_reply_received)" }) }), query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueTriggersDetailResponse") } } },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
        502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/tactics",
  tags: ["Features"],
  summary: "List catalogue tactics (staff only)",
  description:
    "Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. Fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/tactics: one page of tactics, the yes/no tags Jev puts on every workflow version (e.g. Catch-all). Query string forwarded verbatim (documented today: q, limit; not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueTacticsListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/tactics/{id}",
  tags: ["Features"],
  summary: "Read one catalogue tactic (staff only)",
  description:
    "Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. Fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/tactics/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ id: z.string().openapi({ description: "a tactic id" }) }), query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueTacticsDetailResponse") } } },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/strategies",
  tags: ["Features"],
  summary: "List catalogue strategies (staff only)",
  description:
    "Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. Fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/strategies: one page of strategies, the tactics a workflow must / must not follow (e.g. Valid only, Valid + Catch-all). Query string forwarded verbatim (documented today: q, limit; not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ q: z.string().optional(), limit: z.string().optional() }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueStrategiesListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/strategies/{id}",
  tags: ["Features"],
  summary: "Read one catalogue strategy (staff only)",
  description:
    "Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. Fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/strategies/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ id: z.string().openapi({ description: "a strategy id" }) }), query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CatalogueStrategiesDetailResponse") } } },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/plays",
  tags: ["Features"],
  summary: "List catalogue plays (staff only)",
  description:
    "Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. Fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/plays: the plays of one pipe, a pipe x a strategy with its ROI. Query string forwarded verbatim (documented today: pipe (a pipe id, e.g. sales-cold-email-outreach|lead_found_to_conversation), q, limit; not a whitelist); status and body owned by the downstream service.",
  security: platformAuth,
  request: { query: z.object({ q: z.string().optional(), limit: z.string().optional(), pipe: z.string().optional().openapi({ example: "sales-cold-email-outreach|lead_found_to_conversation" }) }).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CataloguePlaysListResponse") } } },
    400: { description: "Invalid filter (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalogue/plays/{id}",
  tags: ["Features"],
  summary: "Read one catalogue play (staff only)",
  description:
    "Staff only: a distribute.you staff member's own API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. Fleet-wide, no org scoping. " +
    "Byte passthrough to features-service GET /internal/catalogue/plays/{id}. Query string forwarded verbatim; status and body owned by the downstream service.",
  security: platformAuth,
  request: { params: z.object({ id: z.string().openapi({ description: "a play id (carries `|` and `~`; percent-encode `|` as %7C)" }) }), query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CataloguePlaysDetailResponse") } } },
    404: { description: "Unknown id (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
    503: { description: "Economics not computed yet (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/catalogue/steps",
  tags: ["Features"],
  summary: "Every catalogue step with its icon",
  description:
    "Byte passthrough to features-service GET /public/catalogue/steps: every catalogue step `{ key, name, icon }` (Phosphor icon name), unpaged, nothing economic. Query string forwarded verbatim. No authentication required.",
  request: { query: z.object({}).passthrough() },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicCatalogueStepsResponse") } } },
    502: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/public/catalogue/sales-funnels",
  tags: ["Features"],
  summary: "The sales funnels we can run today",
  description:
    "Byte passthrough to features-service GET /public/catalogue/sales-funnels: one page of runnable sales funnels (id, name, face, line, type, costUsd, costPer, roi, ...), ROI first; `runnable` is forced on by the producer. Query string forwarded verbatim (containsChannels, paths, q, limit). No authentication required.",
  request: {
    query: z
      .object({
        containsChannels: z.string().optional().openapi({ description: "Comma list of channel slugs: funnels containing at least one" }),
        paths: z.string().optional(),
        q: z.string().optional(),
        limit: z.string().optional().openapi({ description: "1..25, default 10" }),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "Pass-through from the downstream service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PublicSalesFunnelsResponse") } } },
    400: { description: "Invalid query (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
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
  path: "/v1/email-sequences",
  tags: ["Conversations"],
  summary: "Every email we run for a brand, sent, bounced or queued, per prospect",
  description:
    "Pass-through to instantly-service GET /orgs/email-sequences. One row per sequence (a prospect " +
    "emailed again after the re-contact window has two): `leadId`, `leadEmail`, `campaignId` and " +
    "`steps[]`, each `{ step, kind: first_email|follow_up, status: sent|bounced|queued|stopped, sentAt, bouncedAt }`. " +
    "`sent` = it went out at `sentAt`; `bounced` = it went out at `sentAt` and the receiving server refused " +
    "it at `bouncedAt` (it was NOT delivered); `queued` = not sent yet, it goes out in the prospect's business " +
    "hours; `stopped` = it will not go out (reply, bounce, opt-out, meeting booked, or sequence stopped). " +
    "Join with the email bodies of GET /v1/emails?brandId= on `leadId`. Paged: pass `nextCursor` back as " +
    "`cursor` until it is null (default 500, max 2000 per page). A brand that is not one of the " +
    "authenticated org's brands is a 404 `brand_not_in_org`. The whole query string is forwarded " +
    "verbatim; the parameters listed here are the ones documented today, not a whitelist. Declares no " +
    "cost.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().openapi({ description: "The brand (uuid) whose email sequences to list" }),
      limit: z.string().optional().openapi({ description: "Sequences per page (downstream default 500, max 2000)" }),
      cursor: z.string().optional().openapi({ description: "The previous page's `nextCursor`, verbatim" }),
    }).passthrough(),
  },
  responses: {
    200: {
      description: "One page of email sequences as returned by instantly-service",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("EmailSequencesResponse") } },
    },
    400: { description: "Missing or invalid query parameters", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "The brand is not one of this organization's brands — `code: brand_not_in_org`", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

const EMAIL_SIGNATURE_RULES =
  "Every email we send for a brand ends with a signature. By default it is ours: the sending " +
  "mailbox's name, then `Distribute.you | Marketing Agency` (`signature: null`). Set your own and it " +
  "replaces ours on every NEW email thread of the brand: the email itself (a cold email, or an email you " +
  "pushed through the API with the `email_pushed_via_api` trigger), every follow-up, and every reply we " +
  "send in that thread, AI replies included. A thread keeps the signature it started with: changing or " +
  "resetting yours applies to new threads only, so a conversation never switches signature halfway. ";
const EMAIL_SIGNATURE_TAIL =
  "A brand that is not one of the authenticated org's brands is a 404 `brand_not_in_org`. Pass-through " +
  "to instantly-service /orgs/email-signature; upstream errors are forwarded field-for-field. Declares no cost.";
const EmailSignatureResponse = z.object({}).passthrough().openapi("EmailSignatureResponse", {
  description: "`{ brandId, signature, updatedAt }`: `signature` is your text, or null when the brand uses our default signature.",
});
const emailSignatureBrandQuery = z.object({
  brandId: z.string().openapi({ description: "The brand (uuid) the signature is for" }),
}).passthrough();

registry.registerPath({
  method: "get",
  path: "/v1/email-signature",
  tags: ["Conversations"],
  summary: "Get my email signature: the signature at the bottom of a brand's emails",
  description: "Read the email signature of a brand. " + EMAIL_SIGNATURE_RULES + EMAIL_SIGNATURE_TAIL,
  security: authed,
  request: { query: emailSignatureBrandQuery },
  responses: {
    200: { description: "The brand's signature (null = our default)", content: { "application/json": { schema: EmailSignatureResponse } } },
    400: { description: "Missing brandId", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "The brand is not one of this organization's brands — `code: brand_not_in_org`", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/email-signature",
  tags: ["Conversations"],
  summary: "Change my email signature: replace our default signature with yours for a brand",
  description:
    "Set your own email signature for a brand, replacing ours. Idempotent: setting it again overwrites it. " +
    EMAIL_SIGNATURE_RULES +
    "Plain text, one line per line (`\\n` between lines), at most 1,000 characters and 12 lines; HTML is shown " +
    "as written; leave out the `--` line, it is added above the signature automatically. A signature that breaks " +
    "a rule is a 400 with a readable reason. An email sent for several brands at once uses the signature they " +
    "share; two different signatures make that send refused. " + EMAIL_SIGNATURE_TAIL,
  security: authed,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            brandId: z.string().openapi({ description: "The brand (uuid) the signature is for" }),
            signature: z.string().openapi({
              description:
                "Your signature as plain text, `\\n` between lines, at most 1,000 characters and 12 lines, no `--` line. Example: `Jane Doe\\nHead of Sales, Acme\\nacme.com`.",
            }),
          }).passthrough().openapi("SetEmailSignatureRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Saved: new threads of this brand end with it", content: { "application/json": { schema: EmailSignatureResponse } } },
    400: { description: "Missing brandId, or a signature that is empty, too long, has too many lines, or contains a `--` line", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "The brand is not one of this organization's brands — `code: brand_not_in_org`", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/email-signature",
  tags: ["Conversations"],
  summary: "Reset my email signature to the default: remove yours, our signature is used again",
  description:
    "Remove your email signature for a brand: new threads end with our default signature again. Idempotent. " +
    EMAIL_SIGNATURE_RULES + EMAIL_SIGNATURE_TAIL,
  security: authed,
  request: { query: emailSignatureBrandQuery },
  responses: {
    200: { description: "Removed: `signature: null`, our default is used on new threads", content: { "application/json": { schema: EmailSignatureResponse } } },
    400: { description: "Missing brandId", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "The brand is not one of this organization's brands — `code: brand_not_in_org`", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/followup-cuts",
  tags: ["Conversations"],
  summary: "Stop the queued follow-ups of named leads a campaign emailed in error",
  description:
    "Pass-through to instantly-service POST /orgs/followup-cuts. For leads a campaign should never " +
    "have written to (a sourcing mistake): the rest of their sequence will not go out. Every other lead " +
    "of the campaign keeps its follow-ups. Body `{ campaignId, leadEmails[], reason }`. Not an opt-out: " +
    "nothing is recorded as unsubscribe or suppression. All or nothing on names: an email the campaign " +
    "never wrote to is a 404 `leads_not_in_campaign` and nothing is cut. Idempotent (`already_cut`). " +
    "Audited: who, when, why (GET /v1/followup-cuts). A lead that could not be cut answers 502.",
  security: authed,
  request: {
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("FollowupCutsRequest") } } },
  },
  responses: {
    200: {
      description: "Per-lead outcome as returned by instantly-service",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("FollowupCutsResponse") } },
    },
    400: { description: "Invalid body", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "A named email has no sequence in this campaign — `code: leads_not_in_campaign`", content: errorContent },
    502: { description: "At least one lead could not be cut", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/followup-cuts",
  tags: ["Conversations"],
  summary: "The follow-up cuts of a campaign (who, when, why)",
  description:
    "Pass-through to instantly-service GET /orgs/followup-cuts. Every lead whose follow-ups were cut in " +
    "this campaign, with who cut, when, why and the queued steps refunded. Query forwarded verbatim.",
  security: authed,
  request: {
    query: z.object({
      campaignId: z.string().openapi({ description: "The campaign whose cuts to list" }),
    }).passthrough(),
  },
  responses: {
    200: {
      description: "Cuts as returned by instantly-service",
      content: { "application/json": { schema: z.object({}).passthrough().openapi("FollowupCutsListResponse") } },
    },
    400: { description: "Missing or invalid query parameters", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
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
    + "on the current period, optionally narrowed to one account / mailbox / domain or split per one (`groupBy`). "
    + "The query string is forwarded verbatim; the parameters below are the ones "
    + "instantly-service documents today, not a whitelist. `grain` is REQUIRED downstream — omitting it "
    + "answers instantly-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      grain: z.string().describe("REQUIRED downstream. day | week | month (UTC; a week starts Monday)"),
      since: z.string().optional().describe("ISO timestamp; the series starts at the period containing it"),
      account: z.string().optional().describe("Sending address: only its sends"),
      mailbox: z.string().optional().describe("Real mailbox login: only its sends"),
      domain: z.string().optional().describe("Sending domain: only its sends"),
      groupBy: z.string().optional().describe("Split each period per account | mailbox | domain"),
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

const MAILBOX_MONITORING_INTRO =
  "Platform-scoped staff read over instantly-service's sending infra (cross-org ops data, NOT customer data). "
  + "Powers dashboard v2 Monitoring > Emails: health per account, mailbox and domain. Staff-only (platform API "
  + "key + STAFF_EMAILS x-email); no org context. ";

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/placement-tests",
  tags: ["Instantly"],
  summary: "List inbox placement tests, newest first (staff only)",
  description:
    MAILBOX_MONITORING_INTRO
    + "Transparent byte passthrough to instantly-service GET /internal/ops/placement-tests: one row per placement test, optionally narrowed to one account / mailbox / domain. "
    + "The query string is forwarded verbatim; the parameters below are the ones instantly-service documents "
    + "today, not a whitelist. A bad value answers instantly-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      account: z.string().optional().describe("Sending address"),
      mailbox: z.string().optional().describe("Real mailbox login"),
      domain: z.string().optional().describe("Sending domain"),
      limit: z.string().optional().describe("Page size; instantly-service owns the default and bounds"),
      cursor: z.string().optional().describe("Opaque, from the previous page's nextCursor"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsPlacementTestsResponse") } } },
    400: { description: "Downstream rejected the query", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/capacity-daily",
  tags: ["Instantly"],
  summary: "Get sending capacity per day, past and future, with the ramp plan (staff only)",
  description:
    MAILBOX_MONITORING_INTRO
    + "Transparent byte passthrough to instantly-service GET /internal/ops/capacity-daily: capacity per day (measured past, projected future) and the ramp plan, fleet-wide or per account / mailbox / domain. "
    + "The query string is forwarded verbatim; the parameters below are the ones instantly-service documents "
    + "today, not a whitelist. A bad value answers instantly-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      account: z.string().optional().describe("Sending address"),
      mailbox: z.string().optional().describe("Real mailbox login"),
      domain: z.string().optional().describe("Sending domain"),
      horizonDays: z.string().optional().describe("Days ahead; instantly-service owns the default and bounds"),
      groupBy: z.string().optional().describe("Split each day per account | mailbox | domain"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsCapacityDailyResponse") } } },
    400: { description: "Downstream rejected the query", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/schedule",
  tags: ["Instantly"],
  summary: "Get what is planned per day from today: warmups, placement tests, queued steps (staff only)",
  description:
    MAILBOX_MONITORING_INTRO
    + "Transparent byte passthrough to instantly-service GET /internal/ops/schedule: per day from today, the planned warmups, planned placement tests and queued sequence steps at their theoretical date. "
    + "The query string is forwarded verbatim; the parameters below are the ones instantly-service documents "
    + "today, not a whitelist. A bad value answers instantly-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      account: z.string().optional().describe("Sending address"),
      mailbox: z.string().optional().describe("Real mailbox login"),
      domain: z.string().optional().describe("Sending domain"),
      horizonDays: z.string().optional().describe("Days ahead; instantly-service owns the default and bounds"),
      groupBy: z.string().optional().describe("Split each day per account | mailbox | domain"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsScheduleResponse") } } },
    400: { description: "Downstream rejected the query", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/queued-steps",
  tags: ["Instantly"],
  summary: "List queued sequence steps with their theoretical send date (staff only)",
  description:
    MAILBOX_MONITORING_INTRO
    + "Transparent byte passthrough to instantly-service GET /internal/ops/queued-steps: one row per queued sequence step with its theoretical send date. "
    + "The query string is forwarded verbatim; the parameters below are the ones instantly-service documents "
    + "today, not a whitelist. A bad value answers instantly-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      account: z.string().optional().describe("Sending address"),
      mailbox: z.string().optional().describe("Real mailbox login"),
      domain: z.string().optional().describe("Sending domain"),
      limit: z.string().optional().describe("Page size; instantly-service owns the default and bounds"),
      cursor: z.string().optional().describe("Opaque, from the previous page's nextCursor"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsQueuedStepsResponse") } } },
    400: { description: "Downstream rejected the query", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/placement-alerts",
  tags: ["Instantly"],
  summary: "Get inbox-placement alert evaluations per provider and the alerts fired (staff only)",
  description:
    MAILBOX_MONITORING_INTRO
    + "Transparent byte passthrough to instantly-service GET /internal/ops/placement-alerts: the inbox-placement alert evaluations per inbox provider and the alerts that fired. "
    + "The query string is forwarded verbatim; the parameters below are the ones instantly-service documents "
    + "today, not a whitelist. A bad value answers instantly-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({}).passthrough(),
  },
  responses: {
    200: { description: "Pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsPlacementAlertsResponse") } } },
    400: { description: "Downstream rejected the query", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/placement-tests/{testId}",
  tags: ["Instantly"],
  summary: "Get one inbox placement test: each seed and where it landed per provider (staff only)",
  description:
    MAILBOX_MONITORING_INTRO
    + "Transparent byte passthrough to instantly-service GET /internal/ops/placement-tests/{testId}: one test, "
    + "each seed and where it landed per inbox provider. The id carries a colon (`seed:<uuid>`) and is "
    + "URL-encoded on the way down. An unknown id answers the downstream's own 404. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    params: z.object({
      testId: z.string().describe("The test id from GET /v1/instantly/ops/placement-tests (e.g. seed:<uuid>)"),
    }),
  },
  responses: {
    200: { description: "Placement test — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsPlacementTestResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "No placement test with that id", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

const DOMAIN_BLOCKLIST_INTRO =
  "Platform-scoped staff surface over instantly-service's sending-domain blocklist monitor "
  + "(SURBL multi, Spamhaus DBL, URIBL; cross-org ops data, NOT customer data) — powers the staff "
  + "blocklist page on admin.distribute.you. Staff-only (platform API key + STAFF_EMAILS x-email); no org context. ";

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/domain-blocklist",
  tags: ["Instantly"],
  summary: "Get the sending-domain blocklist state, event history and daily series (staff only)",
  description:
    DOMAIN_BLOCKLIST_INTRO
    + "Transparent byte passthrough to instantly-service GET /internal/domain-blocklist: the current state per "
    + "domain and list, which mailboxes are out of new sequences, the append-only event history and one point per "
    + "day of the window. The query string is forwarded verbatim; `days` is the parameter instantly-service "
    + "documents today, not a whitelist. A bad `days` answers instantly-service's own 400. Response owned by the "
    + "downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      days: z.string().optional().describe("Window in days, 1..365; instantly-service defaults to 60"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Blocklist read — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsDomainBlocklistResponse") } } },
    400: { description: "Downstream rejected `days`", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/instantly/ops/domain-blocklist/check",
  tags: ["Instantly"],
  summary: "Run the sending-domain blocklist check now (staff only)",
  description:
    DOMAIN_BLOCKLIST_INTRO
    + "Transparent byte passthrough to instantly-service POST /internal/domain-blocklist/check: checks every "
    + "sending domain on every list, records state and events, then delivers pending staff alerts (the daily "
    + "worker runs the same check). Idempotent. Response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "What the check found — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsDomainBlocklistCheckResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/instantly/ops/domain-blocklist/removal-requests",
  tags: ["Instantly"],
  summary: "Record a blocklist removal request a person filed on the list's form (staff only)",
  description:
    DOMAIN_BLOCKLIST_INTRO
    + "Transparent byte passthrough to instantly-service POST /internal/domain-blocklist/removal-requests: "
    + "appends a `removal_requested` event (we never file the forms ourselves). The body is forwarded unchanged; "
    + "the fields below are the ones instantly-service documents today. A missing domain or unknown list answers "
    + "instantly-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            domain: z.string().describe("The sending domain the request was filed for"),
            list: z.string().describe("surbl | spamhaus_dbl | uribl"),
            note: z.string().optional(),
            requestedBy: z.string().optional().describe("Who filed it"),
          }).passthrough().openapi("InstantlyOpsDomainBlocklistRemovalRequest"),
        },
      },
    },
  },
  responses: {
    201: { description: "Recorded — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsDomainBlocklistRemovalResponse") } } },
    400: { description: "Downstream rejected the body (missing domain or unknown list)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

const LEAD_SOURCE_YIELD_INTRO =
  "Platform-scoped staff surface over instantly-service's lead-source yield (cross-org ops data, NOT customer "
  + "data): which lead source feeds our sending domains bounces, refusals and blocklist hits. Powers the staff "
  + "Blocklists page on admin.distribute.you. Staff-only (platform API key + STAFF_EMAILS x-email); no org context. ";

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/lead-source-yield",
  tags: ["Instantly"],
  summary: "Get lead sources ranked by the bounces, refusals and blocklist hits their people produce (staff only)",
  description:
    LEAD_SOURCE_YIELD_INTRO
    + "Transparent byte passthrough to instantly-service GET /internal/lead-source-yield (its schema "
    + "LeadSourceYieldRead): the ranking since inception plus one point per day of the window. The query string "
    + "is forwarded verbatim; `days` is the parameter instantly-service documents today, not a whitelist. A bad "
    + "`days` answers instantly-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      days: z.string().optional().describe("Series window in days, 1..365; instantly-service defaults to 60"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Lead-source yield — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsLeadSourceYieldResponse") } } },
    400: { description: "Downstream rejected `days`", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/instantly/ops/lead-source-yield/sync",
  tags: ["Instantly"],
  summary: "Copy lead-service's provenance for the people we emailed, now (staff only)",
  description:
    LEAD_SOURCE_YIELD_INTRO
    + "Transparent byte passthrough to instantly-service POST /internal/lead-source-yield/sync: one provenance "
    + "pass (the worker runs it every 30 min), then the yield cache is cleared. Response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Pass summary — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsLeadSourceYieldSyncResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

const DELIVERABILITY_INTRO =
  "Platform-scoped staff surface over instantly-service's deliverability monitors (cross-org ops data, NOT "
  + "customer data). Powers the staff deliverability charts on admin.distribute.you. Staff-only (platform API "
  + "key + STAFF_EMAILS x-email); no org context. ";

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/seed-placement/daily",
  tags: ["Instantly"],
  summary: "Get seed inbox placement per day at Google, Microsoft 365 and Outlook.com (staff only)",
  description:
    DELIVERABILITY_INTRO
    + "Transparent byte passthrough to instantly-service GET /internal/seed-placement/daily (the stored "
    + "seed_placement_daily series). The query string is forwarded verbatim. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({}).passthrough(),
  },
  responses: {
    200: { description: "Seed placement series — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsSeedPlacementDailyResponse") } } },
    400: { description: "Downstream rejected the query", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

const WHATSAPP_LINES_INTRO =
  "Platform-scoped staff surface over crm-service's WhatsApp line watch (cross-org ops data, NOT customer data). "
  + "Powers the WhatsApp section of dashboard v2 Monitoring: one row per linked line per day, red when the line "
  + "is down. Staff-only (platform API key + STAFF_EMAILS x-email); no org context. ";

registry.registerPath({
  method: "get",
  path: "/v1/crm/ops/whatsapp-lines",
  tags: ["CRM Ops"],
  summary: "Get every linked WhatsApp line's connection state, now and per day (staff only)",
  description:
    WHATSAPP_LINES_INTRO
    + "Transparent byte passthrough to crm-service GET /internal/ops/whatsapp-lines. The query string is forwarded "
    + "verbatim; a bad `days` answers crm-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      days: z.string().optional().describe("Series window in days; crm-service owns the default (30) and bounds (1..90)"),
    }).passthrough(),
  },
  responses: {
    200: { description: "WhatsApp line health — pass-through from crm-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CrmOpsWhatsappLinesResponse") } } },
    400: { description: "Downstream rejected `days`", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/crm/ops/whatsapp-lines/check",
  tags: ["CRM Ops"],
  summary: "Run one WhatsApp line watch pass now (staff only)",
  description:
    WHATSAPP_LINES_INTRO
    + "Transparent byte passthrough to crm-service POST /internal/ops/whatsapp-lines/check (the in-process loop "
    + "runs it every 2 min). Response owned by the downstream service.",
  security: platformAuth,
  responses: {
    200: { description: "Pass summary — pass-through from crm-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("CrmOpsWhatsappLinesCheckResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/instantly/ops/sender-health",
  tags: ["Instantly"],
  summary: "Get the mailboxes kept out of prospect mail per day, and why (staff only)",
  description:
    DELIVERABILITY_INTRO
    + "Transparent byte passthrough to instantly-service GET /internal/sender-health (the stored "
    + "sender_health_daily series plus the latest tick's lists). The query string is forwarded verbatim; a bad "
    + "`days` answers instantly-service's own 400. Response owned by the downstream service.",
  security: platformAuth,
  request: {
    query: z.object({
      days: z.string().optional().describe("Series window in days; instantly-service owns the default and bounds"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Sender health — pass-through from instantly-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("InstantlyOpsSenderHealthResponse") } } },
    400: { description: "Downstream rejected `days`", content: errorContent },
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

// Brand budget params. The per-campaign daily-budget routes (GET /campaign-budgets, GET|PUT
// /campaign-budget, the offer-level /campaign-budgets, PATCH /campaigns/daily-budget) were REMOVED
// 2026-10-14: a campaign's money is its sales funnel caps (below). Do not re-add them.
const BrandBudgetParam = z.object({
  brandId: z.string().uuid().describe("Brand ID"),
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

// Sales funnel caps (proxy to billing-service, same paths): MAX BUDGET + MAX VOLUME of a sales funnel
// campaign and what it consumed this period. billing owns the body, periods and refusal codes (#4/#8).
const SalesFunnelCapsParams = z.object({
  brandId: z.string().describe("Brand ID"),
  offerId: z.string().describe("Offer ID"),
  salesFunnelId: z.string().describe("features-service sales funnel id (its combinationKey), URL-encoded"),
});
const SalesFunnelCapsRequestSchema = z.object({}).passthrough().openapi("SalesFunnelCapsRequest");
const SalesFunnelCapsResponseSchema = z.object({}).passthrough().openapi("SalesFunnelCapsResponse");
const salesFunnelCapsResponses = {
  200: { description: "Billing's read (caps, consumed, remaining, reached), forwarded untouched", content: { "application/json": { schema: SalesFunnelCapsResponseSchema } } },
  400: { description: "Invalid ids or body, forwarded verbatim", content: errorContent },
  404: { description: "sales_funnel_not_found, forwarded verbatim", content: errorContent },
  502: { description: "sales_funnel_catalogue_unavailable, forwarded verbatim", content: errorContent },
};
const salesFunnelCapsPath = "/v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps";

registry.registerPath({
  method: "get",
  path: salesFunnelCapsPath,
  tags: ["Billing"],
  summary: "Read a sales funnel's max budget + max volume and what it consumed this period",
  description: "Proxy to billing-service GET " + salesFunnelCapsPath + ". `reached` is the stop verdict; a consumption billing cannot measure is null with a named reason.",
  security: authed,
  request: { params: SalesFunnelCapsParams },
  responses: salesFunnelCapsResponses,
});

registry.registerPath({
  method: "put",
  path: salesFunnelCapsPath,
  tags: ["Billing"],
  summary: "State a sales funnel's MAX BUDGET and MAX VOLUME",
  description:
    "Proxy to billing-service PUT " + salesFunnelCapsPath + ". Body { maxBudget: {amountCents, period} | null, maxVolume: {count, period} | null }, " +
    "period one_off | daily | weekly | monthly, forwarded untouched. Charges nothing. Answers the read's shape.",
  security: authed,
  request: { params: SalesFunnelCapsParams, body: { content: { "application/json": { schema: SalesFunnelCapsRequestSchema } } } },
  responses: salesFunnelCapsResponses,
});

registry.registerPath({
  method: "delete",
  path: salesFunnelCapsPath,
  tags: ["Billing"],
  summary: "Clear both caps of a sales funnel",
  description: "Proxy to billing-service DELETE " + salesFunnelCapsPath + " (idempotent).",
  security: authed,
  request: { params: SalesFunnelCapsParams },
  responses: salesFunnelCapsResponses,
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/sales-funnel-caps",
  tags: ["Billing"],
  summary: "Every sales funnel of this brand with a stated cap",
  description: "Proxy to billing-service GET /v1/brands/{brandId}/sales-funnel-caps. Query forwarded verbatim (documented today: offerId).",
  security: authed,
  request: {
    params: z.object({ brandId: z.string().describe("Brand ID") }),
    query: z.object({ offerId: z.string().optional() }).passthrough(),
  },
  responses: salesFunnelCapsResponses,
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
    metadata: z.record(z.string(), z.unknown()).optional().describe("Template variables for {{variable}} interpolation"),
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
    "List all generated emails across campaigns for a brand: the lead each was written for and the subject and body of " +
    "every step. Returns the same shape as GET /campaigns/{id}/emails. " +
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
      description: "Generated emails",
      content: {
        "application/json": {
          schema: z
            .object({
              emails: z.array(GeneratedEmailSchema),
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
    "Proxies content-generation-service GET /generations/by-lead/{leadId} and returns the GeneratedEmail view of the row. " +
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
      description: "The lead's generated email, or null if none exists yet",
      content: {
        "application/json": {
          // Constructed shape (security hotfix 2026-10-12): the customer allowlist, src/lib/customer-email-view.ts.
          schema: z
            .object({ generation: GeneratedEmailSchema.nullable() })
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
    metadata: z.record(z.string(), z.string()).optional().describe("Arbitrary key-value metadata"),
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
    metadata: z.record(z.string(), z.string()).optional().describe("Metadata for the checkout session"),
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
            metadata: z.record(z.string(), z.string()).describe("Product metadata"),
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
    // zod 4 lets an outer .optional() fall through to an inner .default(), which would
    // inject layout into the forwarded body; documented default only, as in zod 3.
    layout: z.enum(["quote-top", "webcam-top"]).optional().openapi({ default: "quote-top" }).describe("Video layout variant"),
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
  security: platformAuth, // STAFF ONLY (requireStaff): prompts are platform-wide IP
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
  security: platformAuth, // STAFF ONLY (requireStaff): prompts are platform-wide IP
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
  security: platformAuth, // STAFF ONLY (requireStaff): prompts are platform-wide IP
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
            prefilled: z.record(z.string(), z.unknown()),
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
  path: "/v1/offers/{offerId}/spend-charts",
  tags: ["Features"],
  summary: "Daily spend and convergence chart of one offer",
  description:
    "Why a day costs what it costs and whether it is converging, for one offer: one point per UTC day since its first activity, " +
    "with the measured cost per outcome (served while Learning, flagged), the conversion by entry cohort (recent cohorts flagged " +
    "not mature), the Learning flag, what the day's spend bought per action and the expected values. " +
    "Proxied to features-service GET /offers/{offerId}/spend-charts. " +
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
    200: { description: "Offer spend charts", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferSpendChartsResponse") } } },
    400: { description: "brand_id_required or pricing_unrecognised, forwarded verbatim", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "brand_not_found or offer_has_no_campaigns, forwarded verbatim", content: errorContent },
    502: { description: "A spend or people read failed, forwarded verbatim", content: errorContent },
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
  path: "/v1/offers/{offerId}/sales-funnels",
  tags: ["Features"],
  summary: "The sales funnels we can run today, priced for one offer",
  description:
    "Proxied to features-service GET /internal/catalogue/sales-funnels?offerId={offerId}&runnable=true with the authenticated org: one page of runnable sales funnels (id, name, face, line, type, costUsd, costPer, roi, status, ...), ROI first, each priced on THIS offer's own client value and rates (an `offer` block names them). " +
    "The rest of the query is forwarded verbatim (documented today: brandId, required downstream; q; containsChannels; paths; limit; not a whitelist); refusals come back as served (400 brand_required, 404 offer_not_found).",
  security: authed,
  request: {
    params: z.object({ offerId: z.string().openapi({ example: "offer-uuid-123" }).describe("Offer UUID") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required) — an offer belongs to a brand"),
      q: z.string().optional().describe("Text search: every word must appear in the funnel's name, line or id (e.g. `ai-meeting-booking~valid-catch-all` to find funnels running that play)"),
      containsChannels: z.string().optional().describe("Comma list of channel slugs: funnels containing at least one"),
      paths: z.string().optional().describe("Comma list of sales path ids (default: every path)"),
      limit: z.string().optional().describe("1..25, default 10"),
    }).passthrough(),
  },
  responses: {
    200: { description: "One page of runnable funnels priced for the offer", content: { "application/json": { schema: z.object({}).passthrough().openapi("OfferSalesFunnelsResponse") } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Offer not found", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
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
  path: "/v1/features/orgs/leads/{leadId}/written-by",
  tags: ["Features"],
  summary: "Who wrote the messages sent to one lead",
  description:
    "For one person of the caller's org: on every message we sent on the org's behalf, which LLM wrote it (public name + vendor) " +
    "and the plain lines of the tactics of the workflow version that wrote it, marked as being tested. " +
    "Proxied to features-service GET /orgs/leads/{leadId}/written-by; the org is the authenticated one and the query is forwarded verbatim.",
  security: authed,
  request: {
    params: z.object({ leadId: z.string().openapi({ example: "lead-uuid-123" }).describe("Lead id") }),
    query: z.object({
      campaignId: z.string().optional().describe("Narrow to one campaign"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Written-by entries", content: { "application/json": { schema: z.object({}).passthrough().openapi("WrittenByResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Lead not found", content: errorContent },
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
  path: "/v1/brands/{brandId}/lived-sales-paths",
  tags: ["Features"],
  summary: "Brand lived sales paths: which way paid clients actually came, with cost, revenue and ROI",
  description:
    "The sales paths the brand's people ACTUALLY lived (e.g. video -> website visit -> signup -> paid; cold email -> positive reply -> paid), " +
    "built from lead-service's timeline: per path the leads, paid clients, revenue, cost and ROI, ranked overall and per sales funnel campaign, " +
    "beside the EXPECTED economics of the same catalogue path (planned vs lived). Since inception. Answers 'which way did paid clients come' " +
    "and 'lived sales path ROI ranking'. Response shape: features-service component LivedSalesPaths. " +
    "Proxied to features-service GET /brands/{brandId}/lived-sales-paths. " +
    "The gateway forwards EVERY query param verbatim — the params below are documentation, not a closed list.",
  security: authed,
  request: {
    params: z.object({ brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID") }),
    query: z.object({
      offerId: z.string().optional().describe("Only this offer's people, and the spend of the campaigns that sell it. Omitted: every offer"),
      pricing: z.enum(["gross", "net"]).optional().describe("Pricing basis for every money figure (omitted = gross)"),
    }).passthrough(),
  },
  responses: {
    200: { description: "Brand lived sales paths (features-service LivedSalesPaths)", content: { "application/json": { schema: z.object({}).passthrough().openapi("BrandLivedSalesPathsResponse") } } },
    400: { description: "Invalid pricing value (pricing_unrecognised)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "The caller does not hold this brand (brand_not_found)", content: errorContent },
    500: { description: "Internal error", content: errorContent },
    502: { description: "A source could not be read (lived_sales_paths_unavailable)", content: errorContent },
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

const CrmServeStatsQuery = CrmBrandIdQuery.extend({
  pool: z.enum(["csv", "people"]).optional().openapi({ description: "csv (default: imported CRM files) or people (the brand's merged CRM people)" }),
  segment: z
    .string()
    .optional()
    .openapi({
      description:
        'pool=people only. URL-encoded JSON CRM segment: {"dealStages":[{"pipeline":"Sales Pipeline","stage":"Form Filled - No Appointment"}],"dealStatuses":["open"],"tags":["vip"],"reached":["form_submission"],"notReached":["sale"]}. Names come from GET /v1/orgs/contacts/segments.',
    }),
  reachableBy: z.string().optional().openapi({ description: "phone, email, or both (comma-separated)" }),
  uploadIds: z.string().optional().openapi({ description: "pool=csv only. Repeated or comma-separated upload ids" }),
}).passthrough();

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
  params?: z.ZodObject;
  query?: z.ZodObject;
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
    method: "get",
    path: "/v1/orgs/google/calendar/accounts",
    summary: "List the org's connected Google Calendars",
    description:
      "Proxy to google-service GET /orgs/google/calendar/accounts. Response `{ calendars: [...] }` owned by google-service. Connect one with POST /v1/orgs/google/auth/start and body `{ connection: \"calendar\" }`.",
  },
  {
    method: "delete",
    path: "/v1/orgs/google/calendar/accounts/{email}",
    summary: "Disconnect a Google Calendar",
    description:
      "Proxy to google-service DELETE /orgs/google/calendar/accounts/{email}. Revokes the calendar grant; returns `{ disconnected, email, grant }`. The email is URL-encoded in the path. 404 `{ reason: \"calendar_not_found\" }` and 502 `{ reason: \"google_revoke_failed\" }` forwarded verbatim.",
    params: z.object({ email: z.string().openapi({ description: "Connected Google Calendar account email (URL-encoded)" }) }),
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
  method: "post",
  path: "/v1/orgs/contacts",
  tags: ["CRM Contacts"],
  summary: "Add one person to my CRM (one contact, email optional)",
  description:
    "Add ONE person you know to a brand's CRM contacts, by JSON: the way to put a specific prospect (a name you were given, " +
    "someone met at an event, a LinkedIn profile) in front of your campaigns without a CSV. Give `brandId` and at least one of: " +
    "an `email`, a `linkedinUrl` (linkedin.com profile), or a name (`fullName`, or `firstName` + `lastName`) WITH a company " +
    "(`companyName` or `companyDomain`). Optional: `phone`, `jobTitle`, `note` (what you know about the person, up to 5000 characters). " +
    "The email is OPTIONAL: a contact with an email can be written to at once; a contact without one is looked up only when a " +
    "campaign serves it (no lookup, no cost at add time), and its `emailStatus` reads `unknown` until then (`not_found` if the lookup found none). " +
    "Adding the same person twice (same email or same LinkedIn) returns the SAME contact with the new details merged in (200, `created: false`, `matchedOn`); " +
    "a new person answers 201. The person joins the brand's list \"Contacts added one by one\" (GET /v1/orgs/contacts/uploads, `kind: manual`). " +
    "Proxy to crm-service POST /orgs/contacts; status and body piped byte-identical, refusals forwarded verbatim " +
    "(400 `type: validation` for a bad field, 400 `type: not_enough_to_find` when the person cannot be identified). Requires a user (x-user-id).",
  security: authed,
  request: { body: { content: { "application/json": { schema: CrmPassthroughRequest } } } },
  responses: {
    200: { description: "Person already in the CRM: same contact, new details merged (crm-service { contactId, created: false, matchedOn, emailStatus, contact })", content: { "application/json": { schema: CrmPassthroughResponse } } },
    201: { description: "Contact created (crm-service { contactId, created: true, matchedOn: null, emailStatus, contact })", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/contacts",
  tags: ["CRM Contacts"],
  summary: "List silver contacts for a brand",
  description:
    "Proxy to crm-service GET /orgs/contacts. Each contact carries its company (`companyName`, `companyDomain`), `jobTitle`, `linkedinUrl`, `note` and `emailStatus` (`known` | `unknown` | `not_found`) when crm-service holds them. The whole query string is forwarded untransformed. Response shape owned by crm-service.",
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
    "Proxy to crm-service GET /orgs/contacts/serve-stats. The whole query string is forwarded untransformed, including a repeated or comma-separated `uploadIds` per-file scope. With `pool=people`, a `segment` (URL-encoded JSON, same shape as serve-next `people.segment`: dealStages, dealStatuses, tags, reached, notReached, includeClients, includeOptedOut) counts only that part of the brand's CRM and adds a per-stage breakdown; pick segment names from GET /v1/orgs/contacts/segments. The parameters below are the ones documented today, not a whitelist. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmServeStatsQuery },
  responses: {
    200: { description: "Serve stats as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/contacts/segments",
  tags: ["CRM Contacts"],
  summary: "List the CRM segments of a brand (pipeline stages, deal statuses, tags, funnel steps) with people counts",
  description:
    "Proxy to crm-service GET /orgs/contacts/segments. What a CRM sourcing campaign can be scoped to, read from the brand's own connected CRM and tools: every CRM pipeline stage with its deal status, every contact tag, every funnel step reached (website visit, signup, form submission, meeting booked, sale...), each with how many people it holds. Call it before scoping a CRM segment on serve-next (`people.segment`), serve-stats (`segment`) or a CRM audience. Read-only, no cost. The whole query string is forwarded untransformed. Response shape owned by crm-service (PeopleSegmentCatalogue).",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Segment catalogue as returned by crm-service ({ brandId, dealStages, tags, steps })", content: { "application/json": { schema: CrmPassthroughResponse } } },
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
    "Proxy to crm-service GET /orgs/matrix/links — one link per channel, carrying the current QR / pairing code while the user scans. Polled every few seconds by the dashboard. Each account carries `automationAllowed` and its sender `persona` (set them with PATCH /v1/orgs/matrix/links/{linkId}). The whole query string is forwarded untransformed. Response shape owned by crm-service.",
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

registry.registerPath({
  method: "patch",
  path: "/v1/orgs/matrix/links/{linkId}",
  tags: ["CRM Contacts"],
  summary: "Update a linked account: outreach default, automation allowed, sender persona",
  description:
    "Proxy to crm-service PATCH /orgs/matrix/links/{linkId}. Send `brandId` plus at least one of: `outreachDefault: true` (a first WhatsApp message to a person no linked account already talks with goes out from this account; an existing conversation keeps its account; one per brand and channel, the others lose it), `automationAllowed` (whether automated messages may go out from this account), `persona` (the sender persona `{name?, role?, instructions?}`, or null to clear it). Request body forwarded verbatim. Status and body of every refusal are forwarded verbatim. Response shape owned by crm-service.",
  security: authed,
  request: {
    params: z.object({ linkId: z.string().openapi({ description: "Link id (the account's `linkId` from GET /v1/orgs/matrix/links)" }) }),
    body: { content: { "application/json": { schema: CrmPassthroughRequest } } },
  },
  responses: {
    200: { description: "The account's view as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: { description: "No such link for this brand (forwarded verbatim)", content: errorContent },
    409: { description: "The account is not linked (forwarded verbatim)", content: errorContent },
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

// ── PostHog + Stripe + Clerk connections (crm-service proxy) ─────────────────────────
// A brand's PostHog project (visits) and Stripe account (payments), read-only
// sources of the person thread. The credential is stored through
// /v1/keys/brands/{brandId} (provider `posthog` / `stripe` / `clerk`); crm-service
// resolves it server-side. Its /internal/{posthog,stripe,clerk}/* tier is not exposed.
for (const [provider, label, createBody] of [
  ["posthog", "PostHog", "`{ brandId, projectId, region }` (region `us` | `eu`)"],
  ["stripe", "Stripe", "`{ brandId }`"],
  ["clerk", "Clerk", "`{ brandId }`"],
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
  method: "get",
  path: "/v1/orgs/people/api-calls/{callId}",
  tags: ["CRM Contacts"],
  summary: "One API / MCP call of a person, whole: request and answer",
  description:
    "Proxy to crm-service GET /orgs/people/api-calls/{callId}: the raw side of a thread item of source `api` (its `ref.callId`), secrets already removed, each body cut at 256 KB. The whole query string is forwarded byte-for-byte (`brandId` required downstream). Requires x-user-id. Served on the staff Unibox scope only; any other scope is 404 with crm-service's body verbatim. Response shape owned by crm-service.",
  security: authed,
  request: { params: z.object({ callId: z.string() }), query: CrmBrandIdQuery },
  responses: {
    200: { description: "The call as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: { description: "Call not found in this scope (forwarded verbatim)", content: errorContent },
    ...crmErrorResponses,
  },
});

const CrmPeopleOutcomePeopleQuery = CrmBrandIdQuery.extend({
  step: z.string().openapi({ description: "Outcome step (e.g. signup), vocabulary owned by crm-service" }),
  limit: z.string().optional().openapi({ description: "Page size, validated by crm-service" }),
  offset: z.string().optional().openapi({ description: "Page offset, validated by crm-service" }),
});
registry.registerPath({
  method: "get",
  path: "/v1/orgs/people/outcomes",
  tags: ["CRM Contacts"],
  summary: "People who reached each outcome step, every source merged",
  description:
    "Proxy to crm-service GET /orgs/people/outcomes — per outcome step (website visit, signup, form submitted, meeting booked / attended, paid client), the distinct people who reached it from any source the brand connected, with per-source counts and how many we contacted. The whole query string is forwarded byte-for-byte (`brandId`). Requires x-user-id. Response shape owned by crm-service (PeopleOutcomes).",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Outcome counts as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/people/outcomes/people",
  tags: ["CRM Contacts"],
  summary: "The people of one outcome step, paged",
  description:
    "Proxy to crm-service GET /orgs/people/outcomes/people. The whole query string is forwarded byte-for-byte (`brandId`, `step`, `limit`, `offset` — the ones documented today, not a whitelist). Requires x-user-id. crm-service's 400 on an unknown step crosses verbatim. Response shape owned by crm-service (PeopleOutcomePeople).",
  security: authed,
  request: { query: CrmPeopleOutcomePeopleQuery },
  responses: {
    200: { description: "People as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
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

// Stated merges: someone says two people of a brand are the same human.
const peopleMergeRefusal = { description: "Refused, crm-service's `{ type: \"refused\", reason, personId?, error }` forwarded verbatim", content: errorContent };
registry.registerPath({
  method: "post",
  path: "/v1/orgs/people/merges",
  tags: ["CRM Contacts"],
  summary: "Merge two people into one person (they are the same human)",
  description:
    "Merge two people of a brand into ONE person when they are the same person on different channels and no source record says so (a WhatsApp chat with a number nobody saved, and the same human on Gmail or in the CRM). Proxy to crm-service POST /orgs/people/merges. Body `{ brandId, personIds: [personId, personId], reason? }` (the two personId values from GET /v1/orgs/people) forwarded verbatim. The two people become one merged thread with every channel and identity key of both; one person id is kept and the other still opens it. A rebuild starts at once: the merged person shows on GET /v1/orgs/people within about a minute. Idempotent: stating the same two people again answers 200 with `duplicate: true` (201 for a new merge). Refusals cross verbatim with their reason: 404 `person_not_found`, 422 `different_brand` / `same_person`, 409 `already_one_person`. Unmerge with POST /v1/orgs/people/merges/{mergeId}/undo. Requires x-user-id (recorded as who stated it). Response shape owned by crm-service.",
  security: authed,
  request: { body: { content: { "application/json": { schema: CrmPassthroughRequest } } } },
  responses: {
    201: { description: "Merge stated, rebuild started (crm-service body verbatim)", content: { "application/json": { schema: CrmPassthroughResponse } } },
    200: { description: "Already stated (`duplicate: true`), same body", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: peopleMergeRefusal,
    409: peopleMergeRefusal,
    422: peopleMergeRefusal,
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/people/merges",
  tags: ["CRM Contacts"],
  summary: "List the merges stated on a brand's people (same person, merged)",
  description:
    "Proxy to crm-service GET /orgs/people/merges: every merge stated on the brand (two people said to be the same person), newest first, undone ones included, each with `applied` (the latest build shows them as one person) and the merged `personId`. The whole query string is forwarded byte-for-byte (`brandId` required downstream). Requires x-user-id. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Merges as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/people/merges/{mergeId}/undo",
  tags: ["CRM Contacts"],
  summary: "Unmerge two people (undo a stated merge)",
  description:
    "Unmerge: take back a merge stated with POST /v1/orgs/people/merges. Proxy to crm-service POST /orgs/people/merges/{mergeId}/undo, body `{ brandId }` forwarded verbatim. The two people come back apart, each with its own person id, at the rebuild that starts now (unless a source record ties them on its own). The merge stays listed with who undid it and when. Idempotent: undoing twice answers `duplicate: true`. An unknown merge is 404 `merge_not_found`, crm-service's body verbatim. Requires x-user-id. Response shape owned by crm-service.",
  security: authed,
  request: {
    params: z.object({ mergeId: z.string() }),
    body: { content: { "application/json": { schema: CrmPassthroughRequest } } },
  },
  responses: {
    200: { description: "Undone, as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: peopleMergeRefusal,
    ...crmErrorResponses,
  },
});

// Corrections: a user corrects how the people were matched (a tag, a person's company, a domain verdict).
const peopleCorrectionRefusal = { description: "Refused, crm-service's `{ type: \"refused\", reason, error }` forwarded verbatim", content: errorContent };
registry.registerPath({
  method: "post",
  path: "/v1/orgs/people/corrections",
  tags: ["CRM Contacts"],
  summary: "Correct a person's tag, company, or an email domain verdict",
  description:
    "Correct how distribute.you matched a brand's people. Proxy to crm-service POST /orgs/people/corrections, body forwarded verbatim. Kinds: `tag_add` / `tag_remove` `{ brandId, kind, personId, tag }` (one of the four connection tags: personal_to_user, personal_not_to_user, professional_to_brand, professional_not_to_brand); `organization_add` `{ brandId, kind, personId, domain (or website), tags? }` (the person speaks for that company) / `organization_remove` `{ brandId, kind, personId, companyId }`; `domain_kind` `{ brandId, kind, domain, domainKind: mailbox_provider | organization }` (a domain is a public mailbox, or a company). Optional `reason`. Your statement wins over the automatic answer until undone; a newer statement on the same thing replaces the older. A rebuild starts at once (about a minute). Same statement twice answers 200 with `duplicate: true` (201 for a new one). Refusals cross verbatim with their reason: 404 `person_not_found`, 422 `company_unresolved` / `tags_required`. Take it back with POST /v1/orgs/people/corrections/{correctionId}/undo. Requires x-user-id (recorded as who stated it). Response shape owned by crm-service.",
  security: authed,
  request: { body: { content: { "application/json": { schema: CrmPassthroughRequest } } } },
  responses: {
    201: { description: "Correction recorded, rebuild started (crm-service body verbatim)", content: { "application/json": { schema: CrmPassthroughResponse } } },
    200: { description: "Already stated (`duplicate: true`), same body", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: peopleCorrectionRefusal,
    422: peopleCorrectionRefusal,
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/people/corrections",
  tags: ["CRM Contacts"],
  summary: "List the corrections stated on a brand's people",
  description:
    "Proxy to crm-service GET /orgs/people/corrections: every correction stated on the brand (tags, companies, domain verdicts), newest first, undone ones included, each with who stated it, when, and who undid it. The whole query string is forwarded byte-for-byte (`brandId` required downstream). Requires x-user-id. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery },
  responses: {
    200: { description: "Corrections as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/people/corrections/{correctionId}/undo",
  tags: ["CRM Contacts"],
  summary: "Undo a correction (the automatic answer applies again)",
  description:
    "Take back a correction stated with POST /v1/orgs/people/corrections. Proxy to crm-service POST /orgs/people/corrections/{correctionId}/undo, body `{ brandId }` forwarded verbatim. The automatic answer applies again from the rebuild that starts now. The correction stays listed with who undid it and when. Idempotent: undoing twice answers `duplicate: true`. An unknown correction is 404 `correction_not_found`, crm-service's body verbatim. Requires x-user-id. Response shape owned by crm-service.",
  security: authed,
  request: {
    params: z.object({ correctionId: z.string() }),
    body: { content: { "application/json": { schema: CrmPassthroughRequest } } },
  },
  responses: {
    200: { description: "Undone, as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
    404: peopleCorrectionRefusal,
    ...crmErrorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/people/organizations",
  tags: ["CRM Contacts"],
  summary: "List the companies a brand's people speak for, with their people and tags",
  description:
    "Proxy to crm-service GET /orgs/people/organizations (read-only): one row per company at least one person of the brand speaks for in a work role, most people first, with its people and the professional connection tags they carry (and how many carry each). Read off the last people build. The whole query string is forwarded byte-for-byte (`brandId` required downstream; `limit`, `offset` optional). Requires x-user-id. Response shape owned by crm-service.",
  security: authed,
  request: { query: CrmBrandIdQuery.passthrough() },
  responses: {
    200: { description: "Organizations as returned by crm-service", content: { "application/json": { schema: CrmPassthroughResponse } } },
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
    "by the downstream service. Cost ledger: the gateway adds `support: {kind: \"product_feature\", " +
    "reason}` so the upload's run is never undeclared; a caller that sends its own `support` keeps it.",
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
  method: "post",
  path: "/v1/brands/{id}/offers/{offerId}/qualification/previews",
  tags: ["Leads"],
  summary: "Run an offer's enabled qualification checks on sample companies that are not leads yet (spends)",
  description:
    "Pass-through to lead-service POST /orgs/brands/{brandId}/offers/{offerId}/qualification/previews. Body " +
    "`{companies: [{domain, name}]}` (1..10) is forwarded verbatim. Spends on the org's behalf under a child run of " +
    "the caller's run. Answers 200 when finished or 202 while still running (poll the GET on the returned preview id); " +
    "both carry `{preview}`.",
  security: authed,
  request: { params: QualificationOfferParams, body: { content: { "application/json": { schema: QualificationPassthroughBody } } } },
  responses: {
    ...qualificationResponses(200, "Finished (downstream body, untouched)"),
    202: { description: "Still running (downstream body, untouched)", content: { "application/json": { schema: QualificationResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/offers/{offerId}/qualification/previews/{previewId}",
  tags: ["Leads"],
  summary: "Read a qualification preview (never spends)",
  description:
    "Pass-through to lead-service GET /orgs/brands/{brandId}/offers/{offerId}/qualification/previews/{previewId}. " +
    "404 `preview_not_found` forwarded verbatim.",
  security: authed,
  request: { params: QualificationOfferParams.extend({ previewId: z.string().describe("Preview ID") }) },
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

// ---------------------------------------------------------------------------
// AGENT SIGNUP + PREPAY — an AI agent opens an account, gets a key, prepays.
// Owner 2026-10-12: no free credit, no trial, no subscription on this path;
// prepaid with MANDATORY auto top-up; minimums $10 prepay / $15 reload / $5
// threshold (front validation, src/lib/agent-prepay.ts).
// ---------------------------------------------------------------------------

const AGENT_FLOW =
  "Agent flow, no human needed except to pay: (1) POST /v1/agent-signups/start with your email + phone, " +
  "(2) read the 6-digit code in that inbox, (3) POST /v1/agent-signups/complete with email + code → `apiKey`, " +
  "(4) call any free endpoint with `Authorization: Bearer <apiKey>`, (5) before anything that spends money, " +
  "POST /v1/billing/accounts/prepaid_checkout and have the returned `url` paid. There is no free credit.";

export const AgentSignupStartRequestSchema = z
  .object({
    email: z.string().describe("An inbox you can read: the code is sent there, and account updates go there").openapi({ example: "agent@example.com" }),
    phone: z.string().describe("A phone number in international format, for urgent matters (WhatsApp). Format-checked, not verified").openapi({ example: "+33612345678" }),
  })
  .passthrough()
  .openapi("AgentSignupStartRequest");

registry.registerPath({
  method: "post",
  path: "/v1/agent-signups/start",
  tags: ["Agent Signup"],
  summary: "Request a signup code by email (no API key needed)",
  description:
    "Step 1 of opening a distribute.you account as an AI agent, with no API key and no human. Sends a 6-digit code " +
    "to `email`; read it in that inbox, then call POST /v1/agent-signups/complete. Works for an email that already " +
    "has an account too (that is how you get another API key for it). Requesting a new code cancels the earlier ones. " +
    "Answer (from client-service, verbatim): `{email, expiresAt, codeTtlMinutes, maxAttempts}`. " +
    AGENT_FLOW,
  request: { body: { content: { "application/json": { schema: AgentSignupStartRequestSchema } } } },
  responses: {
    200: { description: "Code sent: `{email, expiresAt, codeTtlMinutes, maxAttempts}`", content: { "application/json": { schema: z.object({}).passthrough().openapi("AgentSignupStartResponse") } } },
    400: { description: "`invalid_request`: email or phone missing or malformed (`message` says which)", content: errorContent },
    502: { description: "`code_email_failed`: the code email could not be sent; retry", content: errorContent },
  },
});

export const AgentSignupCompleteRequestSchema = z
  .object({
    email: z.string().describe("The email the code was sent to").openapi({ example: "agent@example.com" }),
    code: z.string().describe("The 6-digit code from the email").openapi({ example: "123456" }),
    keyName: z.string().optional().describe("Label for the new API key (default: `Agent key <timestamp>`)"),
  })
  .openapi("AgentSignupCompleteRequest");

const PrepayInstructionsSchema = z
  .object({
    method: z.literal("POST"),
    path: z.string().openapi({ example: "/v1/billing/accounts/prepaid_checkout" }),
    minimums_cents: z.object({
      topup_amount_cents: z.number().int().openapi({ example: 1000 }),
      auto_topup_amount_cents: z.number().int().openapi({ example: 1500 }),
      auto_topup_threshold_cents: z.number().int().openapi({ example: 500 }),
    }),
    example_body: z.object({}).passthrough(),
    returns: z.string(),
    then: z.string(),
    status_path: z.string().openapi({ example: "/v1/billing/accounts/prepaid_status" }),
  })
  .openapi("PrepayInstructions");

// Built by the gateway (src/routes/agent-signups.ts): account from client-service + key from key-service.
export const AgentSignupCompleteResponseSchema = z
  .object({
    apiKey: z.string().describe("The new API key (`distrib.usr_*`). Shown ONCE: store it. Send it as `Authorization: Bearer <apiKey>`"),
    apiKeyId: z.string().describe("Id of the key, to revoke it later with DELETE /v1/api-keys/{id}"),
    apiKeyName: z.string(),
    orgId: z.string().describe("Your organization"),
    userId: z.string().describe("Your user"),
    email: z.string(),
    contactPhone: z.string().nullable(),
    created: z.boolean().describe("true = a new account was opened; false = the email already had one, and this is one more key for it"),
    usage: z.string(),
    prepay: PrepayInstructionsSchema.describe("How to prepay before calling anything that costs money"),
  })
  .openapi("AgentSignupCompleteResponse");

registry.registerPath({
  method: "post",
  path: "/v1/agent-signups/complete",
  tags: ["Agent Signup"],
  summary: "Verify the code and get an API key (no API key needed)",
  description:
    "Step 2: send the email and the 6-digit code; get back a working API key plus your org and user ids. A new email " +
    "opens an account (organization + user; the email is the account's contact, the person can later sign in to the " +
    "dashboard with it). An email that already has an account gets a NEW additional key for that same account " +
    "(`created: false`): call start + complete again whenever you need another key. The account has NO free credit: " +
    "free endpoints work at once, and anything that spends money answers 402 `payment_required` until you prepay " +
    "(see `prepay` in the answer). A 429 with `error: \"too_many_attempts\"` means this code is burned after too " +
    "many wrong tries: request a new one with POST /v1/agent-signups/start (any other 429 is the rate limit). " +
    AGENT_FLOW,
  request: { body: { content: { "application/json": { schema: AgentSignupCompleteRequestSchema } } } },
  responses: {
    200: { description: "The account and a new API key", content: { "application/json": { schema: AgentSignupCompleteResponseSchema } } },
    400: { description: "`code_invalid` (wrong code, `attemptsLeft` says how many tries remain) or `invalid_request` (email/code missing or malformed)", content: errorContent },
    404: { description: "`no_pending_code`: no code was requested for this email; call POST /v1/agent-signups/start", content: errorContent },
    410: { description: "`code_expired`: request a new code with POST /v1/agent-signups/start", content: errorContent },
    502: { description: "`identity_provider_failed` / `billing_unavailable` (account not opened, retry), or `key_minting_failed` (account ready, no key: call complete again with the same code)", content: errorContent },
  },
});

export const PrepaidCheckoutRequestSchema = z
  .object({
    topup_amount_cents: z.number().int().min(1000).describe("Charged now and credited exactly, in cents. Minimum 1000 ($10). You choose the amount").openapi({ example: 1000 }),
    auto_topup_amount_cents: z.number().int().min(1500).describe("What each automatic reload charges the saved card, in cents. Minimum 1500 ($15)").openapi({ example: 1500 }),
    auto_topup_threshold_cents: z.number().int().min(500).describe("Reload when the balance would fall below this, in cents. Minimum 500 ($5)").openapi({ example: 500 }),
    success_url: z.string().url().optional().describe("Where the payer lands after paying (default: a distribute.you page)"),
    cancel_url: z.string().url().optional().describe("Where the payer lands if they cancel (default: a distribute.you page)"),
  })
  .passthrough()
  .openapi("PrepaidCheckoutRequest");

registry.registerPath({
  method: "post",
  path: "/v1/billing/accounts/prepaid_checkout",
  tags: ["Billing"],
  summary: "Prepay: get a payment link (amount you choose, auto top-up required)",
  description:
    "Call this when a call answered 402 `payment_required`, or before anything that spends money. Returns `url`, a " +
    "hosted card payment page charging `topup_amount_cents`. Paying it credits the balance with exactly that amount " +
    "(no free credit is ever added), saves the card, and arms the MANDATORY automatic top-up: whenever the balance " +
    "would fall below `auto_topup_threshold_cents`, the card is charged `auto_topup_amount_cents`. Minimums: $10 " +
    "prepay, $15 reload, $5 threshold; below a minimum the answer is 400 `amount_below_minimum` naming the `field` and " +
    "its `minimum_cents` (a missing or non-integer amount is 400 `invalid_amount`). No subscription on this path. " +
    "You cannot pay the page yourself unless you hold a card: give `url` to your human. Then poll " +
    "GET /v1/billing/accounts/prepaid_status until `state` is `active`. Example: prepay $10 → balance $10; it drops " +
    "under $5 → the card is charged $15. Answer from billing-service, verbatim: `{url, session_id, org_id, " +
    "payment_mode: \"prepaid\", free_credit_offer, topup_amount_cents, auto_topup: {amount_cents, threshold_cents}}`.",
  security: authed,
  request: { body: { content: { "application/json": { schema: PrepaidCheckoutRequestSchema } } } },
  responses: {
    200: { description: "Payment page ready", content: { "application/json": { schema: z.object({}).passthrough().openapi("PrepaidCheckoutResponse") } } },
    400: { description: "`amount_below_minimum` / `invalid_amount` (`field`, `minimum_cents`, `message`), or billing's own refusal of the body", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    409: { description: "`subscription_mode` (this org pays by subscription), or money still owed (`code`, `owed_cents`)", content: errorContent },
    502: { description: "Payment provider unavailable; retry", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/billing/accounts/prepaid_status",
  tags: ["Billing"],
  summary: "Prepaid status: paid yet? balance, auto top-up, can the card be reloaded?",
  description:
    "Read after giving a payment `url` to your human, and whenever a paid call is refused. `state`: " +
    "`awaiting_payment` (nothing paid yet: the page has not been paid, open a new checkout if the link expired) | " +
    "`active` (paid, auto top-up armed, card reloadable: you can spend) | `card_not_reloadable` (paid, but the card " +
    "cannot be charged automatically, `card.not_reloadable_reason` says why: `no_saved_card`, " +
    "`card_issuing_country_unsupported`, `prepaid_card`, `recurring_charge_not_authorized`, `card_unusable`; the " +
    "balance is spendable but will not refill: ask your human to pay a new prepaid checkout with another card) | " +
    "`auto_topup_off` (prepaid without reload: open a prepaid checkout to arm it) | `not_prepaid` (the org pays " +
    "another way). Also `balance_cents`, `paid_cents`, `auto_topup {enabled, amount_cents, threshold_cents}`, " +
    "`card {saved, reloadable, not_reloadable_reason}`. Answer from billing-service, verbatim; 404 = no billing " +
    "account yet (nothing paid).",
  security: authed,
  responses: {
    200: { description: "Prepaid status", content: { "application/json": { schema: z.object({}).passthrough().openapi("PrepaidStatusResponse") } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No billing account yet", content: errorContent },
    502: { description: "Payment provider unavailable; retry", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// GET /v1/me/openapi.json — the API document for the calling key.
// ---------------------------------------------------------------------------
registry.registerPath({
  method: "get",
  path: "/v1/me/openapi.json",
  tags: ["User"],
  summary: "The API document for this key",
  description:
    "The OpenAPI document of every operation THIS key may call. For a customer key it is the public document " +
    "(`GET /openapi.json`). For a distribute.you staff member's key it also carries the staff operations a staff key " +
    "may call, each under the `Staff (key)` tag. The distribute.you MCP reads it to know what a session can do. " +
    "Revalidate instead of re-downloading: the response carries an `ETag`; send it back as `If-None-Match` and an unchanged " +
    "document answers 304 with no body. Reads of this document are not recorded on your conversation thread.",
  security: authed,
  request: {
    query: z.object({
      view: z.enum(["full", "onboarding"]).optional().describe(
        "`onboarding`: only the operations that open a first client (brand, offer, audience, email preview, prepay, campaign), in order, with what each answers (about 100 KB). Omit for the full document.",
      ),
    }),
  },
  responses: {
    200: { description: "OpenAPI 3 document (header `ETag` names this version)", content: { "application/json": { schema: z.object({}).passthrough().openapi("KeyOpenApiDocument") } } },
    304: { description: "Not modified: the copy named by `If-None-Match` is current. No body." },
    400: { description: "`invalid_view`: unknown `view`", content: errorContent },
    401: { description: "Missing or refused key", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// POST /v1/replies — answer a person in their existing thread (instantly-service).
// ---------------------------------------------------------------------------
registry.registerPath({
  method: "post",
  path: "/v1/replies",
  tags: ["Replies"],
  summary: "Reply to a person in their existing email thread",
  description:
    "Send an answer into the email thread a person already has with the brand, from the mailbox and persona that wrote " +
    "to them (the reply a sales rep would send). Name the person by `email` alone: the thread is found from it. When that " +
    "person wrote back on several campaigns the answer is 409 `ambiguous_thread` with the `candidates`; call again with one " +
    "`campaign_id`. Write `body_html` without a signature (the persona's is added). " +
    "Send `sent_by: \"human\"` for a reply a person decided on. Name the organization with `brandId` or `orgId`. " +
    "To send files, list offer documents in `attachments` [{ document_id }] (up to 5, 10 MB together; ids from " +
    "`GET /v1/brands/{id}/offers/{offerId}/documents`): each goes as a real email attachment, and any problem refuses the " +
    "whole reply, nothing sent (404 `attachment_not_found`, 422 `attachment_too_large` or `attachments_unsupported_on_transport`, " +
    "502 `attachment_unavailable`). " +
    "Pass-through to instantly-service POST /orgs/replies: refusals come back unchanged with a `code` " +
    "(409 `ambiguous_thread`, `no_reply_to_thread`, `human_took_over`; 404 `campaign_not_found` when the org never emailed that person). The full body is documented from instantly-service.",
  security: authed,
  request: { body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("ReplyToPersonRequest") } } } },
  responses: {
    200: { description: "The reply was sent (instantly-service shape)", content: { "application/json": { schema: z.object({}).passthrough().openapi("ReplyToPersonResponse") } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "No thread for that person (forwarded verbatim)", content: errorContent },
    409: { description: "Refused, with a `code` (forwarded verbatim)", content: errorContent },
    422: { description: "An attachment refused (`attachment_too_large`, `attachments_unsupported_on_transport`), nothing sent (forwarded verbatim)", content: errorContent },
    502: { description: "An attachment unreadable (`attachment_unavailable`), nothing sent (forwarded verbatim)", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// Organizations and member invitations (client-service).
// ---------------------------------------------------------------------------
const passthroughBody = (name: string) => ({ content: { "application/json": { schema: z.object({}).passthrough().openapi(name) } } });
const passthroughResponse = (description: string, name: string) => ({ description, content: { "application/json": { schema: z.object({}).passthrough().openapi(name) } } });

registry.registerPath({
  method: "post",
  path: "/v1/orgs",
  tags: ["Organizations"],
  summary: "Create an organization for a new client (staff only)",
  description:
    "Open a new client's account: send the organization's `name` (and an `idempotencyKey` so a retry returns the same org). " +
    "Returns `orgId`, ready at once for brands, offers, audiences and campaigns, with onboarding already marked complete. " +
    "Then add the client's website as a brand and invite the client (`POST /v1/orgs/{orgId}/member-invitations`). " +
    "No credit is granted: use `POST /v1/billing/credits/grant`. Staff only: a distribute.you staff member's own API key; " +
    "any other key gets 403 `staff_only`. The acting user is taken from the key. Pass-through to client-service POST /internal/orgs " +
    "(201 created, 200 idempotent replay).",
  security: platformAuth,
  request: { body: passthroughBody("CreateOrganizationRequest") },
  responses: {
    201: passthroughResponse("Organization created (client-service shape)", "CreatedOrganization"),
    200: passthroughResponse("Idempotent replay: the org an earlier call with the same idempotencyKey created", "CreatedOrganizationReplay"),
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    502: { description: "Identity provider failed (forwarded verbatim)", content: errorContent },
  },
});

export const AddOrgMemberRequestSchema = z
  .object({
    email: z.string().describe("The person's email. They receive NOTHING: no invitation, no code. They later sign in to the dashboard with this email and land in this organization").openapi({ example: "jane@acme.com" }),
    keyName: z.string().optional().describe("Label for the person's new API key (default: `Key for <email> <timestamp>`)"),
  })
  .passthrough()
  .openapi("AddOrgMemberRequest");

// Built by the gateway (src/routes/orgs.ts): membership from client-service + key from key-service.
export const AddOrgMemberResponseSchema = z
  .object({
    member: z
      .object({
        userId: z.string().describe("The person's user id"),
        clerkUserId: z.string(),
        email: z.string(),
        orgId: z.string(),
        role: z.string().openapi({ example: "org:admin" }),
      })
      .passthrough(),
    userCreated: z.boolean().describe("true = this email had no account and one was opened (nothing was emailed)"),
    membershipCreated: z.boolean().describe("false = the person was already a member (idempotent replay)"),
    apiKey: z.string().describe("The PERSON's new API key (`distrib.usr_*`), shown ONCE. It reaches only the organizations this person is a member of, never staff operations"),
    apiKeyId: z.string().describe("Id of the key (the person can revoke it with DELETE /v1/api-keys/{id})"),
    apiKeyName: z.string(),
    usage: z.string(),
  })
  .openapi("AddOrgMemberResponse");

registry.registerPath({
  method: "post",
  path: "/v1/orgs/{orgId}/members",
  tags: ["Organizations"],
  summary: "Add a person to an organization silently and get their API key (staff only)",
  description:
    "Make a person (by `email`) a member of this organization WITHOUT sending them anything, and get back an API key that " +
    "belongs to that person, to hand over in your own message (test it first: GET /v1/me with it lists only their organizations). " +
    "An email with no account gets one (verified, nothing mailed); the person later signs in to the dashboard with that email. " +
    "Calling again for a member is safe (200, `membershipCreated: false`) and mints one more key. The key is a normal user key: " +
    "it reaches only the organizations the person belongs to and never staff operations; a staff email is refused " +
    "(422 `staff_email_refused`). Staff only: a distribute.you staff member's own API key, any other key gets 403 `staff_only`. " +
    "The staff caller need not be a member of the organization. Membership: client-service POST /internal/orgs/{orgId}/members " +
    "(refusals forwarded verbatim); key: key-service.",
  security: platformAuth,
  request: {
    params: z.object({ orgId: z.string().uuid().openapi({ description: "The organization (e.g. from POST /v1/orgs)" }) }),
    body: { content: { "application/json": { schema: AddOrgMemberRequestSchema } } },
  },
  responses: {
    201: { description: "Member added, with their new API key", content: { "application/json": { schema: AddOrgMemberResponseSchema } } },
    200: { description: "Already a member: one more API key for them", content: { "application/json": { schema: AddOrgMemberResponseSchema } } },
    400: { description: "`invalid_request`: email missing or malformed", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff (`staff_only`)", content: errorContent },
    404: { description: "`org_not_found` (forwarded verbatim)", content: errorContent },
    409: { description: "`org_has_no_identity`: the organization has no identity-provider org yet (forwarded verbatim)", content: errorContent },
    422: { description: "`staff_email_refused` (a staff member's email), or `member_refused` in the identity provider's words (forwarded verbatim)", content: errorContent },
    502: { description: "`identity_provider_failed` (forwarded verbatim) or `key_minting_failed` (member added, no key: call again)", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/orgs/{orgId}/members/{userId}",
  tags: ["Organizations"],
  summary: "Take a person out of an organization (staff only)",
  description:
    "End a person's membership of this organization: they lose access to it at once (their API keys stop reaching it) " +
    "and, if it was the organization they last used, that is cleared. Their account and their other organizations are untouched. " +
    "`userId` is the person's user id (the `member.userId` returned by POST /v1/orgs/{orgId}/members, or `id` in GET /v1/users, which lists only the people whose last-used organization is the one named). " +
    "Calling again is safe: 200 with `membershipRemoved: false` when they are not a member. " +
    "Staff only: a distribute.you staff member's own API key, any other key gets 403 `staff_only`. The staff caller need not be a " +
    "member of the organization. Pass-through to client-service DELETE /internal/orgs/{orgId}/members/{userId}: answers " +
    "`{ userId, orgId, membershipRemoved, lastActiveOrgCleared }`, refusals forwarded verbatim with `error` + `message`.",
  security: platformAuth,
  request: {
    params: z.object({
      orgId: z.string().uuid().openapi({ description: "The organization" }),
      userId: z.string().uuid().openapi({ description: "The person's user id" }),
    }),
  },
  responses: {
    200: passthroughResponse("Done (client-service shape): `membershipRemoved: false` = they were not a member", "RemovedOrgMember"),
    400: { description: "`invalid_request` (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff (`staff_only`)", content: errorContent },
    404: { description: "`org_not_found` or `user_not_found` (forwarded verbatim)", content: errorContent },
    409: { description: "`org_has_no_identity`: the organization has no identity-provider org (forwarded verbatim)", content: errorContent },
    422: { description: "`member_removal_refused`: the identity provider refused, e.g. the last admin (message safe to show, forwarded verbatim)", content: errorContent },
    502: { description: "`identity_provider_failed` (forwarded verbatim)", content: errorContent },
  },
});

const JOIN_LINK_ABOUT =
  "The org's join link is ONE shareable dashboard URL for the whole team of a prospect or client: put it in your email so " +
  "anyone of their team reaches this organization's dashboard. Whoever opens it signs in or signs up with ANY email and " +
  "joins the organization as an admin. Nothing is emailed by us. One link per organization, no expiry: it works until revoked; " +
  "revoking kills it at once (members who already joined stay) and the next mint gives a new URL. " +
  "Staff only: a distribute.you staff member's own API key, any other key gets 403 `staff_only`. The staff caller need not be " +
  "a member of the organization.";

const joinLinkParams = z.object({ orgId: z.string().uuid().openapi({ description: "The organization (e.g. from POST /v1/orgs)" }) });

const joinLinkErrors = {
  400: { description: "`invalid_request` (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Not staff (`staff_only`)", content: errorContent },
  404: { description: "`org_not_found`, or `user_not_found` for the acting staff member on mint (forwarded verbatim)", content: errorContent },
  409: { description: "`org_has_no_identity`: the organization has no identity-provider org yet (forwarded verbatim)", content: errorContent },
  502: { description: "`identity_provider_failed` (forwarded verbatim)", content: errorContent },
};

registry.registerPath({
  method: "post",
  path: "/v1/orgs/{orgId}/join-link",
  tags: ["Organizations"],
  summary: "Get a link the prospect's team can use to join the account (staff only)",
  description:
    "Mint this organization's join link, or get the existing one (calling again returns the SAME URL, 200 `created: false`). " +
    "Send no body: you are recorded as the link's creator. " + JOIN_LINK_ABOUT +
    " Pass-through to client-service POST /internal/orgs/{orgId}/join-link: answers `{ link: { url, createdAt }, created }`, " +
    "`link.url` is the URL to share.",
  security: platformAuth,
  request: { params: joinLinkParams },
  responses: {
    201: passthroughResponse("Minted: `{ link: { url, createdAt }, created: true }`", "OrgJoinLinkMinted"),
    200: passthroughResponse("The organization already had one, returned: `{ link, created: false }`", "OrgJoinLinkMinted"),
    ...joinLinkErrors,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/{orgId}/join-link",
  tags: ["Organizations"],
  summary: "Read an organization's join link (staff only)",
  description:
    "Read this organization's join link without creating one: `{ link: { url, createdAt } }`, or `{ link: null }` when it has " +
    "none (never minted, or revoked). " + JOIN_LINK_ABOUT +
    " Pass-through to client-service GET /internal/orgs/{orgId}/join-link.",
  security: platformAuth,
  request: { params: joinLinkParams },
  responses: {
    200: passthroughResponse("`{ link: { url, createdAt } | null }`", "OrgJoinLink"),
    ...joinLinkErrors,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/orgs/{orgId}/join-link",
  tags: ["Organizations"],
  summary: "Revoke an organization's join link (staff only)",
  description:
    "The link stops working at once (opening it says it is no longer valid); members who already joined stay. Minting again " +
    "gives a NEW URL. Safe to call again: `{ revoked: false }` when there was none. " + JOIN_LINK_ABOUT +
    " Pass-through to client-service DELETE /internal/orgs/{orgId}/join-link: answers `{ revoked }`.",
  security: platformAuth,
  request: { params: joinLinkParams },
  responses: {
    200: passthroughResponse("`{ revoked: true }`, or `false` when there was no link", "OrgJoinLinkRevoked"),
    ...joinLinkErrors,
  },
});

const MEMBERSHIP_LIMIT_ABOUT =
  "How many people this organization may hold. Every organization allows the identity provider's plan maximum (20 today) " +
  "unless staff set its own. Past the limit, a join through the join link, an invitation or an added member is refused. " +
  "Staff only: a distribute.you staff member's own API key, any other key gets 403 `staff_only`. The staff caller need not be " +
  "a member of the organization. Answer: `{ maxAllowedMemberships: int | null (null = no limit), membersCount }`.";

const membershipLimitErrors = {
  400: { description: "`invalid_request` (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Not staff (`staff_only`)", content: errorContent },
  404: { description: "`org_not_found` (forwarded verbatim)", content: errorContent },
  409: { description: "`org_has_no_identity`: the organization has no identity-provider org yet (forwarded verbatim)", content: errorContent },
  502: { description: "`identity_provider_failed` (forwarded verbatim)", content: errorContent },
};

export const SetOrgMembershipLimitRequestSchema = z
  .object({
    maxAllowedMemberships: z.number().int().min(1).nullable().openapi({
      description:
        "How many members the organization may hold, or null for no limit. A value the identity provider's plan does not allow " +
        "is refused (422 `limit_refused`, its own sentence in `message`), never clamped.",
      example: 20,
    }),
  })
  .passthrough()
  .openapi("SetOrgMembershipLimitRequest");

registry.registerPath({
  method: "get",
  path: "/v1/orgs/{orgId}/membership-limit",
  tags: ["Organizations"],
  summary: "Read how many people an organization may hold (staff only)",
  description: MEMBERSHIP_LIMIT_ABOUT + " Pass-through to client-service GET /internal/orgs/{orgId}/membership-limit.",
  security: platformAuth,
  request: { params: joinLinkParams },
  responses: {
    200: passthroughResponse("`{ maxAllowedMemberships, membersCount }`", "OrgMembershipLimit"),
    ...membershipLimitErrors,
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/orgs/{orgId}/membership-limit",
  tags: ["Organizations"],
  summary: "Set how many people an organization may hold (staff only)",
  description:
    "Members already in stay. Sends nothing to anyone. " + MEMBERSHIP_LIMIT_ABOUT +
    " Pass-through to client-service PUT /internal/orgs/{orgId}/membership-limit: answers the limit as the identity provider now holds it.",
  security: platformAuth,
  request: { params: joinLinkParams, body: { content: { "application/json": { schema: SetOrgMembershipLimitRequestSchema } } } },
  responses: {
    200: passthroughResponse("Set: `{ maxAllowedMemberships, membersCount }`", "OrgMembershipLimit"),
    422: { description: "`limit_refused`: the identity provider's plan does not allow this value; `message` is its sentence (forwarded verbatim)", content: errorContent },
    ...membershipLimitErrors,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/orgs/{orgId}/member-invitations",
  tags: ["Organizations"],
  summary: "Invite a person to the organization by email",
  description:
    "Invite someone to join this organization: send their `email`. Returns the `invitation` with its `inviteUrl`, the link to " +
    "forward by hand (they also get it by email). Inviting the same email again returns the pending invitation (200) instead of " +
    "a second one. Any member of the organization may invite. The inviter is taken from the key. Pass-through to client-service " +
    "POST /internal/orgs/{orgId}/member-invitations.",
  security: authed,
  request: {
    params: z.object({ orgId: z.string().uuid().openapi({ description: "The organization (from GET /v1/me)" }) }),
    body: passthroughBody("InviteMemberRequest"),
  },
  responses: {
    201: passthroughResponse("Invitation created, with its link", "MemberInvitationCreated"),
    200: passthroughResponse("Already invited: the pending invitation", "MemberInvitationExisting"),
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not a member of this organization", content: errorContent },
    422: { description: "`invitation_refused` (e.g. already a member), forwarded verbatim", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/{orgId}/member-invitations",
  tags: ["Organizations"],
  summary: "List the organization's pending invitations",
  description:
    "The invitations to this organization that can still be accepted: email, link, dates. Any member may list them. " +
    "Pass-through to client-service GET /internal/orgs/{orgId}/member-invitations.",
  security: authed,
  request: { params: z.object({ orgId: z.string().uuid().openapi({ description: "The organization (from GET /v1/me)" }) }) },
  responses: {
    200: passthroughResponse("Pending invitations (client-service shape)", "MemberInvitationList"),
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not a member of this organization", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/orgs/{orgId}/member-invitations/{invitationId}",
  tags: ["Organizations"],
  summary: "Revoke an invitation to the organization",
  description:
    "Cancel a pending invitation so its link stops working. Any member may revoke. " +
    "Pass-through to client-service DELETE /internal/orgs/{orgId}/member-invitations/{invitationId}.",
  security: authed,
  request: {
    params: z.object({
      orgId: z.string().uuid().openapi({ description: "The organization (from GET /v1/me)" }),
      invitationId: z.string().openapi({ description: "The invitation id, from the list or the creation answer" }),
    }),
  },
  responses: {
    200: passthroughResponse("The revoked invitation", "MemberInvitationRevoked"),
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not a member of this organization", content: errorContent },
    404: { description: "`invitation_not_found` (forwarded verbatim)", content: errorContent },
  },
});

// ── Owner Telegram notices (OWNER-TELEGRAM-GATEWAY-1014) ──────────────────────
// Any member of the org, for their OWN org only (the path org must be the
// authenticated one). Pass-through to client-service /internal/orgs/{orgId}/owner-telegram*.
const ownerTelegramParams = z.object({
  orgId: z.string().uuid().openapi({ description: "Your organization (from GET /v1/me). Must be the organization this request acts in." }),
});
const ownerTelegramErrors = {
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "`org_mismatch`: the path organization is not the one this request acts in, or you are not a member", content: errorContent },
  404: { description: "`org_not_found` (forwarded verbatim)", content: errorContent },
};
const OWNER_TELEGRAM_ABOUT =
  "Telegram notices: one short line to the organization's owner when one of our workflows acts for the organization " +
  "(for example, a post was published).";

registry.registerPath({
  method: "post",
  path: "/v1/orgs/{orgId}/owner-telegram/link-codes",
  tags: ["Organizations"],
  summary: "Get a link to connect Telegram for the organization's notices",
  description:
    OWNER_TELEGRAM_ABOUT +
    " Open `linkUrl` (`https://t.me/<bot>?start=<code>`) and press Start in Telegram: that chat then gets the notices. " +
    "Good once, for 30 minutes (`expiresAt`). Connecting again replaces the chat linked before. No body: the member " +
    "connecting is taken from the key. Pass-through to client-service POST /internal/orgs/{orgId}/owner-telegram/link-codes.",
  security: authed,
  request: { params: ownerTelegramParams },
  responses: {
    201: passthroughResponse("`{ code, linkUrl, expiresAt }`", "OwnerTelegramLinkCode"),
    ...ownerTelegramErrors,
    502: { description: "`bot_unavailable`: Telegram could not be reached (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/orgs/{orgId}/owner-telegram",
  tags: ["Organizations"],
  summary: "Is the organization's owner connected to Telegram notices?",
  description:
    OWNER_TELEGRAM_ABOUT +
    " Answers `{ reachable: false }`, or `{ reachable: true, target: \"linked_chat\" | \"platform_owner_chat\", linkedAt }`. " +
    "Pass-through to client-service GET /internal/orgs/{orgId}/owner-telegram.",
  security: authed,
  request: { params: ownerTelegramParams },
  responses: {
    200: passthroughResponse("`{ reachable, target?, linkedAt? }`", "OwnerTelegramStatus"),
    ...ownerTelegramErrors,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/orgs/{orgId}/owner-telegram",
  tags: ["Organizations"],
  summary: "Stop the organization's Telegram notices",
  description:
    "Disconnects the linked Telegram chat. Idempotent: `{ unlinked: false }` when nothing was linked. " +
    "Pass-through to client-service DELETE /internal/orgs/{orgId}/owner-telegram.",
  security: authed,
  request: { params: ownerTelegramParams },
  responses: {
    200: passthroughResponse("`{ unlinked }`", "OwnerTelegramUnlinked"),
    ...ownerTelegramErrors,
  },
});

// ── Relationships (RELATIONSHIP-TAGS-1014) ─────────────────────────────────────
// Who each person is to a brand: relationship tags, suggested merges, company.
// Pass-through to lead-service /orgs/brands/{brandId}/relationships/* (same suffix)
// and GET /orgs/leads/{id}/relationship. lead-service owns the vocabulary, the
// shapes and every refusal; bodies and query strings are forwarded verbatim.
const RELATIONSHIP_TAGS_DOC =
  "Tags: `personal` (about the PERSON, shown on every brand) and `customer`, `prospect`, `team`, `investor`, " +
  "`advisor`, `supplier`, `partner`, `other_professional` (about this person at this brand).";

const RelationshipBrandParam = z.string().uuid().openapi({ description: "The brand (from GET /v1/me or GET /v1/brands)" });
const RelationshipHumanParam = z.string().uuid().openapi({ description: "The person (`humanId` from the review read)" });

const relationshipErrors = {
  400: { description: "Invalid request (lead-service states the reason, verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  404: { description: "Not found in this organization (lead-service's answer, verbatim)", content: errorContent },
  500: { description: "Internal error", content: errorContent },
  502: { description: "lead-service could not reach a service it needs (verbatim)", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/relationships/review",
  tags: ["Leads"],
  summary: "Review who each person is to a brand: unsure merges, unsure tags, unknown companies, and everything settled",
  description:
    "What the brand's relationship review needs: `mergeQuestions` (two people the AI thinks may be the same person, " +
    "each with a `confidence` and a `reason`), `tagQuestions` (a tag the AI is unsure about), `companyQuestions` " +
    "(people whose company is unknown, with candidates), `settled` (merges done and every person with their company " +
    "and tags) and `counts`. Fix each with the POST/PUT/DELETE routes under the same path. " + RELATIONSHIP_TAGS_DOC +
    " Pass-through to lead-service GET /orgs/brands/{brandId}/relationships/review.",
  security: authed,
  request: { params: z.object({ brandId: RelationshipBrandParam }) },
  responses: {
    200: { description: "The review, as returned by lead-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RelationshipReviewResponse") } } },
    ...relationshipErrors,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{brandId}/relationships/merge-questions/{questionId}/answer",
  tags: ["Leads"],
  summary: "Answer a merge question: are these two the same person?",
  description:
    "`{same: true}` links the two people as one person (for this organization only); `{same: false}` records them as " +
    "different people and the question is never asked again. Undo a merge with POST .../relationships/merges/{linkId}/undo. " +
    "Pass-through to lead-service POST /orgs/brands/{brandId}/relationships/merge-questions/{questionId}/answer.",
  security: authed,
  request: {
    params: z.object({ brandId: RelationshipBrandParam, questionId: z.string().uuid().openapi({ description: "`mergeQuestions[].id` from the review read" }) }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ same: z.boolean().openapi({ description: "true = the same person, false = two different people" }) })
            .passthrough()
            .openapi("RelationshipMergeAnswerRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "The answer as recorded, as returned by lead-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RelationshipMergeAnswerResponse") } } },
    ...relationshipErrors,
    409: { description: "`human_service_refused` (verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/brands/{brandId}/relationships/merges/{linkId}/undo",
  tags: ["Leads"],
  summary: "Undo a merge: the two people are separate again",
  description:
    "Undo one merge listed in `settled.merges` of the review read. " +
    "Pass-through to lead-service POST /orgs/brands/{brandId}/relationships/merges/{linkId}/undo.",
  security: authed,
  request: { params: z.object({ brandId: RelationshipBrandParam, linkId: z.string().openapi({ description: "`settled.merges[].linkId` from the review read" }) }) },
  responses: {
    200: { description: "The merge undone, as returned by lead-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RelationshipMergeUndoResponse") } } },
    ...relationshipErrors,
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{brandId}/relationships/{humanId}/tags/{tag}",
  tags: ["Leads"],
  summary: "Say yes or no to one relationship tag on a person",
  description:
    "Your word on a tag outranks the evidence and the AI's judgment. `{state: \"yes\"}` or `{state: \"no\"}`. " +
    RELATIONSHIP_TAGS_DOC + " Remove your word with DELETE on the same path. " +
    "Pass-through to lead-service PUT /orgs/brands/{brandId}/relationships/{humanId}/tags/{tag}.",
  security: authed,
  request: {
    params: z.object({ brandId: RelationshipBrandParam, humanId: RelationshipHumanParam, tag: z.string().openapi({ description: "One relationship tag, e.g. `personal`, `customer`" }) }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ state: z.string().openapi({ description: "`yes` or `no`" }) })
            .passthrough()
            .openapi("RelationshipTagStateRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "`{relationship}` after the change, as returned by lead-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RelationshipTagStateResponse") } } },
    ...relationshipErrors,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{brandId}/relationships/{humanId}/tags/{tag}",
  tags: ["Leads"],
  summary: "Remove your word on one relationship tag (back to evidence and the AI's judgment)",
  description:
    "Withdraw a yes/no stated with PUT on the same path. " +
    "Pass-through to lead-service DELETE /orgs/brands/{brandId}/relationships/{humanId}/tags/{tag}.",
  security: authed,
  request: { params: z.object({ brandId: RelationshipBrandParam, humanId: RelationshipHumanParam, tag: z.string().openapi({ description: "One relationship tag" }) }) },
  responses: {
    200: { description: "`{withdrawn, relationship}`, as returned by lead-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RelationshipTagWithdrawResponse") } } },
    ...relationshipErrors,
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{brandId}/relationships/{humanId}/company",
  tags: ["Leads"],
  summary: "Set the company a person works at (or say they have none)",
  description:
    "Send exactly one of `{domain}`, `{name}` or `{none: true}`. " +
    "Pass-through to lead-service PUT /orgs/brands/{brandId}/relationships/{humanId}/company.",
  security: authed,
  request: {
    params: z.object({ brandId: RelationshipBrandParam, humanId: RelationshipHumanParam }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              domain: z.string().optional().openapi({ description: "The company's website domain, e.g. `acme.com`" }),
              name: z.string().optional().openapi({ description: "The company's name, when no domain is known" }),
              none: z.boolean().optional().openapi({ description: "true = this person works at no company" }),
            })
            .passthrough()
            .openapi("RelationshipCompanyRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "`{company}` as set, as returned by lead-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("RelationshipCompanyResponse") } } },
    ...relationshipErrors,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/leads/{id}/relationship",
  tags: ["Leads"],
  summary: "Who the person of one lead is to its brand",
  description:
    "Answer `{leadId, brandId, relationship}`: the person's company, relationship tags (yes and unsure), when the " +
    "whole thread was last judged, the detail per tag, and `policies.business_only`. " + RELATIONSHIP_TAGS_DOC +
    " `brandId` (query) picks the brand when the lead row belongs to several. " +
    "Pass-through to lead-service GET /orgs/leads/{id}/relationship.",
  security: authed,
  request: {
    params: z.object({ id: z.string().openapi({ description: "The `id` of a lead as returned by GET /v1/leads." }) }),
    query: z.object({ brandId: z.string().optional().openapi({ description: "Brand scope." }) }).passthrough(),
  },
  responses: {
    200: { description: "The relationship block, as returned by lead-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("LeadRelationshipResponse") } } },
    ...relationshipErrors,
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/catalogue/pipes/{pipeId}/default-play",
  tags: ["Features"],
  summary: "Set the play a pipe runs by default (staff only)",
  description:
    "Fleet-wide: the strategy a pipe runs when a campaign names no play. Staff only: a distribute.you staff member's own " +
    "API key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. `decidedBy` is recorded as " +
    "the authenticated staff email (a body value is ignored). A strategy whose play runs nothing is refused 409 " +
    "`default_play_runs_nothing`. Byte passthrough to features-service PUT /internal/catalogue/pipes/{pipeId}/default-play.",
  security: platformAuth,
  request: {
    params: z.object({ pipeId: z.string().openapi({ description: "a pipe id `<channel slug>|<leg key>` (GET /v1/catalogue/pipes)" }) }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ strategyId: z.string().openapi({ description: "The strategy (GET /v1/strategies) the pipe runs by default" }) })
            .passthrough()
            .openapi("PipeDefaultPlayRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Pass-through from features-service", content: { "application/json": { schema: z.object({}).passthrough().openapi("PipeDefaultPlayResponse") } } },
    400: { description: "Invalid request (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff (`staff_only`)", content: errorContent },
    404: { description: "Unknown pipe or strategy (forwarded verbatim)", content: errorContent },
    409: { description: "`default_play_runs_nothing` (forwarded verbatim)", content: errorContent },
    502: { description: "Upstream error", content: errorContent },
  },
});

// ---------------------------------------------------------------------------
// Staff status of templates and writer models, a template's last outputs, and the
// retire-by-content action that stops every workflow using one (TEMPLATE-MODEL-STATUS-1019).
// ---------------------------------------------------------------------------

const catalogueStatusNote =
  "Staff only: a distribute.you staff member's own key, or the platform key with a staff x-email; any other key " +
  "gets 403 `staff_only`. Cross-org: one status for every client. Byte passthrough, refusals forwarded verbatim.";

const CatalogueStatusRequestSchema = z
  .object({
    status: z.string().describe("\"active\" or \"deprecated\". Validated by content-generation-service."),
    reason: z
      .string()
      .optional()
      .describe(
        "Why. REQUIRED to deprecate (content-generation-service answers 400 `DEPRECATION_REASON_REQUIRED` without it). " +
          "Who deprecated is recorded from the verified staff identity, never from the body.",
      ),
  })
  .passthrough()
  .openapi("CatalogueStatusRequest");

const catalogueStatusResponses = (what: string) => ({
  200: { description: `${what} (pass-through from content-generation-service)`, content: { "application/json": { schema: z.object({}).passthrough() } } },
  400: { description: "Missing or unknown status, or a deprecation without `reason` (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Not staff", content: errorContent },
  404: { description: "Unknown model or template (forwarded verbatim)", content: errorContent },
});

registry.registerPath({
  method: "get",
  path: "/v1/content/models",
  tags: ["Content"],
  summary: "Every writer model alias with its staff status (staff only)",
  description: `${catalogueStatusNote} Proxies content-generation-service GET /internal/models. Answers \`{ models: [...] }\`.`,
  security: platformAuth,
  responses: {
    200: { description: "All model aliases", content: { "application/json": { schema: z.object({}).passthrough().openapi("ContentModelStatusList") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/content/models/{model}/status",
  tags: ["Content"],
  summary: "Set a writer model's status, active or deprecated (staff only)",
  description:
    `${catalogueStatusNote} Proxies content-generation-service PUT /internal/models/{model}/status. Changes the status ` +
    "only: a stored workflow using the model keeps writing with it. Stop those workflows with POST /v1/workflows/retire-by-content " +
    "(`dryRun: true` first to list them). Re-activating brings no workflow back.",
  security: platformAuth,
  request: {
    params: z.object({ model: z.string().describe("Model alias, e.g. `glm-pro`") }),
    body: { content: { "application/json": { schema: CatalogueStatusRequestSchema } } },
  },
  responses: catalogueStatusResponses("Status set"),
});

registry.registerPath({
  method: "get",
  path: "/v1/content/templates",
  tags: ["Content"],
  summary: "Every stored template type with its staff status (staff only)",
  description: `${catalogueStatusNote} Proxies content-generation-service GET /internal/templates. Answers \`{ templates: [...] }\`.`,
  security: platformAuth,
  responses: {
    200: { description: "All templates", content: { "application/json": { schema: z.object({}).passthrough().openapi("ContentTemplateStatusList") } } },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/content/templates/{type}/status",
  tags: ["Content"],
  summary: "Set a template's status, active or deprecated (staff only)",
  description:
    `${catalogueStatusNote} Proxies content-generation-service PUT /internal/templates/{type}/status. Changes the status ` +
    "only: the template text is untouched and a stored workflow using it keeps rendering it. Stop those workflows with " +
    "POST /v1/workflows/retire-by-content (`dryRun: true` first to list them). Re-activating brings no workflow back.",
  security: platformAuth,
  request: {
    params: z.object({ type: z.string().describe("Template type, e.g. `cold-email-v59`") }),
    body: { content: { "application/json": { schema: CatalogueStatusRequestSchema } } },
  },
  responses: catalogueStatusResponses("Status set"),
});

registry.registerPath({
  method: "get",
  path: "/v1/content/templates/{type}/outputs",
  tags: ["Content"],
  summary: "The last outputs written with a template, newest first (staff only)",
  description:
    `${catalogueStatusNote} Proxies content-generation-service GET /internal/templates/{type}/outputs, query string verbatim. ` +
    "Every org; per output the subject, each email's text, when, workflow and model (never org/lead ids or the raw prompt). " +
    "`limit` defaults to 5 at the producer.",
  security: platformAuth,
  request: {
    params: z.object({ type: z.string().describe("Template type, e.g. `cold-email-v59`") }),
    query: z.object({ limit: z.string().optional().describe("How many outputs (producer default 5, producer bounds)") }).passthrough(),
  },
  responses: {
    200: { description: "Outputs", content: { "application/json": { schema: z.object({}).passthrough().openapi("ContentTemplateOutputs") } } },
    400: { description: "Bad limit (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "No template of that type (forwarded verbatim)", content: errorContent },
  },
});

const templateDynastyNote =
  "Staff only: a distribute.you staff member's own key, or the platform key with a staff x-email; any other key gets 403 `staff_only`. " +
  "A template dynasty is one kind of email on one pipe (feature + leg), cross-org: its versions are template types, the head (latest) is what " +
  "workflows on that dynasty write with, and stats pool across versions. Byte passthrough to content-generation-service, refusals forwarded verbatim.";

const templateDynastyErrors = {
  400: { description: "Invalid body or query (forwarded verbatim)", content: errorContent },
  401: { description: "Unauthorized", content: errorContent },
  403: { description: "Not staff", content: errorContent },
};

registry.registerPath({
  method: "post",
  path: "/v1/content/platform-prompts",
  tags: ["Content"],
  summary: "Store a brand-new template text (staff only)",
  description:
    "Store a NEW email template text under a new `type`, so a new template dynasty can point to it (POST /v1/content/template-dynasties) " +
    "or an existing dynasty can append it as its head (POST /v1/content/template-dynasties/{slug}/versions with `type`). " +
    "Body `{ type, prompt, variables: [{ name, description }] }`; the text uses only `{{variables}}`, never company-specific data " +
    "(422 when content-generation-service judges it is not brand-neutral). Idempotent per type: 201 stored, 200 when that type already exists (unchanged). " +
    "Proxies content-generation-service POST /platform-prompts. " + templateDynastyNote,
  security: platformAuth,
  request: { body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("StoreTemplateRequest") } } } },
  responses: {
    200: { description: "Type already stored (unchanged)", content: { "application/json": { schema: z.object({}).passthrough() } } },
    201: { description: "Template stored", content: { "application/json": { schema: z.object({}).passthrough().openapi("StoredTemplate") } } },
    ...templateDynastyErrors,
    422: { description: "Template refused (not brand-neutral), forwarded verbatim", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/content/template-dynasties",
  tags: ["Content"],
  summary: "List template dynasties (staff only)",
  description:
    "Every template dynasty with its versions and head, optionally narrowed by `featureSlug` and `legKey` (query forwarded verbatim). " +
    "Answers `{ dynasties: [...] }`. Proxies content-generation-service GET /internal/template-dynasties. " + templateDynastyNote,
  security: platformAuth,
  request: {
    query: z
      .object({
        featureSlug: z.string().optional().describe("Only dynasties of this feature"),
        legKey: z.string().optional().describe("Only dynasties on this leg"),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "Template dynasties", content: { "application/json": { schema: z.object({}).passthrough().openapi("TemplateDynastyList") } } },
    ...templateDynastyErrors,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/content/template-dynasties",
  tags: ["Content"],
  summary: "Create a new template dynasty (staff only)",
  description:
    "Create a NEW template dynasty: a new kind of email on one pipe (`featureSlug` + `legKey`), e.g. a new short cold email on the website-visit leg. " +
    "Body `{ slug, name, description, signature, identity: blind | named, featureSlug, legKey }` plus EXACTLY ONE of: " +
    "`template: { prompt, variables: [{ name, description }], type? }` = a BRAND-NEW text stored as the first version and head in the same call " +
    "(`type` defaults to `<slug>-v1`; `variables` exactly the text's {{tokens}}), or `versions: [type, ...]` = ALREADY-STORED template types, oldest first, the last is the head. " +
    "`description` is one client-facing sentence, `signature` the internal guideline; name, description and signature are unique. Answers 201 with the dynasty. " +
    "Refusals forwarded verbatim, nothing stored: 400 invalid body / both or neither form / `VARIABLES_MISMATCH`; 409 `DYNASTY_CONFLICT` / `TEMPLATE_TYPE_TAKEN` / `TEMPLATE_TWIN`; " +
    "422 `TEMPLATE_NOT_NEUTRAL` / `BLIND_TEMPLATE_REVEALS_CLIENT`. Proxies POST /internal/template-dynasties. " + templateDynastyNote,
  security: platformAuth,
  request: { body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("CreateTemplateDynastyRequest") } } } },
  responses: {
    201: { description: "Dynasty created", content: { "application/json": { schema: z.object({}).passthrough().openapi("TemplateDynasty") } } },
    ...templateDynastyErrors,
    404: { description: "A listed template type does not exist (forwarded verbatim)", content: errorContent },
    409: { description: "DYNASTY_CONFLICT / TEMPLATE_TYPE_TAKEN / TEMPLATE_TWIN (forwarded verbatim)", content: errorContent },
    422: { description: "TEMPLATE_NOT_NEUTRAL / BLIND_TEMPLATE_REVEALS_CLIENT (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/content/template-dynasties/{slug}",
  tags: ["Content"],
  summary: "Read one template dynasty with its versions (staff only)",
  description:
    "One template dynasty: name, description, signature, identity, pipe, head and every version with its status. " +
    "Proxies content-generation-service GET /internal/template-dynasties/{slug}. " + templateDynastyNote,
  security: platformAuth,
  request: { params: z.object({ slug: z.string().describe("Dynasty slug") }) },
  responses: {
    200: { description: "The dynasty", content: { "application/json": { schema: z.object({}).passthrough() } } },
    ...templateDynastyErrors,
    404: { description: "DYNASTY_NOT_FOUND (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/content/template-dynasties/{slug}/head",
  tags: ["Content"],
  summary: "Resolve a template dynasty's head template (staff only)",
  description:
    "The template the dynasty's workflows write with now: `{ dynasty, template }`, `template` = the head's full text and variables. " +
    "Proxies content-generation-service GET /internal/template-dynasties/{slug}/head. " + templateDynastyNote,
  security: platformAuth,
  request: { params: z.object({ slug: z.string().describe("Dynasty slug") }) },
  responses: {
    200: { description: "Dynasty + head template", content: { "application/json": { schema: z.object({}).passthrough() } } },
    ...templateDynastyErrors,
    404: { description: "DYNASTY_NOT_FOUND (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/content/template-dynasties/{slug}/outputs",
  tags: ["Content"],
  summary: "The last email sequences written with a template dynasty, any version, newest first (staff only)",
  description:
    "Every org; per output the generation id, when, the exact template version (`promptType`), workflow, model, subject and each email's text + delay " +
    "(never org/lead ids or the raw prompt). `limit` 1..20, default 5 at the producer. " +
    "Proxies content-generation-service GET /internal/template-dynasties/{slug}/outputs, query string verbatim. " + templateDynastyNote,
  security: platformAuth,
  request: {
    params: z.object({ slug: z.string().describe("Dynasty slug") }),
    query: z.object({ limit: z.string().optional().describe("How many outputs (producer default 5, producer bounds)") }).passthrough(),
  },
  responses: {
    200: { description: "`{ slug, outputs }`", content: { "application/json": { schema: z.object({}).passthrough().openapi("TemplateDynastyOutputs") } } },
    ...templateDynastyErrors,
    400: { description: "Bad limit (forwarded verbatim)", content: errorContent },
    404: { description: "DYNASTY_NOT_FOUND (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/content/workflow-dynasties/{slug}/outputs",
  tags: ["Content"],
  summary: "The last email sequences written by a workflow dynasty, every version, newest first (staff only)",
  description:
    "Every org; per output the generation id, when, the workflow run id, the exact workflow version (`workflowSlug`), the template version (`promptType`, nullable) " +
    "and its template dynasty (`{ slug, name, position }` or null), the model, subject and each email's text + delay (never org/lead ids or the raw prompt). " +
    "Empty `outputs` for a dynasty never run. `limit` 1..50, default 20 at the producer. " +
    "Proxies content-generation-service GET /internal/workflow-dynasties/{slug}/outputs, query string verbatim.",
  security: platformAuth,
  request: {
    params: z.object({ slug: z.string().describe("Workflow dynasty slug") }),
    query: z.object({ limit: z.string().optional().describe("How many outputs (producer default 20, producer bounds)") }).passthrough(),
  },
  responses: {
    200: { description: "`{ slug, outputs }`", content: { "application/json": { schema: z.object({}).passthrough().openapi("WorkflowDynastyOutputs") } } },
    ...templateDynastyErrors,
    400: { description: "Bad limit (forwarded verbatim)", content: errorContent },
    502: { description: "workflow-service could not resolve the dynasty versions (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/content/model-dynasties/{slug}/outputs",
  tags: ["Content"],
  summary: "The last emails one LLM dynasty (every version) wrote on one pipe, newest first (staff only)",
  description:
    "Every org; `{ slug, name, featureSlug, legKey, modelIds, outputs }`, per output the generation id, when, channel, workflow version (`workflowSlug`), " +
    "template version (`promptType`) and its template dynasty (`{ slug, name, position }`), the exact model, tokens, subject and each email's text + delay " +
    "(never org/lead ids or the raw prompt). `featureSlug` + `legKey` required (400 at the producer), `limit` 1..20, default 5 at the producer. " +
    "Proxies content-generation-service GET /internal/model-dynasties/{slug}/outputs, query string verbatim.",
  security: platformAuth,
  request: {
    params: z.object({ slug: z.string().describe("LLM dynasty slug (e.g. gemini-pro)") }),
    query: z
      .object({
        featureSlug: z.string().optional().describe("Pipe feature slug (required by the producer)"),
        legKey: z.string().optional().describe("Pipe leg key (required by the producer)"),
        limit: z.string().optional().describe("How many outputs (producer default 5, producer bounds)"),
      })
      .passthrough(),
  },
  responses: {
    200: { description: "`{ slug, name, featureSlug, legKey, modelIds, outputs }`", content: { "application/json": { schema: z.object({}).passthrough().openapi("ModelDynastyOutputs") } } },
    400: { description: "Missing featureSlug/legKey or bad limit (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
    404: { description: "MODEL_DYNASTY_NOT_FOUND (forwarded verbatim)", content: errorContent },
    502: { description: "MODEL_CATALOGUE_UNAVAILABLE (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/content/template-dynasties/{slug}/versions",
  tags: ["Content"],
  summary: "Add a new version (new head) to a template dynasty (staff only)",
  description:
    "Upgrade a template dynasty: either a new text `{ prompt, variables }` or an already-stored template `{ type }` becomes the head, " +
    "and every workflow on the dynasty writes with it. The previous head is marked deprecated \"Upgraded\" by the verified staff member. " +
    "Refusals forwarded verbatim: 409 `TEMPLATE_TWIN` (text identical to a stored template), 400 `VARIABLE_NOT_IN_HEAD` / `VARIABLES_MISMATCH`, " +
    "422 brand/offer neutrality or the blind rule. Answers 201 `{ dynasty, template }`. " +
    "Proxies content-generation-service POST /internal/template-dynasties/{slug}/versions. " + templateDynastyNote,
  security: platformAuth,
  request: {
    params: z.object({ slug: z.string().describe("Dynasty slug") }),
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("AddTemplateDynastyVersionRequest") } } },
  },
  responses: {
    201: { description: "New head", content: { "application/json": { schema: z.object({}).passthrough() } } },
    ...templateDynastyErrors,
    404: { description: "DYNASTY_NOT_FOUND (forwarded verbatim)", content: errorContent },
    409: { description: "TEMPLATE_TWIN (forwarded verbatim)", content: errorContent },
    422: { description: "Neutrality / blind rule refusal (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/content/template-dynasties/{slug}/merge",
  tags: ["Content"],
  summary: "Merge a template dynasty into another of the same pipe and identity (staff only)",
  description:
    "Fold dynasty {slug} INTO `into`: every version of {slug} becomes an OLDER version of `into`, deprecated (a still-active one with reason " +
    "`Merged into <into>: <reason>`), so `into`'s head and what its workflows write with never change. {slug} then leaves the dynasty list, its slug " +
    "resolves to `into`, and its stats/outputs read as `into`'s. The verified staff member is recorded as who merged. Refusals forwarded verbatim: " +
    "409 `DIFFERENT_PIPE` / `DIFFERENT_IDENTITY` (blind and named are never merged) / `DYNASTY_MERGED`, 400 `SAME_DYNASTY` / blank reason, 404 `DYNASTY_NOT_FOUND`. " +
    "Answers 200 `{ merged, movedVersions, deprecated, dynasty }`. " +
    "Proxies content-generation-service POST /internal/template-dynasties/{slug}/merge. " + templateDynastyNote,
  security: platformAuth,
  request: {
    params: z.object({ slug: z.string().describe("Slug of the dynasty to merge (the source)") }),
    body: { content: { "application/json": { schema: z.object({}).passthrough().openapi("MergeTemplateDynastyRequest") } } },
  },
  responses: {
    200: { description: "Merged", content: { "application/json": { schema: z.object({}).passthrough() } } },
    ...templateDynastyErrors,
    404: { description: "DYNASTY_NOT_FOUND (forwarded verbatim)", content: errorContent },
    409: { description: "DIFFERENT_PIPE / DIFFERENT_IDENTITY / DYNASTY_MERGED (forwarded verbatim)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/workflows/retire-by-content",
  tags: ["Workflows"],
  summary: "Retire every workflow running a template or a model (staff only)",
  description:
    "Finds every RUNNABLE workflow (version active, dynasty active) whose content call renders `promptType` or writes with " +
    "`model` (optionally narrowed by `featureSlug`) and retires each whole dynasty, exactly like " +
    "PUT /v1/workflows/dynasty/{workflowDynastySlug}/status with `deprecated`. `dryRun: true` lists them and retires nothing: " +
    "show that list before deprecating a template or model. No reverse: each workflow is re-activated by hand. Idempotent. " +
    "Staff only: retiring stops the workflow for every client; a staff member's own key or the platform key with a staff " +
    "x-email, any other key gets 403 `staff_only`. Byte passthrough to workflow-service POST /workflows/retire-by-content.",
  security: platformAuth,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              promptType: z.string().optional().describe("Template type, e.g. `cold-email-v59` (give this or `model`)"),
              model: z.string().optional().describe("Writer model alias, e.g. `glm-pro` (give this or `promptType`)"),
              featureSlug: z.string().optional().describe("Only workflows of this feature"),
              dryRun: z.boolean().optional().describe("true = list only, retire nothing"),
              reason: deprecationReasonField,
              decidedBy: deprecationDecidedByField,
            })
            .passthrough()
            .openapi("RetireWorkflowsByContentRequest"),
        },
      },
    },
  },
  responses: {
    200: { description: "Workflows listed (dryRun) or retired (pass-through from workflow-service)", content: { "application/json": { schema: z.object({}).passthrough().openapi("RetireWorkflowsByContentResponse") } } },
    400: { description: "Invalid body (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Not staff", content: errorContent },
  },
});
