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
    title: "MCPFactory API Service",
    description: `API Gateway for MCPFactory. Handles authentication, proxies to internal services, and exposes the public REST API.

## Authentication

All authenticated endpoints require a Bearer token in the \`Authorization\` header.

There are two key types, each with different identity resolution behavior:

### 1. User key (\`mcpf_*\`)

Issued per-user via \`POST /v1/api-keys\`. The key already carries the user's internal org UUID — no extra headers needed.

\`\`\`
Authorization: Bearer mcpf_abc123...
\`\`\`

### 2. App key (\`mcpf_app_*\`)

Issued when an app registers via \`POST /v1/apps/register\`. The key identifies the **app**, not a user or org. To access endpoints that require org/user context (campaigns, keys, activity, etc.), you must also send two identity headers:

| Header | Description | Example |
|--------|-------------|---------|
| \`x-org-id\` | External organization ID (e.g. Clerk org ID) | \`org_2xyz...\` |
| \`x-user-id\` | External user ID (e.g. Clerk user ID) | \`user_2abc...\` |

\`\`\`
Authorization: Bearer mcpf_app_abc123...
x-org-id: org_2xyzABC
x-user-id: user_2abcDEF
\`\`\`

The API service resolves these external IDs to internal UUIDs via \`client-service\`. Both headers are **optional** — if omitted, the request proceeds without org/user context, which is fine for endpoints that only need app-level auth (e.g. \`GET /v1/me\`). But endpoints that require org context (e.g. \`GET /v1/campaigns\`) will return \`400 Organization context required\`.

### Error codes

| Code | Meaning |
|------|---------|
| 401 | Missing or invalid Bearer token |
| 400 | Org context required but \`x-org-id\` header not provided (app key only) |
| 401 | User identity required but \`x-user-id\` header not provided (app key only) |
| 502 | Identity resolution failed (client-service unreachable) |
`,
    version: "1.0.0",
  },
  servers: [
    {
      url: process.env.SERVICE_URL || "https://api.mcpfactory.org",
    },
  ],
  tags: [
    { name: "Health", description: "Health check and debug endpoints" },
    { name: "Apps", description: "App registration" },
    { name: "Performance", description: "Public performance leaderboard" },
    { name: "User", description: "Current user information" },
    { name: "Campaigns", description: "Campaign management" },
    { name: "Keys", description: "BYOK key management" },
    { name: "API Keys", description: "API key management" },
    { name: "Leads", description: "Lead search" },
    { name: "Qualify", description: "Email reply qualification" },
    { name: "Brand", description: "Brand scraping and management" },
    { name: "Activity", description: "User activity tracking" },
    { name: "Chat", description: "AI chat with SSE streaming" },
    { name: "Billing", description: "Billing, credits, and checkout" },
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
      "Required when using an app key (`mcpf_app_*`) on endpoints that need org context. " +
      "Ignored when using a user key (`mcpf_*`).",
  },
  {
    name: "x-user-id",
    in: "header" as const,
    required: false,
    schema: { type: "string" as const },
    description:
      "External user ID (e.g. Clerk user ID `user_2abc...`). " +
      "Required when using an app key (`mcpf_app_*`) on endpoints that need user context. " +
      "Ignored when using a user key (`mcpf_*`).",
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
