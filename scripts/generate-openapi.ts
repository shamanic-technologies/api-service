import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "../src/schemas.js";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

const generator = new OpenApiGeneratorV3(registry.definitions);

const document = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title: "distribute API",
    description: `API Gateway for distribute.

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
| 502 | Identity resolution failed (internal service unreachable) |

`,
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
    { name: "User", description: "Current user information" },
    { name: "Campaigns", description: "Campaign management" },
    { name: "Leads", description: "Lead search" },
    { name: "Qualify", description: "Email reply qualification" },
    { name: "Brand", description: "Brand scraping and management" },
    { name: "Activity", description: "User activity tracking" },
    { name: "Chat", description: "AI chat with SSE streaming" },
    { name: "Billing", description: "Billing, credits, and checkout" },
    { name: "Internal", description: "Platform-level operations (API key auth, no identity headers)" },
    { name: "Platform", description: "Service discovery and platform configuration" },
  ],
});

// ---------------------------------------------------------------------------
// Post-process: add x-org-id / x-user-id header parameters to every
// authenticated operation so they are visible per-endpoint in API docs.
// ---------------------------------------------------------------------------
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
    schema: { type: "string" as const },
    description:
      "Brand ID. Automatically injected by workflow-service on workflow HTTP calls. " +
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

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
const methods: HttpMethod[] = ["get", "post", "put", "patch", "delete"];

if (document.paths) {
  for (const pathItem of Object.values(document.paths)) {
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as
        | { security?: unknown[]; parameters?: unknown[] }
        | undefined;
      if (operation?.security && operation.security.length > 0) {
        operation.parameters = [
          ...(operation.parameters ?? []),
          ...identityParams,
        ];
      }
    }
  }
}

const outputFile = join(projectRoot, "openapi.json");
fs.writeFileSync(outputFile, JSON.stringify(document, null, 2));
console.log("✅ api-service openapi.json generated");
