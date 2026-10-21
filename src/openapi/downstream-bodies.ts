/**
 * Request bodies of proxied writes, documented from the PRODUCER's own openapi.
 *
 * Why: a proxied write's request schema here is `z.object({}).passthrough()` on
 * purpose (CLAUDE.md rule #8 corollary: the gateway forwards the body
 * byte-identical and the producer validates it). That keeps the gateway out of
 * the producer's vocabulary, but it also published an EMPTY body in
 * `openapi.json`, so an agent reading the document (the distribute.you MCP's
 * `distribute_describe_api`) could not know what to send without reading
 * producer source (owner gap list, 2026-10-12).
 *
 * The fix keeps validation where it is and fixes only the DOCUMENT:
 * `DOWNSTREAM_BODY_SOURCES` names, per gateway write, the producer route it
 * forwards to; `scripts/sync-downstream-bodies.ts` copies that route's request
 * body schema out of the producer's served openapi into
 * `downstream-request-bodies.generated.ts` (refs inlined); `attachDownstreamBodies`
 * puts it on the operation when, and only when, the gateway's own schema is
 * empty. Nothing here is a validator: a field the producer adds tomorrow still
 * reaches it today, the document just learns about it at the next sync.
 *
 * `tests/unit/openapi-request-bodies.test.ts` fails the build when a customer
 * write has neither its own body schema nor a snapshot, so a new proxied write
 * cannot ship with an empty body again.
 */
import { DOWNSTREAM_REQUEST_BODIES as snapshot } from "./downstream-request-bodies.generated.js";

export interface DownstreamBodySource {
  service: string;
  method: "POST" | "PUT" | "PATCH";
  path: string;
  /** Body fields the GATEWAY supplies from the authenticated identity: left out of the documented body. */
  omit?: string[];
}

/** `"<METHOD> <gateway path template>"` → the producer route the body is forwarded to. */
export const DOWNSTREAM_BODY_SOURCES: Record<string, DownstreamBodySource> = {
  "POST /v1/sales-funnel-campaigns": { service: "campaign-service", method: "POST", path: "/sales-funnel-campaigns" },
  "PATCH /v1/sales-funnel-campaigns/{id}": { service: "campaign-service", method: "PATCH", path: "/sales-funnel-campaigns/{id}" },
  "POST /v1/keys/brands/{brandId}": { service: "key-service", method: "POST", path: "/keys/brands/{brandId}" },
  "POST /v1/leads/crm-pairings/rulings": { service: "lead-service", method: "POST", path: "/orgs/leads/crm-pairings/rulings" },
  "POST /v1/leads/{id}/step-statements": { service: "lead-service", method: "POST", path: "/orgs/leads/{id}/step-statements" },
  "PUT /v1/leads/{id}/disqualification": { service: "lead-service", method: "PUT", path: "/orgs/leads/{id}/disqualification" },
  "POST /v1/leads/{id}/followups": { service: "lead-service", method: "POST", path: "/orgs/leads/{id}/followups" },
  "PUT /v1/leads/{id}/crm-attribution/{step}": { service: "lead-service", method: "PUT", path: "/orgs/leads/{id}/crm-attribution/{step}" },
  "PUT /v1/brands/{id}/leg-rates": { service: "brand-service", method: "PUT", path: "/orgs/brands/{id}/leg-rates" },
  "PUT /v1/brands/{id}/offers/{offerId}/economics": { service: "brand-service", method: "PUT", path: "/orgs/brands/{id}/offers/{offerId}/economics" },
  "POST /v1/brands/{id}/offers/proposals": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/offers/proposals" },
  "POST /v1/brands/{id}/offers/confirm": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/offers/confirm" },
  "PUT /v1/brands/{id}/sales-rep-phone": { service: "brand-service", method: "PUT", path: "/orgs/brands/{brandId}/sales-rep-phone" },
  "PUT /v1/brands/{id}/sales-rep": { service: "brand-service", method: "PUT", path: "/orgs/brands/{brandId}/sales-rep" },
  "POST /v1/brands/{id}/icp/suggest": { service: "brand-service", method: "POST", path: "/orgs/brands/{id}/icp/suggest" },
  "PUT /v1/brands/{id}/user-fields": { service: "brand-service", method: "PUT", path: "/orgs/brands/{id}/user-fields" },
  "PUT /v1/brands/{brandId}/sales-budget": { service: "billing-service", method: "PUT", path: "/v1/brands/{brandId}/sales-budget" },
  "PUT /v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps": { service: "billing-service", method: "PUT", path: "/v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps" },
  "POST /v1/emails/manual-qualifications/withdrawals": { service: "email-gateway-service", method: "POST", path: "/orgs/manual-qualifications/withdrawals" },
  "POST /v1/emails/opt-outs": { service: "email-gateway-service", method: "POST", path: "/orgs/opt-outs" },
  "POST /v1/emails/opt-outs/withdrawals": { service: "email-gateway-service", method: "POST", path: "/orgs/opt-outs/withdrawals" },
  "POST /v1/content/generate-expert-quote-pitch": { service: "content-generation-service", method: "POST", path: "/generate-expert-quote-pitch" },
  "POST /v1/content/preview-email": { service: "content-generation-service", method: "POST", path: "/preview-email" },
  "POST /v1/content/preview-email/prepare": { service: "content-generation-service", method: "POST", path: "/preview-email/prepare" },
  "POST /public/conversions": { service: "lead-service", method: "POST", path: "/public/conversions" },
  "POST /v1/orgs/opportunities/next": { service: "journalists-quotes-service", method: "POST", path: "/orgs/opportunities/next" },
  "POST /v1/orgs/opportunities/discover": { service: "journalists-quotes-service", method: "POST", path: "/orgs/opportunities/discover" },
  "POST /v1/orgs/opportunities/{id}/reply": { service: "journalists-quotes-service", method: "POST", path: "/orgs/opportunities/{id}/reply" },
  "POST /v1/invites/validate": { service: "client-service", method: "POST", path: "/public/invites/validate" },
  "POST /v1/waitlist/request-access": { service: "client-service", method: "POST", path: "/public/waitlist/request-access" },
  "POST /v1/orgs/{orgId}/invites/claim": { service: "client-service", method: "POST", path: "/internal/invites/claim" },
  "POST /v1/orgs/audiences/suggest": { service: "human-service", method: "POST", path: "/orgs/audiences/suggest" },
  "POST /v1/orgs/audiences/split": { service: "human-service", method: "POST", path: "/orgs/audiences/split" },
  "POST /v1/orgs/audiences/split/confirm": { service: "human-service", method: "POST", path: "/orgs/audiences/split/confirm" },
  "POST /v1/orgs/audiences/split/estimate": { service: "human-service", method: "POST", path: "/orgs/audiences/split/estimate" },
  "POST /v1/orgs/audiences/signal": { service: "human-service", method: "POST", path: "/orgs/audiences/signal" },
  "POST /v1/orgs/audiences/portfolio": { service: "human-service", method: "POST", path: "/orgs/audiences/portfolio" },
  "POST /v1/orgs/audiences/stats": { service: "human-service", method: "POST", path: "/orgs/audiences/stats" },
  "POST /v1/orgs/audiences": { service: "human-service", method: "POST", path: "/orgs/audiences" },
  "POST /v1/orgs/audiences/{id}/avatar": { service: "human-service", method: "POST", path: "/orgs/audiences/{id}/avatar" },
  "PATCH /v1/orgs/audiences/{id}": { service: "human-service", method: "PATCH", path: "/orgs/audiences/{id}" },
  "PATCH /v1/orgs/audiences/{id}/status": { service: "human-service", method: "PATCH", path: "/orgs/audiences/{id}/status" },
  "POST /v1/orgs/google/auth/start": { service: "google-service", method: "POST", path: "/orgs/google/auth/start" },
  "POST /v1/orgs/google/sync": { service: "google-service", method: "POST", path: "/orgs/google/sync" },
  "PUT /v1/orgs/google/contact-links": { service: "google-service", method: "PUT", path: "/orgs/google/contact-links" },
  "POST /v1/orgs/contacts": { service: "crm-service", method: "POST", path: "/orgs/contacts" },
  "POST /v1/orgs/contacts/serve-next": { service: "crm-service", method: "POST", path: "/orgs/contacts/serve-next" },
  "POST /v1/content/platform-prompts": { service: "content-generation-service", method: "POST", path: "/platform-prompts" },
  "POST /v1/content/template-dynasties": { service: "content-generation-service", method: "POST", path: "/internal/template-dynasties" },
  "POST /v1/content/template-dynasties/{slug}/versions": { service: "content-generation-service", method: "POST", path: "/internal/template-dynasties/{slug}/versions" },
  "POST /v1/orgs/matrix/connections": { service: "crm-service", method: "POST", path: "/orgs/matrix/connections" },
  "PATCH /v1/orgs/matrix/connections/{id}": { service: "crm-service", method: "PATCH", path: "/orgs/matrix/connections/{id}" },
  "POST /v1/orgs/matrix/links": { service: "crm-service", method: "POST", path: "/orgs/matrix/links" },
  "PATCH /v1/orgs/matrix/links/{linkId}": { service: "crm-service", method: "PATCH", path: "/orgs/matrix/links/{linkId}" },
  "POST /v1/orgs/gohighlevel/connections": { service: "crm-service", method: "POST", path: "/orgs/gohighlevel/connections" },
  "PATCH /v1/orgs/gohighlevel/connections/{id}": { service: "crm-service", method: "PATCH", path: "/orgs/gohighlevel/connections/{id}" },
  "POST /v1/orgs/posthog/connections": { service: "crm-service", method: "POST", path: "/orgs/posthog/connections" },
  "PATCH /v1/orgs/posthog/connections/{id}": { service: "crm-service", method: "PATCH", path: "/orgs/posthog/connections/{id}" },
  "POST /v1/orgs/stripe/connections": { service: "crm-service", method: "POST", path: "/orgs/stripe/connections" },
  "PATCH /v1/orgs/stripe/connections/{id}": { service: "crm-service", method: "PATCH", path: "/orgs/stripe/connections/{id}" },
  "POST /v1/orgs/clerk/connections": { service: "crm-service", method: "POST", path: "/orgs/clerk/connections" },
  "PATCH /v1/orgs/clerk/connections/{id}": { service: "crm-service", method: "PATCH", path: "/orgs/clerk/connections/{id}" },
  "POST /v1/orgs/people/sync": { service: "crm-service", method: "POST", path: "/orgs/people/sync" },
  "POST /v1/orgs/people/corrections": { service: "crm-service", method: "POST", path: "/orgs/people/corrections" },
  "POST /v1/orgs/people/corrections/{correctionId}/undo": { service: "crm-service", method: "POST", path: "/orgs/people/corrections/{correctionId}/undo" },
  "POST /v1/orgs/people/merges": { service: "crm-service", method: "POST", path: "/orgs/people/merges" },
  "POST /v1/orgs/people/merges/{mergeId}/undo": { service: "crm-service", method: "POST", path: "/orgs/people/merges/{mergeId}/undo" },
  "POST /v1/brands/{id}/offers/{offerId}/qualification/suggestions": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/suggestions" },
  "POST /v1/brands/{id}/offers/{offerId}/qualification/criteria": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/criteria" },
  "PATCH /v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}": { service: "lead-service", method: "PATCH", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/criteria/{criterionId}" },
  "POST /v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}/sample": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/criteria/{criterionId}/sample" },
  "POST /v1/brands/{id}/offers/{offerId}/qualification/previews": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/previews" },
  "POST /v1/replies": { service: "instantly-service", method: "POST", path: "/orgs/replies" },
  "POST /v1/followup-cuts": { service: "instantly-service", method: "POST", path: "/orgs/followup-cuts" },
  "POST /v1/orgs": { service: "client-service", method: "POST", path: "/internal/orgs", omit: ["createdByUserId"] },
  "POST /v1/orgs/{orgId}/member-invitations": { service: "client-service", method: "POST", path: "/internal/orgs/{orgId}/member-invitations", omit: ["invitedByUserId"] },
};

export interface DownstreamBodySnapshot extends DownstreamBodySource {
  /** The producer's request body schema with every `$ref` inlined; null when the producer documents no JSON body. */
  schema: Record<string, unknown> | null;
}

export const DOWNSTREAM_BODY_SNAPSHOT = snapshot as unknown as Record<string, DownstreamBodySnapshot>;

const WRITE_METHODS = ["post", "put", "patch"] as const;

type Json = Record<string, unknown>;

function resolveRef(document: Json, schema: Json | undefined): Json | undefined {
  let current = schema;
  const schemas = ((document.components as Json | undefined)?.schemas ?? {}) as Record<string, Json>;
  for (let hops = 0; current && typeof current.$ref === "string" && hops < 10; hops++) {
    current = schemas[(current.$ref as string).split("/").pop()!];
  }
  return current;
}

/** True when a body schema tells a reader nothing about which fields to send. */
export function isEmptyBodySchema(document: Json, schema: Json | undefined): boolean {
  const resolved = resolveRef(document, schema);
  if (!resolved) return true;
  const props = resolved.properties as Json | undefined;
  if (props && Object.keys(props).length > 0) return false;
  for (const key of ["allOf", "oneOf", "anyOf"]) if (Array.isArray(resolved[key]) && (resolved[key] as unknown[]).length > 0) return false;
  if (resolved.type === "array" || resolved.items) return false;
  return true;
}

/**
 * Put each snapshot body on its operation when the gateway's own body schema is
 * empty. A gateway schema that declares fields always wins: it is the one the
 * gateway validates against.
 */
export function attachDownstreamBodies(document: Json, snap: Record<string, DownstreamBodySnapshot> = DOWNSTREAM_BODY_SNAPSHOT): void {
  const paths = (document.paths ?? {}) as Record<string, Json>;
  for (const [path, item] of Object.entries(paths)) {
    for (const method of WRITE_METHODS) {
      const op = item[method] as Json | undefined;
      if (!op) continue;
      const entry = snap[`${method.toUpperCase()} ${path}`];
      if (!entry?.schema) continue;
      const requestBody = (op.requestBody ??= { content: { "application/json": {} } }) as Json;
      const content = ((requestBody.content ??= {}) as Json);
      const json = ((content["application/json"] ??= {}) as Json);
      if (!isEmptyBodySchema(document, json.schema as Json | undefined)) continue;
      json.schema = entry.schema;
      op.description = `${op.description ?? ""}\n\nRequest body: documented from ${entry.service} ${entry.method} ${entry.path}, which owns and validates it; the gateway forwards it unchanged.`.trim();
    }
  }
}
