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

{ "keySource": "org", "provider": "openai", "apiKey": "sk-..." }
\`\`\`

## Error codes

| Code | Meaning |
|------|---------|
| 401 | Missing or invalid Bearer token |
| 400 | Organization context required (missing \`x-org-id\` — app key only) |
| 502 | Identity resolution failed (internal service unreachable) |

## Advanced: Platform integration

> Most users do not need this section. It is for multi-tenant platforms that manage keys on behalf of multiple organizations.

If you're building a platform that operates across multiple orgs/users, register via \`POST /v1/apps/register\` to receive an app key (\`distrib.app_*\`). App keys identify the **platform**, not a user or org. To access org-scoped endpoints, send identity headers:

\`\`\`
Authorization: Bearer distrib.app_abc123...
x-org-id: org_2xyzABC
x-user-id: user_2abcDEF
\`\`\`

The API resolves these external IDs (e.g. Clerk IDs) to internal UUIDs via client-service. Both headers are **optional** — omit them for endpoints that only need app-level auth.
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
    {
      name: "Keys",
      description: "Store and manage provider API keys (BYOK)",
    },
    { name: "Performance", description: "Public performance leaderboard" },
    { name: "User", description: "Current user information" },
    { name: "Campaigns", description: "Campaign management" },
    { name: "Leads", description: "Lead search" },
    { name: "Qualify", description: "Email reply qualification" },
    { name: "Brand", description: "Brand scraping and management" },
    { name: "Activity", description: "User activity tracking" },
    { name: "Chat", description: "AI chat with SSE streaming" },
    { name: "Billing", description: "Billing, credits, and checkout" },
    {
      name: "Platform",
      description: "Multi-tenant platform registration (advanced)",
    },
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
