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

// The gateway declares ONLY the fields it needs for its own work: the required-field
// check it 400s on, the brandUrls→brandIds upsert, the workflow slug it derives the
// campaign type + tracking header from, and the featureInputs it key-presence-validates
// against features-service. Everything else campaign-service accepts — `funnelKey`, and
// any field it adds next — rides through `.passthrough()` untouched. A whitelist here
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
  // Forward every other field campaign-service accepts — `funnelKey` (the sales funnel a
  // sales campaign is paced and priced on) and whatever it adds next — byte-identical.
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
    "campaign-service accepts is forwarded unchanged. A sales-outreach campaign must state the sales funnel it " +
    "sells as `funnelKey` (`reply_meeting` | `visit_meeting` | `visit_signup` | `visit_form`) — that is what the " +
    "campaign is paced and priced on. The gateway neither infers nor defaults one: state no funnel on a sales " +
    "feature and campaign-service's own 400 comes back verbatim.",
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
    "Get campaign statistics (leads served/buffered/skipped, apollo metrics, emails sent/opened/clicked, reply aggregates, etc.)",
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
                  recipientStats: RecipientStatsSchema,
                  emailStats: EmailStatsSchema,
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

export const IcpSuggestionRequestSchema = z
  .object({
    brandUrl: z.string().min(1).describe("Brand website URL"),
  })
  .openapi("IcpSuggestionRequest");

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
          schema: z.object({}).passthrough().openapi("IcpSuggestionResponse"),
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

// Brand – Sales Economics Effective (proxy to brand-service /orgs/brands/:id/sales-economics-effective)
// The brand's "gold" effective economics: its own saved economics, or the org's
// cross-brand average when the brand has saved nothing, plus a `source` provenance
// field. Downstream owns the response shape — passthrough only. Response is
// { economics: { ...5 metrics } | null, source: "user" | "cross-brand-average" | null }.
const SalesEconomicsEffectiveResponseSchema = z.object({}).passthrough().openapi("SalesEconomicsEffectiveResponse");

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/sales-economics-effective",
  tags: ["Brand"],
  summary: "Get a brand's effective sales conversion-economics",
  description:
    "Proxy to brand-service GET /orgs/brands/{id}/sales-economics-effective. " +
    "Returns the brand's effective sales conversion-economics (lifetimeRevenueUsd, " +
    "replyToMeetingPct, visitToMeetingPct, meetingToClosePct, visitToClosePct): the " +
    "brand's own saved economics, or the org's cross-brand average when the brand has " +
    "saved nothing, plus a `source` field (\"user\" | \"cross-brand-average\" | null). " +
    "Used to prefill the new-campaign sales-economics inputs. " +
    "Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "Effective sales economics (or null)", content: { "application/json": { schema: SalesEconomicsEffectiveResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// Brand – Sales Economics (proxy to brand-service /orgs/brands/:id/sales-economics)
// Downstream owns body + response shapes — passthrough only. No gateway re-validation,
// so brand-service's 4xx validation errors propagate verbatim.
// PUT body carries 5 required metrics: lifetimeRevenueUsd, replyToMeetingPct,
// visitToMeetingPct, meetingToClosePct, visitToClosePct (all integers).
// GET response is { salesEconomics: null | { ...5 metrics, updatedAt } }.
const SalesEconomicsResponseSchema = z.object({}).passthrough().openapi("SalesEconomicsResponse");
const SalesEconomicsRequestSchema = z.object({}).passthrough().openapi("SalesEconomicsRequest");

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/sales-economics",
  tags: ["Brand"],
  summary: "Get a brand's sales conversion-economics metrics",
  description:
    "Proxy to brand-service GET /orgs/brands/{id}/sales-economics. " +
    "Returns the brand's 5 sales conversion-economics metrics " +
    "(lifetimeRevenueUsd, replyToMeetingPct, visitToMeetingPct, meetingToClosePct, " +
    "visitToClosePct) plus updatedAt, or { salesEconomics: null } when unset. " +
    "Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "Sales economics (or null when unset)", content: { "application/json": { schema: SalesEconomicsResponseSchema } } },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/sales-economics",
  tags: ["Brand"],
  summary: "Save a brand's sales conversion-economics metrics",
  description:
    "Proxy to brand-service PUT /orgs/brands/{id}/sales-economics. " +
    "Saves the brand's 5 sales conversion-economics metrics (lifetimeRevenueUsd, " +
    "replyToMeetingPct, visitToMeetingPct, meetingToClosePct, visitToClosePct — all required). " +
    "Body + response shapes are owned by the downstream service; its 4xx validation " +
    "errors propagate verbatim.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: SalesEconomicsRequestSchema } } },
  },
  responses: {
    200: { description: "Sales economics saved", content: { "application/json": { schema: SalesEconomicsResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

// ===================================================================
// Brand – Sales Funnels (proxy to brand-service /orgs/brands/:id/sales-funnels[/:funnelKey])
// The funnels a brand DECLARES it sells through, each carrying its own economics.
// Downstream owns body + response shapes — passthrough only, no gateway
// re-validation, so brand-service's 4xx propagate verbatim.
//
// The read answers { declared, funnels }, and `declared` is load-bearing:
// `declared: false` with an empty list means no set has ever been stated,
// `declared: true` with an empty list means the brand stated it sells through
// none. Opposite answers, and the flag is the only thing separating them.
//
// The service-auth GET /internal/brands/{id}/sales-funnels is NOT proxied:
// features-service reads it service-to-service.
// ===================================================================
const SalesFunnelsResponseSchema = z.object({}).passthrough().openapi("SalesFunnelsResponse");
const SalesFunnelsSetRequestSchema = z.object({}).passthrough().openapi("SalesFunnelsSetRequest");
const SalesFunnelRequestSchema = z.object({}).passthrough().openapi("SalesFunnelRequest");

const BrandFunnelKeyParams = z.object({
  id: z.string().describe("Brand ID"),
  funnelKey: z
    .string()
    .describe("Funnel key: reply_meeting | visit_meeting | visit_signup | visit_form"),
});

registry.registerPath({
  method: "get",
  path: "/v1/brands/{id}/sales-funnels",
  tags: ["Brand"],
  summary: "Get the sales funnels a brand has declared it sells through",
  description:
    "Proxy to brand-service GET /orgs/brands/{id}/sales-funnels. Returns " +
    "{ declared, funnels }: the funnels the brand declared, in catalogue order, each with " +
    "its own conversion rates, lifetime revenue, landing page and booking link. Read " +
    "`declared` BEFORE `funnels` — `declared: true` with an empty list means the brand " +
    "STATED it sells through none, while `declared: false` means it has never told us " +
    "anything. Nothing is defaulted: a value the brand never declared reads null, which " +
    "never means zero. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandIdParam },
  responses: {
    200: { description: "The declared funnels (possibly empty)", content: { "application/json": { schema: SalesFunnelsResponseSchema } } },
    400: { description: "Invalid brand ID format (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/sales-funnels",
  tags: ["Brand"],
  summary: "State the whole set of funnels a brand sells through",
  description:
    "Proxy to brand-service PUT /orgs/brands/{id}/sales-funnels. States the WHOLE set at " +
    "once (body { funnelKeys }): exactly these funnels, no others. Funnels already in the " +
    "set keep the economics they were priced with; funnels dropped from it lose their " +
    "declaration and their economics together. `{ \"funnelKeys\": [] }` is legal and is the " +
    "only way a brand can state it sells through NOTHING. The set is validated whole before " +
    "anything is written, so a rejected set leaves nothing half-applied. Body + response " +
    "shapes are owned by the downstream service; its 4xx propagate verbatim.",
  security: authed,
  request: {
    params: BrandIdParam,
    body: { content: { "application/json": { schema: SalesFunnelsSetRequestSchema } } },
  },
  responses: {
    200: { description: "The stated set", content: { "application/json": { schema: SalesFunnelsResponseSchema } } },
    400: { description: "Invalid brand ID, unknown funnel key, or a website-led funnel on a brand with no website (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{id}/sales-funnels/{funnelKey}",
  tags: ["Brand"],
  summary: "Declare a sales funnel and write its economics",
  description:
    "Proxy to brand-service PUT /orgs/brands/{id}/sales-funnels/{funnelKey}. Declares that " +
    "the brand sells through this funnel and writes what the body carries of its economics. " +
    "Idempotent — the declaration IS the row, and a body with no fields declares the funnel " +
    "without pricing it yet. PARTIAL: an omitted field is left exactly as stored, an explicit " +
    "null CLEARS the value back to never-declared. brand-service rejects a rate outside this " +
    "funnel's own chain, a destination the funnel has no use for, an off-domain page " +
    "destination, and a website-led funnel on a brand with no website; the gateway adds no " +
    "validation of its own. Body + response shapes are owned by the downstream service.",
  security: authed,
  request: {
    params: BrandFunnelKeyParams,
    body: { content: { "application/json": { schema: SalesFunnelRequestSchema } } },
  },
  responses: {
    200: { description: "The declared funnel", content: { "application/json": { schema: SalesFunnelsResponseSchema } } },
    400: { description: "Invalid brand ID or funnel key, a rate outside this funnel's chain, a destination the funnel has no use for, or a website-led funnel on a brand with no website (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/brands/{id}/sales-funnels/{funnelKey}",
  tags: ["Brand"],
  summary: "Undeclare a sales funnel",
  description:
    "Proxy to brand-service DELETE /orgs/brands/{id}/sales-funnels/{funnelKey}. The brand no " +
    "longer sells through this funnel, and removing the declaration removes its economics " +
    "with it. Idempotent — undeclaring a funnel that was never declared is a 200 with the " +
    "unchanged set. Does NOT un-state the set: a brand that removes its LAST funnel keeps " +
    "`declared: true`, because it has stated it sells through none. Returns the set that is " +
    "left. Response shape is owned by the downstream service.",
  security: authed,
  request: { params: BrandFunnelKeyParams },
  responses: {
    200: { description: "The funnels still declared", content: { "application/json": { schema: SalesFunnelsResponseSchema } } },
    400: { description: "Invalid brand ID format or unknown funnel key (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    403: { description: "Brand does not belong to the caller's org (forwarded verbatim)", content: errorContent },
    404: { description: "Brand not found (forwarded verbatim)", content: errorContent },
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
    "Get cost statistics grouped by a dimension. Supports groupBy=brandId, costName, campaignId, serviceName, workflowDynastySlug. Filter by brandId, campaignId, taskName, workflowSlug, featureSlug, workflowDynastySlug, startedAfter, startedBefore.",
  security: authed,
  request: {
    query: z.object({
      groupBy: z.string().describe("Grouping dimension: brandId, costName, campaignId, serviceName, workflowDynastySlug"),
      brandId: z.string().optional().describe("Filter by brand ID"),
      campaignId: z.string().optional().describe("Filter by campaign ID"),
      taskName: z.string().optional().describe("Filter by task name (e.g. lead-serve)"),
      workflowSlug: z.string().optional().describe("Filter by exact workflow slug"),
      featureSlug: z.string().optional().describe("Filter by exact feature slug"),
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

// Brand – Per-funnel Daily Budgets (proxy to billing-service)
// A brand can fund each of its sales funnels separately: one daily ceiling per funnel
// instead of a single brand-level pot. Once per-funnel ceilings exist the brand-level
// daily budget is their SUM and PATCH /v1/brands/{brandId}/daily-budget is refused (409).
// billing owns the funnel-key vocabulary, the per-funnel product minimums and the
// atomic all-or-nothing write — the gateway declares none of it (CLAUDE.md #4/#8).
const BrandFunnelBudgetsParam = z.object({
  brandId: z.string().uuid().describe("Brand ID"),
});
const BrandFunnelBudgetParam = z.object({
  brandId: z.string().uuid().describe("Brand ID"),
  funnelKey: z.string().describe("Sales-funnel key — vocabulary owned by billing-service"),
});
const FunnelBudgetsResponseSchema = z.object({}).passthrough().openapi("FunnelBudgetsResponse");
const FunnelBudgetsRequestSchema = z.object({}).passthrough().openapi("FunnelBudgetsRequest");
const FunnelBudgetRequestSchema = z.object({}).passthrough().openapi("FunnelBudgetRequest");

registry.registerPath({
  method: "get",
  path: "/v1/brands/{brandId}/funnel-budgets",
  tags: ["Billing"],
  summary: "Get a brand's per-funnel daily budgets",
  description:
    "Proxy to billing-service GET /v1/brands/{brandId}/funnel-budgets. " +
    "Returns the calling org's per-funnel daily ceilings for the brand plus the brand-level " +
    "total. A brand with no per-funnel ceilings returns an empty funnel list. Response shape " +
    "is owned by the downstream service.",
  security: authed,
  request: { params: BrandFunnelBudgetsParam },
  responses: {
    200: { description: "Per-funnel ceilings + brand total", content: { "application/json": { schema: FunnelBudgetsResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/v1/brands/{brandId}/funnel-budgets",
  tags: ["Billing"],
  summary: "Set a brand's whole per-funnel daily budget set (atomic)",
  description:
    "Proxy to billing-service PUT /v1/brands/{brandId}/funnel-budgets. " +
    "Writes every per-funnel daily ceiling for this org + brand in one transaction — signup " +
    "checkout uses this. Body { funnels: [{ funnelKey, dailyBudgetCents }] }; funnel keys, " +
    "per-funnel minimums and the all-or-nothing semantics are owned by the downstream " +
    "service, which validates the payload. Its 4xx errors propagate verbatim.",
  security: authed,
  request: {
    params: BrandFunnelBudgetsParam,
    body: { content: { "application/json": { schema: FunnelBudgetsRequestSchema } } },
  },
  responses: {
    200: { description: "Stored per-funnel ceilings + the resulting brand total", content: { "application/json": { schema: FunnelBudgetsResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/brands/{brandId}/funnel-budgets/{funnelKey}",
  tags: ["Billing"],
  summary: "Set one funnel's daily budget for a brand",
  description:
    "Proxy to billing-service PATCH /v1/brands/{brandId}/funnel-budgets/{funnelKey}. " +
    "Sets a single sales funnel's daily spend ceiling — brand Settings changes them one at a " +
    "time; untouched funnels keep theirs. Body { dailyBudgetCents }. Funnel-key vocabulary and " +
    "per-funnel minimums are owned by the downstream service; its 4xx errors propagate verbatim.",
  security: authed,
  request: {
    params: BrandFunnelBudgetParam,
    body: { content: { "application/json": { schema: FunnelBudgetRequestSchema } } },
  },
  responses: {
    200: { description: "Stored per-funnel ceilings + the resulting brand total", content: { "application/json": { schema: FunnelBudgetsResponseSchema } } },
    400: { description: "Validation error (forwarded verbatim)", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    500: { description: "Upstream error", content: errorContent },
  },
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

const ManualQualificationStatusEnum = z.enum([
  "lead_interested",
  "lead_meeting_booked",
  "lead_closed",
  "lead_not_interested",
  "lead_wrong_person",
  "lead_neutral",
  "lead_out_of_office",
  "auto_reply_received",
]);

export const ManualQualificationCreateRequestSchema = z
  .object({
    campaign_id: z.string().min(1).describe("Logical campaign id (groups sub-campaigns for the same workflow run)"),
    email: z.string().email().describe("Lead email address"),
    status: ManualQualificationStatusEnum.describe(
      "Manual reply qualification status — mirrors Instantly webhook reply event_type values exactly. Set by a human via the dashboard when Instantly fails to detect a reply (e.g. reply received on a non-leurre email account).",
    ),
    notes: z.string().max(2000).optional().describe("Optional free-text human note for audit"),
  })
  .openapi("ManualQualificationCreateRequest");

registry.registerPath({
  method: "get",
  path: "/v1/emails",
  tags: ["Emails"],
  summary: "List generated emails by brand",
  description:
    "List all generated emails across campaigns for a brand. Returns the same enriched shape as GET /campaigns/{id}/emails. " +
    "Proxies to content-generation-service GET /generations with brandId filter.",
  security: authed,
  request: {
    query: z.object({
      brandId: z.string().uuid().openapi({ description: "Brand ID (required)" }),
      campaignId: z.string().uuid().optional().openapi({ description: "Optional campaign ID filter" }),
      limit: z.coerce.number().int().optional().openapi({ description: "Max results to return" }),
      offset: z.coerce.number().int().optional().openapi({ description: "Offset for pagination" }),
    }),
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
    "Returns { generation: null } when no email has been generated for the lead yet (a normal empty state, not an error).",
  security: authed,
  request: {
    params: z.object({
      leadId: z.string().openapi({ description: "Lead ID" }),
    }),
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
    "Transparent proxy to content-generation-service GET /generations/examples; body forwarded verbatim. " +
    "Each example carries the email fields plus scope ('brand'|'org'|'global') and brandName.",
  security: authed,
  request: {
    query: z.object({
      workflowSlug: z.string().openapi({ description: "Workflow slug (required)" }),
      brandId: z.string().uuid().optional().openapi({ description: "Optional brand ID for the brand-scoped cascade tier" }),
      limit: z.coerce.number().int().optional().openapi({ description: "Max examples to return" }),
    }),
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
    "Returns the caller-org's manual qualification history, sorted by `qualifiedAt` DESC. Optionally filter by " +
    "`campaign_id` and/or `email`. Cross-org rows are blocked at the instantly-service layer. " +
    "Transparent proxy to email-gateway → instantly-service; the response shape is owned upstream.",
  security: authed,
  request: {
    query: z.object({
      campaign_id: z.string().min(1).optional().describe("Filter by logical campaign id"),
      email: z.string().email().optional().describe("Filter by lead email"),
      limit: z.coerce.number().int().optional().describe("Max rows to return (upstream default 200, max 500)"),
    }),
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
  path: "/v1/features/{featureSlug}/goal-arbitration",
  tags: ["Features"],
  summary: "Feature goal arbitration",
  description:
    "The goal features-service elects for a brand out of the sales funnels that brand declared — the same arbitration campaign-service reads service-to-service, so a client can show the goal that actually runs instead of the brand's stored optimizationGoal. " +
    "Proxied to features-service GET /features/{featureSlug}/goal-arbitration; every query param is forwarded and the response shape is downstream-owned and passed through. " +
    "The upstream status AND body both survive: a 502 with reason='authorized_goals_unavailable' (this brand never stated a funnel set) is distinguishable from a 200 whose arbitration.reason='no_authorized_goals' (it stated it sells through none).",
  security: authed,
  request: {
    params: z.object({ featureSlug: z.string().openapi({ example: "sales-cold-email-outreach" }).describe("Feature slug") }),
    query: z.object({
      brandId: z.string().openapi({ example: "brand-uuid-123" }).describe("Brand UUID (required) — the authorized goal set and the economics are brand-scoped"),
      pricing: z.string().optional().openapi({ example: "net" }).describe("Pricing basis for every money metric: omit or 'gross' for undiscounted figures (default), 'net' for the org's discounted ones"),
    }),
  },
  responses: {
    200: { description: "Feature goal arbitration", content: { "application/json": { schema: z.object({}).passthrough().openapi("FeatureGoalArbitrationResponse") } } },
    400: { description: "Validation error", content: errorContent },
    401: { description: "Unauthorized", content: errorContent },
    404: { description: "Feature not found", content: errorContent },
    502: { description: "Downstream service error, or the brand's declared sales funnels could not be read", content: errorContent },
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
