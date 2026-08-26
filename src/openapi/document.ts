import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "../schemas.js";
import { DEPRECATION_POLICY, MINIMUM_NOTICE_DAYS } from "../lib/deprecation.js";
import {
  ANONYMOUS_POLICY,
  AUTHENTICATED_POLICY,
  RATE_LIMIT_POLICY_HEADER,
} from "../lib/rate-limit.js";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
export const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete"];

interface OperationObject {
  operationId?: string;
  security?: unknown[];
  parameters?: unknown[];
  responses?: Record<string, { headers?: Record<string, unknown>; [k: string]: unknown }>;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// operationId
// ---------------------------------------------------------------------------

/** `platform-prices` → `PlatformPrices`, `openapi.json` → `OpenapiJson`. */
function pascal(segment: string): string {
  return segment
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/**
 * Derive a stable, unique `operationId` from the method and path.
 *
 * Every path segment is preserved (including the version prefix and every path
 * parameter name), so the id is a lossless function of `method + path`:
 *
 *   GET  /v1/campaigns/{id}/stats      → getV1CampaignsByIdStats
 *   POST /v1/orgs/audiences/{id}/refresh-count
 *                                      → postV1OrgsAudiencesByIdRefreshCount
 *   GET  /public/stats/users           → getPublicStatsUsers
 *   GET  /                             → getRoot
 *
 * Stability matters more than prettiness here: an LLM function-calling layer
 * binds a tool name to this string, so it must not move when an unrelated
 * operation is added, renamed or removed. Deriving it from the route the caller
 * already types gives exactly that — and it only changes when the route itself
 * changes, which is a breaking change for the caller regardless.
 */
export function deriveOperationId(method: string, path: string): string {
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith("{") && segment.endsWith("}")
        ? `By${pascal(segment.slice(1, -1))}`
        : pascal(segment),
    );
  // The root path has no segments; "get" alone is a poor tool name.
  return method.toLowerCase() + (parts.length ? parts.join("") : "Root");
}

// ---------------------------------------------------------------------------
// Shared parameter / response fragments
// ---------------------------------------------------------------------------

/**
 * Correlation id. Accepted on EVERY operation (public ones included) and echoed
 * back on the response — see `src/middleware/request-id.ts`.
 */
const requestIdParam = {
  name: "x-request-id",
  in: "header" as const,
  required: false,
  schema: { type: "string" as const, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" },
  description:
    "Correlation id for this request. Echoed back verbatim in the `x-request-id` response header. " +
    "Omit it and the gateway generates a UUID, so the response header is always present. " +
    "Useful for tying a response back to the call that produced it when issuing concurrent requests.",
};

const identityParams = [
  {
    name: "x-org-id",
    in: "header" as const,
    required: false,
    schema: { type: "string" as const },
    description:
      "External organization ID (e.g. Clerk org ID `org_2xyz...`). " +
      "Required when using an app key (`distrib.app_*`) on endpoints that need org context. " +
      "Ignored when using a user key (`distrib.usr_*`).",
  },
  {
    name: "x-user-id",
    in: "header" as const,
    required: false,
    schema: { type: "string" as const },
    description:
      "External user ID (e.g. Clerk user ID `user_2abc...`). " +
      "Required when using an app key (`distrib.app_*`) on endpoints that need user context. " +
      "Ignored when using a user key (`distrib.usr_*`).",
  },
  {
    name: "x-campaign-id",
    in: "header" as const,
    required: false,
    schema: { type: "string" as const },
    description:
      "Campaign ID. Automatically injected by workflow-service on workflow HTTP calls. " +
      "Optional — forwarded to downstream services for tracking.",
  },
  {
    name: "x-brand-id",
    in: "header" as const,
    required: false,
    schema: { type: "string" as const, example: "uuid1,uuid2,uuid3" },
    description:
      "Brand ID(s), comma-separated UUIDs. Supports multi-brand campaigns. " +
      "Automatically injected by workflow-service on workflow HTTP calls. " +
      "Optional — forwarded to downstream services for tracking.",
  },
  {
    name: "x-workflow-slug",
    in: "header" as const,
    required: false,
    schema: { type: "string" as const },
    description:
      "Workflow slug. Automatically injected by workflow-service on workflow HTTP calls. " +
      "Optional — forwarded to downstream services for tracking.",
  },
  {
    name: "x-feature-slug",
    in: "header" as const,
    required: false,
    schema: { type: "string" as const },
    description:
      "Feature slug. Optional — forwarded to downstream services and runs for tracking.",
  },
];

/** Rate-limit state headers, present on every response the gateway sends. */
const rateLimitResponseHeaders = {
  RateLimit: {
    description:
      "Current rate-limit state for this caller, e.g. `limit=600, remaining=597, reset=42`. " +
      "`reset` is seconds until the window rolls over.",
    schema: { type: "string" as const },
  },
  "RateLimit-Policy": {
    description:
      "Every budget this API applies, e.g. " +
      `\`${RATE_LIMIT_POLICY_HEADER}\` — \`q\` is requests per window, \`w\` is the window in seconds.`,
    schema: { type: "string" as const },
  },
  "RateLimit-Limit": {
    description: "Requests allowed in the current window.",
    schema: { type: "integer" as const },
  },
  "RateLimit-Remaining": {
    description: "Requests still available in the current window.",
    schema: { type: "integer" as const },
  },
  "RateLimit-Reset": {
    description: "Seconds until the current window resets.",
    schema: { type: "integer" as const },
  },
  "x-request-id": {
    description:
      "Correlation id — the `x-request-id` you sent, or one generated by the gateway.",
    schema: { type: "string" as const },
  },
};

/** Deprecation signals — documented on every operation so the policy is discoverable. */
const deprecationResponseHeaders = {
  Deprecation: {
    description:
      "Present ONLY on a deprecated operation. `@<unix-seconds>` (RFC 9745) — when the " +
      "operation was announced as deprecated. Absent means the operation is not deprecated.",
    schema: { type: "string" as const },
  },
  Sunset: {
    description:
      "Present ONLY on a deprecated operation. HTTP-date (RFC 8594) — the earliest date the " +
      `operation may stop working, never less than ${MINIMUM_NOTICE_DAYS} days after \`Deprecation\`.`,
    schema: { type: "string" as const },
  },
  Link: {
    description:
      'Present ONLY on a deprecated operation. `<url>; rel="deprecation"` — the replacement ' +
      "operation or the changelog entry.",
    schema: { type: "string" as const },
  },
};

/** Fresh object per operation — the post-processor mutates `headers` in place. */
const rateLimitedResponse = () => ({
  description:
    "Rate limit exceeded. Wait `Retry-After` seconds and retry; the budget that was exceeded " +
    "is named in the body and described in `RateLimit-Policy`.",
  headers: {
    "Retry-After": {
      description: "Seconds to wait before retrying.",
      schema: { type: "integer" as const },
    },
    ...rateLimitResponseHeaders,
  },
  content: {
    "application/json": {
      schema: {
        type: "object" as const,
        properties: {
          error: { type: "string" as const, example: "Rate limit exceeded" },
          code: { type: "string" as const, example: "RATE_LIMITED" },
          policy: { type: "string" as const, example: AUTHENTICATED_POLICY.name },
          limit: { type: "integer" as const, example: AUTHENTICATED_POLICY.limit },
          windowSeconds: {
            type: "integer" as const,
            example: AUTHENTICATED_POLICY.windowSeconds,
          },
          retryAfterSeconds: { type: "integer" as const, example: 42 },
        },
        required: ["error", "code", "retryAfterSeconds"],
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const DESCRIPTION = `API Gateway for distribute.

## Quick Start

1. Create an API key in the distribute dashboard, or via \`POST /v1/api-keys\`
2. Use it as a Bearer token — that's it, no extra headers needed

\`\`\`
Authorization: Bearer distrib.usr_abc123...
\`\`\`

Your key carries your org and user identity. All endpoints work out of the box.

## Storing provider keys (BYOK)

To store your own provider API keys (e.g. OpenAI, Anthropic) for use in workflows:

\`\`\`
POST /v1/keys
Authorization: Bearer distrib.usr_abc123...

{ "provider": "openai", "apiKey": "sk-..." }
\`\`\`

## Error codes

| Code | Meaning |
|------|---------|
| 401 | Missing or invalid Bearer token |
| 400 | Organization context required (missing \`x-org-id\` — app key only) |
| 429 | Rate limit exceeded — see below |
| 502 | Identity resolution failed (internal service unreachable) |

## Rate limits

Every response carries your current rate-limit state, so you never have to guess
how fast you may go:

\`\`\`
RateLimit: limit=${AUTHENTICATED_POLICY.limit}, remaining=${AUTHENTICATED_POLICY.limit - 3}, reset=42
RateLimit-Policy: ${RATE_LIMIT_POLICY_HEADER}
RateLimit-Limit: ${AUTHENTICATED_POLICY.limit}
RateLimit-Remaining: ${AUTHENTICATED_POLICY.limit - 3}
RateLimit-Reset: 42
\`\`\`

\`reset\` is **seconds until the current window rolls over**, not a timestamp.

| Policy | Applies to | Budget |
|--------|-----------|--------|
| \`${AUTHENTICATED_POLICY.name}\` | One API key (\`Authorization: Bearer distrib.*\`) | ${AUTHENTICATED_POLICY.limit} requests / ${AUTHENTICATED_POLICY.windowSeconds}s |
| \`${ANONYMOUS_POLICY.name}\` | One client IP, for endpoints that need no key | ${ANONYMOUS_POLICY.limit} requests / ${ANONYMOUS_POLICY.windowSeconds}s |

Exceeding a budget returns **429** with a \`Retry-After\` header in seconds. Wait
that long and retry — the window is fixed, so a single wait clears it. Requests
made while throttled still count, so back off rather than polling the 429.

## Deprecation policy

Nothing in this document is deprecated today. When something is, you learn it
mechanically, from the API itself, and with at least
**${MINIMUM_NOTICE_DAYS} days** of notice:

- The operation is marked \`deprecated: true\` in this document.
- Every response it returns carries \`Deprecation: @<unix-seconds>\` (RFC 9745)
  and \`Sunset: <HTTP-date>\` (RFC 8594). \`Sunset\` is the earliest date the
  operation may stop working — never sooner than ${MINIMUM_NOTICE_DAYS} days
  after \`Deprecation\`.
- A \`Link: <url>; rel="deprecation"\` header points at the replacement
  operation or the changelog entry.
- A deprecated operation keeps working until its sunset date. Deprecation is an
  announcement, not a removal.
- Removal happens only behind a new URL version prefix. \`/v1\` never changes
  meaning underneath a caller: a breaking change ships as \`/v2\`.

The same policy is machine-readable at the root of this document under
\`x-deprecation-policy\`.
`;

/**
 * Build the OpenAPI document.
 *
 * Exported (rather than inlined in the generate script) so tests can assert on
 * the document the build actually produces, not on a committed copy of it.
 */
export function buildDocument(): Record<string, unknown> {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  const document = generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "distribute API",
      description: DESCRIPTION,
      version: "1.0.0",
    },
    servers: [
      {
        url: process.env.SERVICE_URL || "https://api.distribute.you",
      },
    ],
    tags: [
      { name: "Health", description: "Health check and debug endpoints" },
      { name: "Authentication", description: "Create and manage your API keys" },
      { name: "Keys", description: "Provider key management" },
      { name: "Performance", description: "Public performance leaderboard" },
      { name: "Public Costs", description: "Public costs/pricing endpoints (no auth, used by landing pages)" },
      { name: "User", description: "Current user information" },
      { name: "Campaigns", description: "Campaign management" },
      { name: "Leads", description: "Lead search" },
      { name: "Qualify", description: "Email reply qualification" },
      { name: "Brand", description: "Brand management" },
      { name: "Scraping", description: "URL scraping via scraping-service" },
      { name: "Activity", description: "User activity tracking" },
      { name: "Chat", description: "AI chat with SSE streaming" },
      { name: "Billing", description: "Billing, credits, and checkout" },
      { name: "Instantly", description: "Instantly sending-infrastructure audit (staff-only, instantly-service proxy)" },
      { name: "Internal", description: "Platform-level operations (API key auth, no identity headers)" },
      { name: "Platform", description: "Service discovery and platform configuration" },
      { name: "Google CRM", description: "Google CRM (Gmail + People bronze) ingestion" },
      { name: "CRM Contacts", description: "Client B2C CRM CSV contact ingestion (crm-service proxy)" },
      { name: "Expert Quotes", description: "Expert quote outreach (journalists-quotes-service proxy)" },
      { name: "AI Visibility", description: "AI visibility-score audits (ai-visibility-score-service proxy)" },
      { name: "Invites", description: "Invite-only gate (Wave 0.5): validate codes, query org quota, claim rewards" },
      { name: "Waitlist", description: "Waitlist for users without an invite code" },
      { name: "Mailing Lists", description: "Staff mailing lists and written updates (transactional-email-service proxy, staff-only)" },
    ],
  }) as unknown as Record<string, unknown>;

  // Machine-readable deprecation/versioning policy at the document root.
  document["x-deprecation-policy"] = DEPRECATION_POLICY;

  postProcessOperations(document);

  return document;
}

/**
 * Post-process every operation in the document.
 *
 * This runs over whatever `registry.definitions` holds, so an operation added
 * later gets an `operationId`, the correlation-id parameter, the rate-limit
 * response headers and the 429 response without anyone remembering to add them
 * by hand. `tests/unit/openapi-agent-readiness.test.ts` fails the build if any
 * of that stops holding.
 */
export function postProcessOperations(document: Record<string, unknown>): void {
  const paths = document.paths as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return;

  const seenOperationIds = new Map<string, string>();

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as OperationObject | undefined;
      if (!operation) continue;

      // ── operationId ────────────────────────────────────────────────────────
      // An explicit id set on `registerPath` wins; otherwise derive one.
      const operationId = operation.operationId || deriveOperationId(method, path);
      const collision = seenOperationIds.get(operationId);
      if (collision) {
        throw new Error(
          `Duplicate operationId "${operationId}": ${collision} and ${method.toUpperCase()} ${path}. ` +
            "operationIds are the tool names an LLM function-calling layer binds to and must be unique. " +
            "Set an explicit operationId on one of the two registerPath() calls.",
        );
      }
      seenOperationIds.set(operationId, `${method.toUpperCase()} ${path}`);
      operation.operationId = operationId;

      // ── parameters ─────────────────────────────────────────────────────────
      // The correlation id is accepted on every operation, authenticated or not.
      // Identity headers only make sense where the operation authenticates.
      const extraParams: unknown[] = [requestIdParam];
      if (operation.security && operation.security.length > 0) {
        extraParams.push(...identityParams);
      }
      operation.parameters = [...(operation.parameters ?? []), ...extraParams];

      // ── responses ──────────────────────────────────────────────────────────
      const responses = (operation.responses ??= {});
      // Every operation goes through the limiter, so every operation can 429.
      // Added BEFORE the header pass so the 429 carries the same header set.
      responses["429"] ??= rateLimitedResponse();
      for (const response of Object.values(responses)) {
        if (!response || typeof response !== "object") continue;
        response.headers = {
          ...rateLimitResponseHeaders,
          ...deprecationResponseHeaders,
          ...(response.headers ?? {}),
        };
      }
    }
  }
}
