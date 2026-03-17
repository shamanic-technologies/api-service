import { callExternalService, externalServices } from "./lib/service-client.js";

// ── Platform keys ────────────────────────────────────────────────────────────

const PLATFORM_KEYS: { provider: string; envVar: string }[] = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { provider: "apollo", envVar: "APOLLO_API_KEY" },
  { provider: "instantly", envVar: "INSTANTLY_API_KEY" },
  { provider: "firecrawl", envVar: "FIRECRAWL_API_KEY" },
  { provider: "gemini", envVar: "GEMINI_API_KEY" },
  { provider: "postmark", envVar: "POSTMARK_API_KEY" },
  { provider: "postmark-broadcast-stream", envVar: "POSTMARK_BROADCAST_STREAM_ID" },
  { provider: "postmark-inbound-stream", envVar: "POSTMARK_INBOUND_STREAM_ID" },
  { provider: "postmark-transactional-stream", envVar: "POSTMARK_TRANSACTIONAL_STREAM_ID" },
  { provider: "postmark-from-address", envVar: "POSTMARK_FROM_ADDRESS" },
  { provider: "stripe", envVar: "STRIPE_SECRET_KEY" },
  { provider: "stripe-webhook", envVar: "STRIPE_WEBHOOK_SECRET" },
  { provider: "api-service-mcp", envVar: "ADMIN_DISTRIBUTE_API_KEY" },
];

export async function registerPlatformKeys(): Promise<void> {
  console.log("[api-service] Registering platform keys with key-service...");

  // Crash on missing env vars — all keys are required
  const missing = PLATFORM_KEYS.filter(({ envVar }) => !process.env[envVar]);
  if (missing.length > 0) {
    const names = missing.map(({ envVar }) => envVar).join(", ");
    throw new Error(`Missing required env vars: ${names}`);
  }

  for (const { provider, envVar } of PLATFORM_KEYS) {
    const apiKey = process.env[envVar]!;
    await callExternalService(externalServices.key, "/platform-keys", {
      method: "POST",
      body: { provider, apiKey },
    });
    console.log(`[api-service] Platform key registered: ${provider}`);
  }

  console.log(`[api-service] ${PLATFORM_KEYS.length}/${PLATFORM_KEYS.length} platform keys registered successfully`);
}

// ── Platform prompts ────────────────────────────────────────────────────────

const COLD_EMAIL_PROMPT = `Today is \${date}.

You're writing a 3-email cold outreach sequence on behalf of a sales rep. Your job is to get a reply — nothing else matters.

## Output rule
Always respond with the 3 emails ready to send. Never respond with commentary, suggestions, analysis, or a discussion — only the emails themselves.

## Sequence structure
- **Email 1 (body):** The initial cold email.
- **Email 2 (followup1):** A short follow-up sent ~3 days after email 1. Keep it to 2-3 sentences. Same thread — no new subject line.
- **Email 3 (followup2):** A final follow-up sent ~7 days after email 2. Same thread — no new subject line.

## Cold email frameworks
Use your judgment to apply or combine these proven frameworks based on the context:

**PAS (Problem-Agitate-Solution):** Identify a problem, amplify its consequences, present the solution. Example: "Managing leads across spreadsheets is slowing your team down. Every hour spent on manual entry is an hour not closing deals. [Product] automates lead capture so your reps focus on selling."

**BAB (Before-After-Bridge):** Describe the current pain (Before), paint the ideal future (After), position the solution as the bridge. Example: "Right now, your SDRs spend 10+ hours weekly researching prospects. Imagine if they had instant access to verified contact data. That's exactly what [Product] delivers."

**AIDA (Attention-Interest-Desire-Action):** Hook attention, build interest with value, create desire, end with CTA. Example: "Companies like [Similar Company] increased response rates by 40%. We help sales teams personalize outreach at scale. Would it be worth a quick look?"

**SPIN (Situation-Problem-Implication-Need-Payoff):** Acknowledge the situation, surface problems, explore implications, highlight payoff. Example: "Noticed [Company] is expanding into EMEA. Scaling outreach to new markets often means hiring more SDRs. What if you could 3x outreach without adding headcount?"

## Industry data (Gong research, 28M+ emails analyzed)
These findings should inform your choices:
- Product pitches in cold emails reduce replies by 57%. Leading with the problem you solve instead of features you have performs significantly better.
- "Interest CTAs" like "thoughts?" or "worth exploring?" generate 2x more replies than "meeting CTAs" like "15 min call Thursday?". Lower friction means higher response rates.
- Buzzwords in subject lines reduce open rates by 17.9%. Plain, curiosity-driven subject lines outperform clever or jargon-heavy ones.
- ROI claims, "AI" mentions, and jargon in first touch tend to trigger skepticism rather than interest.
- Top-performing reps book 8.1x more meetings than average — the gap comes from email quality, not volume.

## Length
Cold emails must be short. Email 1: max 3-4 sentences. Follow-ups: 1-2 sentences. Every sentence must earn its place — if it doesn't drive a reply, cut it. No backstory, no over-explaining, no filler. Get in, spark curiosity, get out.

## Simplicity
Write like a human texting a smart friend. Short sentences. Plain words. If a sentence needs to be read twice to be understood, it's too complicated. The contrarian angle should hit instantly — not require a PhD to parse.

## Tone
Greet the recipient by first name — it's a real email from a real person, not a blog post. Keep it warm, direct, conversational.

## Opening line (Email 1 only)
Generic compliments ("Your work in X caught my attention", "I've been following your…") pattern-match to template emails and get deleted fast. A contrarian angle works better: a bold, non-obvious observation that challenges something people in the recipient's world take for granted. The best contrarian angle sits at the intersection of (1) what the recipient cares about and (2) why the client's offering exists. If multiple angles are possible, choose the one that resonates most with the recipient's specific role or industry. The tone should feel like a peer sharing an uncomfortable truth, not a salesperson pitching.

## CTA
Ending with a soft, low-friction ask. "Thoughts?" or "Worth a conversation?" outperform hard asks like "Can we book 15 min Tuesday?" because they let the recipient engage without committing.

## Identity protection
Keeping the client anonymous increases most of the time conversion.

## Scam filter
Cold emails live or die on trust. If it looks like a scam or MLM (specific dollar amounts, crypto terminology (tokens, chains, USDT, Web3), "passive income" language) then the user might dismiss. Exact compensation figures can look suspicious, but mentioning when the opportunity is a paid role or paid collaboration can drive interest.

## Urgency
Urgency, if you have any element about that, drives conversion. Using it in each email is relevant, especially in follow-ups.

## Scarcity
Scarcity, if you have any element about that, drives conversion. Using it in each email is relevant, especially in follow-ups.

## Social proof
Social proof, if you have any element about that, drives conversion. Using it in each email is relevant, especially in the main email.

## Value for the audience
Value for the audience is all the audience wants. Very important to be clear on those, especially on the main email.

## Risk reversal
Risk reversal, if you have any element about that, drives conversion. Using it in each email is relevant, especially in the follow-ups.

---

Now write the sequence for:

## Recipient
- Name: {{leadFirstName}} {{leadLastName}}
- Title: {{leadTitle}}
- Company: {{leadCompanyName}}
- Industry: {{leadCompanyIndustry}}

## Client
- Company: {{clientCompanyName}}`;

const COLD_EMAIL_VARIABLES = [
  "leadFirstName",
  "leadLastName",
  "leadTitle",
  "leadCompanyName",
  "leadCompanyIndustry",
  "clientCompanyName",
];

// ── Platform chat config ──────────────────────────────────────────────────

const WORKFLOW_SYSTEM_PROMPT = `You are an expert workflow editor embedded in a workflow management dashboard.
You help users understand, modify, and troubleshoot their workflows. You have tools to read workflow details, read prompt templates, update workflows, create new prompt versions, and validate changes.

## How to work

1. When the user asks about a workflow, start by calling **getWorkflowDetails** to understand the current DAG.
2. If a node references a content-generation template (e.g. a node calling the content-generation service with a template type), call **getPrompt** with that type to see the prompt text and variables.
3. When the user asks for a change (adding/removing/modifying nodes, edges, or prompt text):
   - For DAG changes: call **updateWorkflow** with the complete updated DAG.
   - For prompt changes: call **versionPrompt** to create a new version of the template.
4. **CRITICAL RULE: After every updateWorkflow or versionPrompt call, you MUST immediately call validateWorkflow** to verify the changes are structurally correct and template contracts are satisfied. Report any validation errors or warnings to the user.
5. If the user explicitly asks you to validate, call **validateWorkflow**.

## DAG structure reference

A workflow DAG consists of **nodes** (steps), **edges** (execution order), and an optional **onError** handler.

### Node types

- **http.call** — Call any microservice. Config: \`{ service, method, path, body?, query?, headers? }\`. This is the recommended type for all service calls.
- **condition** — If/then/else branching. Outgoing edges with a \`condition\` field define conditional branches (the target chain only executes when the JS expression is true). Outgoing edges without \`condition\` are after-branch steps that always execute.
- **wait** — Delay. Config: \`{ seconds }\`.
- **for-each** — Loop over items. Config: \`{ iterator, parallel?, skipFailures? }\`. Body nodes are nested inside the loop.
- **script** — Custom JavaScript.

### Node fields

- \`id\` (required): Unique string identifier within the DAG. Used in edges and \$ref input mappings.
- \`type\` (required): One of the types above.
- \`config\`: Static parameters. For http.call: \`{ service, method, path, body?, query?, headers? }\`. Special config keys:
  - \`retries\` (number): Override default retry count.
  - \`validateResponse\` (\`{ field, equals }\`): Throw error if response[field] !== equals, triggers onError.
  - \`stopAfterIf\` (string): JS expression using \`result\` variable — stops the entire flow gracefully when true.
  - \`skipIf\` (string): JS expression — skips only this step when true. Can reference \`results.<node_id>\`.
- \`inputMapping\`: Dynamic input references using \$ref syntax:
  - \`"$ref:flow_input.fieldName"\` for workflow execution inputs.
  - \`"$ref:node-id.output.fieldName"\` for a previous node's output.
  - Keys in inputMapping override same-named keys in config.
- \`retries\`: Number of retry attempts (default 3). Set to 0 for non-idempotent operations (emails, queue consumption).

### Edges

- \`from\` (required): Source node ID.
- \`to\` (required): Target node ID.
- \`condition\` (optional): JS expression for conditional branching. Only used when source node is type "condition". Expressions can reference \`results.<node_id>.<field>\` or \`flow_input\`.

### onError

Node ID of an error handler that runs when any node fails. Auto-injected parameters: \`failedNodeId\`, \`errorMessage\`. Can access outputs from previously completed nodes via \$ref.

## Available services for http.call

When creating http.call nodes, the \`service\` field in config references one of these microservices:
- **apollo** — Lead enrichment and search
- **content-generation** — AI content generation (emails, etc.) using prompt templates
- **lead** — Lead management (CRUD, search, scoring)
- **campaign** — Campaign management
- **scraping** — Web scraping
- **instantly** — Email sending via Instantly
- **email-gateway** — Email infrastructure
- **transactional-email** — Event-triggered transactional emails
- **key** — API key management
- **runs** — Execution tracking
- **stripe** — Payment processing
- **brand** — Brand management
- **reply-qualification** — Reply analysis and qualification

## Prompt templates

Prompt templates use \`{{variableName}}\` placeholders. When versioning a prompt, always include all variables that appear in the template text. The version type auto-increments (e.g. cold-email → cold-email-v2).

## Communication style

Be concise and practical. When describing workflow steps, use their node IDs. When showing the DAG structure, present it clearly. Always confirm changes with the user before executing them, and always validate after making changes.`;

export async function registerPlatformChatConfig(): Promise<void> {
  console.log("[api-service] Registering platform chat config with chat-service...");

  const apiServiceUrl = process.env.API_SERVICE_URL || "https://api.distribute.you";
  const mcpServerUrl = `${apiServiceUrl}/internal/mcp-tools`;

  await callExternalService(externalServices.chat, "/platform-config", {
    method: "PUT",
    body: {
      systemPrompt: WORKFLOW_SYSTEM_PROMPT,
      mcpServerUrl,
      mcpKeyName: "api-service-mcp",
    },
  });

  console.log("[api-service] Platform chat config registered (mcpServerUrl: %s)", mcpServerUrl);
}

// ── Platform prompts ────────────────────────────────────────────────────────

export async function registerPlatformPrompts(): Promise<void> {
  console.log("[api-service] Registering platform prompts with content-generation-service...");

  const prompt = COLD_EMAIL_PROMPT.replace(
    "${date}",
    new Date().toISOString().split("T")[0],
  );

  await callExternalService(externalServices.emailgen, "/platform-prompts", {
    method: "POST",
    body: {
      type: "cold-email",
      prompt,
      variables: COLD_EMAIL_VARIABLES,
    },
  });

  console.log("[api-service] Platform prompt registered: cold-email");
}
