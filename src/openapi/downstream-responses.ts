/**
 * Success answers of proxied operations, documented from the PRODUCER's own openapi.
 *
 * Why: a proxied response schema here is `z.object({}).passthrough()` on purpose
 * (CLAUDE.md rule #8: the downstream owns the shape, the gateway forwards bytes).
 * That also published an EMPTY answer, so an agent creating a brand or confirming
 * an offer never learned the id it had just created (2026-10-22: a new client's
 * agent called an offer route with "x" as the offer id).
 *
 * Same fix as the request bodies (`downstream-bodies.ts`), on the other side of
 * the call: `DOWNSTREAM_RESPONSE_SOURCES` names, per gateway operation, the
 * producer route it forwards to; `scripts/sync-downstream-bodies.ts` copies that
 * route's 2xx response schemas out of the producer's SERVED openapi into
 * `downstream-responses.generated.ts` (refs inlined); `attachDownstreamResponses`
 * puts each one on the operation when, and only when, the gateway's own schema
 * for that status is empty. Nothing here validates or reshapes anything.
 *
 * `tests/unit/openapi-onboarding.test.ts` fails the build when an operation of
 * the first-client path (`ONBOARDING_OPERATIONS`) answers an empty shape.
 */
import { DOWNSTREAM_RESPONSES as snapshot } from "./downstream-responses.generated.js";
import { isEmptyBodySchema } from "./downstream-bodies.js";

export interface DownstreamResponseSource {
  service: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
}

/** `"<METHOD> <gateway path template>"` → the producer route whose answer the gateway forwards. */
export const DOWNSTREAM_RESPONSE_SOURCES: Record<string, DownstreamResponseSource> = {
  "POST /v1/agent-signups/start": { service: "client-service", method: "POST", path: "/internal/agent-signups/start" },
  "POST /v1/brands": { service: "brand-service", method: "POST", path: "/orgs/brands" },
  "POST /v1/brands/{id}/offers/proposals": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/offers/proposals" },
  "POST /v1/brands/{id}/offers/confirm": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/offers/confirm" },
  "GET /v1/brands/{id}/offers": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/offers" },
  "GET /v1/brands/{id}/offers/{offerId}": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/offers/{offerId}" },
  "PUT /v1/brands/{id}/offers/{offerId}/economics": { service: "brand-service", method: "PUT", path: "/orgs/brands/{id}/offers/{offerId}/economics" },
  "POST /v1/orgs/audiences/suggest": { service: "human-service", method: "POST", path: "/orgs/audiences/suggest" },
  "POST /v1/orgs/audiences": { service: "human-service", method: "POST", path: "/orgs/audiences" },
  "GET /v1/orgs/audiences": { service: "human-service", method: "GET", path: "/orgs/audiences" },
  "POST /v1/content/preview-email/prepare": { service: "content-generation-service", method: "POST", path: "/preview-email/prepare" },
  "POST /v1/content/preview-email": { service: "content-generation-service", method: "POST", path: "/preview-email" },
  "POST /v1/billing/accounts/prepaid_checkout": { service: "billing-service", method: "POST", path: "/v1/accounts/prepaid_checkout" },
  "GET /v1/billing/accounts/prepaid_status": { service: "billing-service", method: "GET", path: "/v1/accounts/prepaid_status" },
  "GET /v1/offers/{offerId}/sales-funnels": { service: "features-service", method: "GET", path: "/internal/catalogue/sales-funnels" },
  "PUT /v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps": { service: "billing-service", method: "PUT", path: "/v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps" },
  "POST /v1/sales-funnel-campaigns": { service: "campaign-service", method: "POST", path: "/sales-funnel-campaigns" },
  "GET /v1/sales-funnel-campaigns/{id}": { service: "campaign-service", method: "GET", path: "/sales-funnel-campaigns/{id}" },
  "PATCH /v1/sales-funnel-campaigns/{id}": { service: "campaign-service", method: "PATCH", path: "/sales-funnel-campaigns/{id}" },
  "POST /v1/brands/extract-fields": { service: "brand-service", method: "POST", path: "/orgs/brands/extract-fields" },
  "POST /v1/brands/{id}/icp/suggest": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/icp/suggest" },
  "GET /v1/brands/{id}/offers/{offerId}/user-fields": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/offers/{offerId}/user-fields" },
  "PUT /v1/brands/{id}/offers/{offerId}/user-fields": { service: "brand-service", method: "PUT", path: "/orgs/brands/{brandId}/offers/{offerId}/user-fields" },
  "GET /v1/brands/{id}/sales-rep": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/sales-rep" },
  "PUT /v1/brands/{id}/sales-rep": { service: "brand-service", method: "PUT", path: "/orgs/brands/{brandId}/sales-rep" },
  "GET /v1/brands/{id}/offers/{offerId}/qualification/criteria": { service: "lead-service", method: "GET", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/criteria" },
  "PATCH /v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}": { service: "lead-service", method: "PATCH", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/criteria/{criterionId}" },
  "POST /v1/brands/{id}/offers/{offerId}/qualification/suggestions": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/suggestions" },
  "POST /v1/brands/{id}/offers/{offerId}/qualification/previews": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/previews" },
  "GET /v1/brands/{id}/offers/{offerId}/qualification/previews/{previewId}": { service: "lead-service", method: "GET", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/previews/{previewId}" },
  "POST /v1/orgs/audiences/split": { service: "human-service", method: "POST", path: "/orgs/audiences/split" },
  "POST /v1/orgs/audiences/split/estimate": { service: "human-service", method: "POST", path: "/orgs/audiences/split/estimate" },
  "POST /v1/orgs/audiences/split/confirm": { service: "human-service", method: "POST", path: "/orgs/audiences/split/confirm" },
  "GET /v1/orgs/audiences/{id}/preview/companies": { service: "human-service", method: "GET", path: "/orgs/audiences/{id}/preview/companies" },
  "POST /v1/orgs/audiences/portfolio": { service: "human-service", method: "POST", path: "/orgs/audiences/portfolio" },
  "PUT /v1/billing/accounts/monthly_charge_limit": { service: "billing-service", method: "PUT", path: "/v1/accounts/monthly_charge_limit" },
  "GET /v1/skills": { service: "chat-service", method: "GET", path: "/internal/skills" },
  "GET /v1/skills/{slug}": { service: "chat-service", method: "GET", path: "/internal/skills/{slug}" },
};

export interface DownstreamResponseSnapshot extends DownstreamResponseSource {
  /** Per 2xx status the producer documents: its JSON schema with every `$ref` inlined (null: no JSON body). */
  responses: Record<string, { description: string | null; schema: Record<string, unknown> | null }>;
}

export const DOWNSTREAM_RESPONSE_SNAPSHOT = snapshot as unknown as Record<string, DownstreamResponseSnapshot>;

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

type Json = Record<string, unknown>;

/**
 * Put each producer answer on its operation where the gateway's own schema for
 * that status is empty. The gateway's documented success statuses are kept (they
 * are what it answers: a route that re-emits through `res.json` turns the
 * producer's 201 into a 200): each empty one takes the producer's schema for the
 * same status, else the producer's first documented success schema. Only an
 * operation that documents no success status at all gets the producer's. A
 * gateway schema that declares fields always wins.
 */
export function attachDownstreamResponses(
  document: Json,
  snap: Record<string, DownstreamResponseSnapshot> = DOWNSTREAM_RESPONSE_SNAPSHOT,
): void {
  const paths = (document.paths ?? {}) as Record<string, Json>;
  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const op = item[method] as Json | undefined;
      if (!op) continue;
      const entry = snap[`${method.toUpperCase()} ${path}`];
      if (!entry) continue;
      const produced = Object.entries(entry.responses).filter(([, r]) => r.schema);
      if (produced.length === 0) continue;
      const responses = (op.responses ??= {}) as Record<string, Json>;
      let successCodes = Object.keys(responses).filter((code) => code.startsWith("2"));
      if (successCodes.length === 0) {
        for (const [code, r] of produced) responses[code] = { description: r.description ?? "Success" };
        successCodes = produced.map(([code]) => code);
      }
      let attached = false;
      for (const code of successCodes) {
        const source = entry.responses[code]?.schema ?? produced[0][1].schema;
        const response = responses[code];
        if (!response || typeof response.$ref === "string") continue;
        const content = (response.content ??= {}) as Json;
        const json = (content["application/json"] ??= {}) as Json;
        if (!isEmptyBodySchema(document, json.schema as Json | undefined)) continue;
        json.schema = source;
        attached = true;
      }
      if (attached) {
        op.description = `${op.description ?? ""}\n\nResponse: documented from ${entry.service} ${entry.method} ${entry.path}, which owns it; the gateway forwards it unchanged.`.trim();
      }
    }
  }
}
