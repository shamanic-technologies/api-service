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
  "GET /v1/brands/{id}/competitors": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/competitors" },
  "POST /v1/brands/{id}/competitors/discover": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/competitors/discover" },
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
  // CLIENT-FRICTION-API-1103: every customer operation whose description names the producer route it
  // forwards to (`Proxy to <svc> <METHOD> <path>`), checked against that producer's served document.
  // Left out: the sourcing-investment reads, whose customer answer drops `vendorUsd` (src/routes/brand-audience.ts),
  // and the two lead-detail reads, whose producer answer alone (~85 KB) passes the per-page token budget of views.ts.
  "GET /v1/offers/{offerId}/trigger-events/summary": { service: "campaign-service", method: "GET", path: "/internal/offers/{offerId}/trigger-events/summary" },
  "GET /v1/features/brands/{brandId}/sales-funnel-campaigns": { service: "features-service", method: "GET", path: "/brands/{brandId}/sales-funnel-campaigns" },
  "GET /v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/activity": { service: "features-service", method: "GET", path: "/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/activity" },
  "GET /v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/next-steps": { service: "features-service", method: "GET", path: "/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/next-steps" },
  "GET /v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/factory-shadow": { service: "features-service", method: "GET", path: "/brands/{brandId}/sales-funnel-campaigns/{id}/factory-shadow" },
  "GET /v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/milestones": { service: "features-service", method: "GET", path: "/brands/{brandId}/sales-funnel-campaigns/{id}/milestones" },
  "GET /v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/people-journeys": { service: "features-service", method: "GET", path: "/brands/{brandId}/sales-funnel-campaigns/{id}/people-journeys" },
  "GET /v1/features/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/spend-charts": { service: "features-service", method: "GET", path: "/brands/{brandId}/sales-funnel-campaigns/{salesFunnelCampaignId}/spend-charts" },
  "GET /v1/sales-funnel-campaigns": { service: "campaign-service", method: "GET", path: "/sales-funnel-campaigns" },
  "DELETE /v1/sales-funnel-campaigns/{id}": { service: "campaign-service", method: "DELETE", path: "/sales-funnel-campaigns/{id}" },
  "GET /v1/sales-funnel-campaigns/{id}/plan-changes": { service: "campaign-service", method: "GET", path: "/sales-funnel-campaigns/{id}/plan-changes" },
  "GET /v1/campaigns/{id}/sourcing-stats": { service: "lead-service", method: "GET", path: "/orgs/campaigns/{campaignId}/sourcing-stats" },
  "GET /v1/keys/brands/{brandId}": { service: "key-service", method: "GET", path: "/keys/brands/{brandId}" },
  "POST /v1/keys/brands/{brandId}": { service: "key-service", method: "POST", path: "/keys/brands/{brandId}" },
  "DELETE /v1/keys/brands/{brandId}/{provider}": { service: "key-service", method: "DELETE", path: "/keys/brands/{brandId}/{provider}" },
  "GET /v1/leads/stats": { service: "lead-service", method: "GET", path: "/orgs/stats" },
  "POST /v1/leads/crm-pairings/rulings": { service: "lead-service", method: "POST", path: "/orgs/leads/crm-pairings/rulings" },
  "DELETE /v1/leads/crm-pairings/rulings": { service: "lead-service", method: "DELETE", path: "/orgs/leads/crm-pairings/rulings" },
  "GET /v1/leads/{id}/step-statements": { service: "lead-service", method: "GET", path: "/orgs/leads/{id}/step-statements" },
  "POST /v1/leads/{id}/step-statements": { service: "lead-service", method: "POST", path: "/orgs/leads/{id}/step-statements" },
  "DELETE /v1/leads/{id}/step-statements/{step}": { service: "lead-service", method: "DELETE", path: "/orgs/leads/{id}/step-statements/{step}" },
  "PUT /v1/leads/{id}/disqualification": { service: "lead-service", method: "PUT", path: "/orgs/leads/{id}/disqualification" },
  "DELETE /v1/leads/{id}/disqualification": { service: "lead-service", method: "DELETE", path: "/orgs/leads/{id}/disqualification" },
  "PUT /v1/leads/{id}/not-a-person": { service: "lead-service", method: "PUT", path: "/orgs/leads/{id}/not-a-person" },
  "DELETE /v1/leads/{id}/not-a-person": { service: "lead-service", method: "DELETE", path: "/orgs/leads/{id}/not-a-person" },
  "GET /v1/brands/{brandId}/conversions": { service: "lead-service", method: "GET", path: "/orgs/brands/{brandId}/conversions" },
  "POST /v1/brands/{brandId}/conversions/{conversionId}/withdraw": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/conversions/{conversionId}/withdraw" },
  "DELETE /v1/brands/{brandId}/conversions/{conversionId}/withdrawal": { service: "lead-service", method: "DELETE", path: "/orgs/brands/{brandId}/conversions/{conversionId}/withdrawal" },
  "POST /v1/leads/{id}/answered-outside": { service: "lead-service", method: "POST", path: "/orgs/leads/{id}/answered-outside" },
  "GET /v1/leads/{id}/followups": { service: "lead-service", method: "GET", path: "/orgs/leads/{id}/followups" },
  "POST /v1/leads/{id}/followups": { service: "lead-service", method: "POST", path: "/orgs/leads/{id}/followups" },
  "POST /v1/leads/crm-evidence/sync": { service: "lead-service", method: "POST", path: "/orgs/leads/crm-evidence/sync" },
  "GET /v1/leads/{id}/crm-attribution": { service: "lead-service", method: "GET", path: "/orgs/leads/{id}/crm-attribution" },
  "PUT /v1/leads/{id}/crm-attribution/{step}": { service: "lead-service", method: "PUT", path: "/orgs/leads/{id}/crm-attribution/{step}" },
  "DELETE /v1/leads/{id}/crm-attribution/{step}": { service: "lead-service", method: "DELETE", path: "/orgs/leads/{id}/crm-attribution/{step}" },
  "GET /v1/leads/{id}/history": { service: "lead-service", method: "GET", path: "/orgs/leads/{id}/history" },
  "GET /v1/leads/{id}/timeline": { service: "lead-service", method: "GET", path: "/orgs/leads/{id}/timeline" },
  "PATCH /v1/brands/{id}": { service: "brand-service", method: "PATCH", path: "/orgs/brands/{brandId}" },
  "GET /v1/brands/{id}/leg-rates": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/leg-rates" },
  "PUT /v1/brands/{id}/leg-rates": { service: "brand-service", method: "PUT", path: "/orgs/brands/{brandId}/leg-rates" },
  "GET /v1/brands/{id}/offers/{offerId}/economics": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/offers/{offerId}/economics" },
  "POST /v1/brands/{id}/offers/{offerId}/image": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/image" },
  "POST /v1/brands/{id}/offers/{offerId}/archive": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/archive" },
  "POST /v1/brands/{id}/offers/{offerId}/unarchive": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/unarchive" },
  "GET /v1/brands/{id}/offers/{offerId}/steps": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/offers/{offerId}/steps" },
  "PUT /v1/brands/{id}/offers/{offerId}/steps/{stepKey}": { service: "brand-service", method: "PUT", path: "/orgs/brands/{brandId}/offers/{offerId}/steps/{stepKey}" },
  "DELETE /v1/brands/{id}/offers/{offerId}/steps/{stepKey}": { service: "brand-service", method: "DELETE", path: "/orgs/brands/{brandId}/offers/{offerId}/steps/{stepKey}" },
  "GET /v1/brands/{id}/offers/{offerId}/documents": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/offers/{offerId}/documents" },
  "POST /v1/brands/{id}/offers/{offerId}/documents": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/documents" },
  "GET /v1/brands/{id}/offers/{offerId}/documents/{documentId}": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/offers/{offerId}/documents/{documentId}" },
  "PATCH /v1/brands/{id}/offers/{offerId}/documents/{documentId}": { service: "brand-service", method: "PATCH", path: "/orgs/brands/{brandId}/offers/{offerId}/documents/{documentId}" },
  "DELETE /v1/brands/{id}/offers/{offerId}/documents/{documentId}": { service: "brand-service", method: "DELETE", path: "/orgs/brands/{brandId}/offers/{offerId}/documents/{documentId}" },
  "GET /v1/brands/{id}/sales-rep-phone": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/sales-rep-phone" },
  "PUT /v1/brands/{id}/sales-rep-phone": { service: "brand-service", method: "PUT", path: "/orgs/brands/{brandId}/sales-rep-phone" },
  "DELETE /v1/brands/{id}/sales-rep-phone": { service: "brand-service", method: "DELETE", path: "/orgs/brands/{brandId}/sales-rep-phone" },
  "GET /v1/brands/{id}/linkedin-page": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/linkedin-page" },
  "PUT /v1/brands/{id}/linkedin-page": { service: "brand-service", method: "PUT", path: "/orgs/brands/{brandId}/linkedin-page" },
  "DELETE /v1/brands/{id}/linkedin-page": { service: "brand-service", method: "DELETE", path: "/orgs/brands/{brandId}/linkedin-page" },
  "DELETE /v1/brands/{id}/sales-rep": { service: "brand-service", method: "DELETE", path: "/orgs/brands/{brandId}/sales-rep" },
  "GET /v1/brands/{id}/conversion-token": { service: "lead-service", method: "GET", path: "/orgs/brands/{brandId}/conversion-token" },
  "POST /v1/brands/{id}/conversion-token/rotate": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/conversion-token/rotate" },
  "GET /v1/brands/{id}/share-token": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/share-token" },
  "POST /v1/brands/{id}/share-token": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/share-token" },
  "DELETE /v1/brands/{id}/share-token": { service: "brand-service", method: "DELETE", path: "/orgs/brands/{brandId}/share-token" },
  "POST /v1/brands/{id}/share-token/rotate": { service: "brand-service", method: "POST", path: "/orgs/brands/{brandId}/share-token/rotate" },
  "GET /v1/brands/{id}/user-fields": { service: "brand-service", method: "GET", path: "/orgs/brands/{brandId}/user-fields" },
  "PUT /v1/brands/{id}/user-fields": { service: "brand-service", method: "PUT", path: "/orgs/brands/{brandId}/user-fields" },
  "POST /v1/billing/accounts/pay_balance": { service: "billing-service", method: "POST", path: "/v1/accounts/pay_balance" },
  "GET /v1/billing/credits/grants": { service: "billing-service", method: "GET", path: "/v1/credits/grants" },
  "GET /v1/billing/free-credit-promises": { service: "billing-service", method: "GET", path: "/v1/free-credit-promises" },
  "GET /v1/billing/credits/debits": { service: "billing-service", method: "GET", path: "/v1/credits/debits" },
  "GET /v1/billing/accounts/payment_mode": { service: "billing-service", method: "GET", path: "/v1/accounts/payment_mode" },
  "PUT /v1/billing/accounts/payment_mode": { service: "billing-service", method: "PUT", path: "/v1/accounts/payment_mode" },
  "GET /v1/billing/accounts/subscription": { service: "billing-service", method: "GET", path: "/v1/accounts/subscription" },
  "PATCH /v1/billing/accounts/subscription": { service: "billing-service", method: "PATCH", path: "/v1/accounts/subscription" },
  "POST /v1/billing/accounts/subscription/checkout_session": { service: "billing-service", method: "POST", path: "/v1/accounts/subscription/checkout_session" },
  "POST /v1/billing/accounts/subscription/start": { service: "billing-service", method: "POST", path: "/v1/accounts/subscription/start" },
  "POST /v1/billing/accounts/subscription/cancel": { service: "billing-service", method: "POST", path: "/v1/accounts/subscription/cancel" },
  "POST /v1/billing/accounts/subscription/resume": { service: "billing-service", method: "POST", path: "/v1/accounts/subscription/resume" },
  "POST /v1/billing/accounts/subscription/pause": { service: "billing-service", method: "POST", path: "/v1/accounts/subscription/pause" },
  "POST /v1/billing/accounts/subscription/unpause": { service: "billing-service", method: "POST", path: "/v1/accounts/subscription/unpause" },
  "GET /v1/billing/accounts/subscriptions": { service: "billing-service", method: "GET", path: "/v1/accounts/subscriptions" },
  "POST /v1/billing/accounts/subscriptions": { service: "billing-service", method: "POST", path: "/v1/accounts/subscriptions" },
  "PATCH /v1/billing/accounts/subscriptions/{subscriptionId}": { service: "billing-service", method: "PATCH", path: "/v1/accounts/subscriptions/{subscriptionId}" },
  "POST /v1/billing/accounts/subscriptions/{subscriptionId}/cancel": { service: "billing-service", method: "POST", path: "/v1/accounts/subscriptions/{subscriptionId}/cancel" },
  "POST /v1/billing/accounts/subscriptions/{subscriptionId}/resume": { service: "billing-service", method: "POST", path: "/v1/accounts/subscriptions/{subscriptionId}/resume" },
  "POST /v1/billing/accounts/subscriptions/{subscriptionId}/pause": { service: "billing-service", method: "POST", path: "/v1/accounts/subscriptions/{subscriptionId}/pause" },
  "POST /v1/billing/accounts/subscriptions/{subscriptionId}/unpause": { service: "billing-service", method: "POST", path: "/v1/accounts/subscriptions/{subscriptionId}/unpause" },
  "POST /v1/staff-requests": { service: "chat-service", method: "POST", path: "/orgs/staff-requests" },
  "GET /v1/staff-requests": { service: "chat-service", method: "GET", path: "/orgs/staff-requests" },
  "GET /v1/catalogue/steps": { service: "features-service", method: "GET", path: "/internal/catalogue/steps" },
  "GET /v1/catalogue/steps/{id}": { service: "features-service", method: "GET", path: "/internal/catalogue/steps/{id}" },
  "GET /v1/catalogue/sales-paths": { service: "features-service", method: "GET", path: "/internal/catalogue/sales-paths" },
  "POST /v1/catalogue/sales-paths": { service: "features-service", method: "POST", path: "/internal/catalogue/sales-paths" },
  "GET /v1/catalogue/sales-paths/{id}": { service: "features-service", method: "GET", path: "/internal/catalogue/sales-paths/{id}" },
  "GET /v1/catalogue/channels": { service: "features-service", method: "GET", path: "/internal/catalogue/channels" },
  "GET /v1/catalogue/channels/{id}": { service: "features-service", method: "GET", path: "/internal/catalogue/channels/{id}" },
  "GET /v1/catalogue/pipes": { service: "features-service", method: "GET", path: "/internal/catalogue/pipes" },
  "GET /v1/catalogue/pipes/{id}": { service: "features-service", method: "GET", path: "/internal/catalogue/pipes/{id}" },
  "POST /v1/catalogue/sales-funnels": { service: "features-service", method: "POST", path: "/internal/catalogue/sales-funnels" },
  "GET /v1/catalogue/sales-funnels": { service: "features-service", method: "GET", path: "/internal/catalogue/sales-funnels" },
  "GET /v1/catalogue/sales-funnels/{id}": { service: "features-service", method: "GET", path: "/internal/catalogue/sales-funnels/{id}" },
  "GET /v1/catalogue/triggers": { service: "features-service", method: "GET", path: "/internal/catalogue/triggers" },
  "GET /v1/catalogue/triggers/{id}": { service: "features-service", method: "GET", path: "/internal/catalogue/triggers/{id}" },
  "GET /v1/public/catalogue/steps": { service: "features-service", method: "GET", path: "/public/catalogue/steps" },
  "GET /v1/public/catalogue/sales-funnels": { service: "features-service", method: "GET", path: "/public/catalogue/sales-funnels" },
  "GET /v1/conversations": { service: "instantly-service", method: "GET", path: "/orgs/conversations" },
  "GET /v1/email-sequences": { service: "instantly-service", method: "GET", path: "/orgs/email-sequences" },
  "POST /v1/followup-cuts": { service: "instantly-service", method: "POST", path: "/orgs/followup-cuts" },
  "GET /v1/followup-cuts": { service: "instantly-service", method: "GET", path: "/orgs/followup-cuts" },
  "GET /v1/sending-schedule": { service: "instantly-service", method: "GET", path: "/orgs/sending-schedule" },
  "GET /v1/brands/{brandId}/daily-budget": { service: "billing-service", method: "GET", path: "/internal/brands/{brandId}/daily-budget" },
  "PATCH /v1/brands/{brandId}/daily-budget": { service: "billing-service", method: "PATCH", path: "/v1/brands/{brandId}/daily-budget" },
  "GET /v1/brands/{brandId}/sales-budget": { service: "billing-service", method: "GET", path: "/v1/brands/{brandId}/sales-budget" },
  "PUT /v1/brands/{brandId}/sales-budget": { service: "billing-service", method: "PUT", path: "/v1/brands/{brandId}/sales-budget" },
  "DELETE /v1/brands/{brandId}/sales-budget": { service: "billing-service", method: "DELETE", path: "/v1/brands/{brandId}/sales-budget" },
  "GET /v1/brands/{brandId}/sales-budget/history": { service: "billing-service", method: "GET", path: "/v1/brands/{brandId}/sales-budget/history" },
  "GET /v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps": { service: "billing-service", method: "GET", path: "/v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps" },
  "DELETE /v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps": { service: "billing-service", method: "DELETE", path: "/v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps" },
  "GET /v1/brands/{brandId}/sales-funnel-caps": { service: "billing-service", method: "GET", path: "/v1/brands/{brandId}/sales-funnel-caps" },
  "POST /v1/content/generate-expert-quote-pitch": { service: "content-generation-service", method: "POST", path: "/generate-expert-quote-pitch" },
  "GET /v1/brands/{brandId}/audience-snapshot": { service: "human-service", method: "GET", path: "/internal/brands/{brandId}/audience-snapshot" },
  "GET /v1/brands/{brandId}/audience-snapshot/people": { service: "human-service", method: "GET", path: "/internal/brands/{brandId}/audience-snapshot/people" },
  "GET /v1/brands/{brandId}/audience-snapshot/companies": { service: "human-service", method: "GET", path: "/internal/brands/{brandId}/audience-snapshot/companies" },
  "GET /v1/orgs/opportunities": { service: "journalists-quotes-service", method: "GET", path: "/orgs/opportunities" },
  "POST /v1/orgs/opportunities/next": { service: "journalists-quotes-service", method: "POST", path: "/orgs/opportunities/next" },
  "POST /v1/orgs/opportunities/discover": { service: "journalists-quotes-service", method: "POST", path: "/orgs/opportunities/discover" },
  "POST /v1/orgs/opportunities/{id}/reply": { service: "journalists-quotes-service", method: "POST", path: "/orgs/opportunities/{id}/reply" },
  "POST /v1/invites/validate": { service: "client-service", method: "POST", path: "/public/invites/validate" },
  "POST /v1/waitlist/request-access": { service: "client-service", method: "POST", path: "/public/waitlist/request-access" },
  "GET /v1/waitlist/position": { service: "client-service", method: "GET", path: "/public/waitlist/position" },
  "GET /v1/orgs/{orgId}/invites/status": { service: "client-service", method: "GET", path: "/internal/orgs/{orgId}/invites/status" },
  "POST /v1/orgs/{orgId}/invites/claim": { service: "client-service", method: "POST", path: "/internal/invites/claim" },
  "GET /v1/brands/{brandId}/pause": { service: "campaign-service", method: "GET", path: "/brands/{brandId}/pause" },
  "GET /v1/brands/{brandId}/spendable-budget": { service: "campaign-service", method: "GET", path: "/brands/{brandId}/spendable-budget" },
  "GET /v1/brands/{brandId}/reward-tasks": { service: "client-service", method: "GET", path: "/internal/brands/{brandId}/reward-tasks" },
  "POST /v1/orgs/audiences/signal": { service: "human-service", method: "POST", path: "/orgs/audiences/signal" },
  "POST /v1/orgs/audiences/stats": { service: "human-service", method: "POST", path: "/orgs/audiences/stats" },
  "POST /v1/orgs/audiences/{id}/refresh-count": { service: "human-service", method: "POST", path: "/orgs/audiences/{id}/refresh-count" },
  "POST /v1/orgs/audiences/{id}/avatar": { service: "human-service", method: "POST", path: "/orgs/audiences/{id}/avatar" },
  "GET /v1/orgs/audiences/{id}/members": { service: "human-service", method: "GET", path: "/orgs/audiences/{id}/members" },
  "GET /v1/orgs/lead-sourcing/sources": { service: "human-service", method: "GET", path: "/orgs/lead-sourcing/sources" },
  "GET /v1/orgs/audiences/{id}/preview": { service: "human-service", method: "GET", path: "/orgs/audiences/{id}/preview" },
  "GET /v1/orgs/audiences/{id}/preview/email-checks": { service: "human-service", method: "GET", path: "/orgs/audiences/{id}/preview/email-checks" },
  "POST /v1/orgs/audiences/{id}/preview/email-checks/next": { service: "human-service", method: "POST", path: "/orgs/audiences/{id}/preview/email-checks/next" },
  "GET /v1/orgs/audiences/{id}/preview/companies/email-checks": { service: "human-service", method: "GET", path: "/orgs/audiences/{id}/preview/companies/email-checks" },
  "POST /v1/orgs/audiences/{id}/preview/companies/{index}/email-check": { service: "human-service", method: "POST", path: "/orgs/audiences/{id}/preview/companies/{index}/email-check" },
  "GET /v1/orgs/audiences/{id}": { service: "human-service", method: "GET", path: "/orgs/audiences/{id}" },
  "PATCH /v1/orgs/audiences/{id}": { service: "human-service", method: "PATCH", path: "/orgs/audiences/{id}" },
  "PATCH /v1/orgs/audiences/{id}/status": { service: "human-service", method: "PATCH", path: "/orgs/audiences/{id}/status" },
  "PATCH /v1/orgs/audiences/{id}/serve-source": { service: "human-service", method: "PATCH", path: "/orgs/audiences/{id}/serve-source" },
  "POST /v1/orgs/audiences/{id}/sources": { service: "human-service", method: "POST", path: "/orgs/audiences/{id}/sources" },
  "PATCH /v1/orgs/audiences/{id}/sources/{sourceId}": { service: "human-service", method: "PATCH", path: "/orgs/audiences/{id}/sources/{sourceId}" },
  "POST /v1/orgs/google/auth/start": { service: "google-service", method: "POST", path: "/orgs/google/auth/start" },
  "GET /v1/orgs/google/auth/callback": { service: "google-service", method: "GET", path: "/orgs/google/auth/callback" },
  "GET /v1/orgs/google/accounts": { service: "google-service", method: "GET", path: "/orgs/google/accounts" },
  "DELETE /v1/orgs/google/accounts/{email}": { service: "google-service", method: "DELETE", path: "/orgs/google/accounts/{email}" },
  "GET /v1/orgs/google/calendar/accounts": { service: "google-service", method: "GET", path: "/orgs/google/calendar/accounts" },
  "DELETE /v1/orgs/google/calendar/accounts/{email}": { service: "google-service", method: "DELETE", path: "/orgs/google/calendar/accounts/{email}" },
  "POST /v1/orgs/google/sync": { service: "google-service", method: "POST", path: "/orgs/google/sync" },
  "GET /v1/orgs/google/sync/{jobId}": { service: "google-service", method: "GET", path: "/orgs/google/sync/{jobId}" },
  "GET /v1/orgs/google/messages": { service: "google-service", method: "GET", path: "/orgs/google/messages" },
  "GET /v1/orgs/google/contacts": { service: "google-service", method: "GET", path: "/orgs/google/contacts" },
  "GET /v1/orgs/google/conversation": { service: "google-service", method: "GET", path: "/orgs/google/conversation" },
  "GET /v1/orgs/google/correspondents": { service: "google-service", method: "GET", path: "/orgs/google/correspondents" },
  "PUT /v1/orgs/google/contact-links": { service: "google-service", method: "PUT", path: "/orgs/google/contact-links" },
  "POST /v1/orgs/threads/auth/start": { service: "meta-service", method: "POST", path: "/orgs/threads/auth/start" },
  "POST /v1/orgs/threads/auth/callback": { service: "meta-service", method: "POST", path: "/orgs/threads/auth/callback" },
  "GET /v1/orgs/threads/accounts": { service: "meta-service", method: "GET", path: "/orgs/threads/accounts" },
  "PATCH /v1/orgs/threads/accounts/{id}": { service: "meta-service", method: "PATCH", path: "/orgs/threads/accounts/{id}" },
  "DELETE /v1/orgs/threads/accounts/{id}": { service: "meta-service", method: "DELETE", path: "/orgs/threads/accounts/{id}" },
  "POST /v1/orgs/threads/accounts/{id}/posts": { service: "meta-service", method: "POST", path: "/orgs/threads/accounts/{id}/posts" },
  "POST /v1/orgs/x/auth/start": { service: "social-service", method: "POST", path: "/orgs/x/auth/start" },
  "POST /v1/orgs/x/auth/callback": { service: "social-service", method: "POST", path: "/orgs/x/auth/callback" },
  "GET /v1/orgs/x/accounts": { service: "social-service", method: "GET", path: "/orgs/x/accounts" },
  "PATCH /v1/orgs/x/accounts/{id}": { service: "social-service", method: "PATCH", path: "/orgs/x/accounts/{id}" },
  "DELETE /v1/orgs/x/accounts/{id}": { service: "social-service", method: "DELETE", path: "/orgs/x/accounts/{id}" },
  "POST /v1/orgs/contacts/upload": { service: "crm-service", method: "POST", path: "/orgs/contacts/upload" },
  "POST /v1/orgs/contacts": { service: "crm-service", method: "POST", path: "/orgs/contacts" },
  "GET /v1/orgs/contacts": { service: "crm-service", method: "GET", path: "/orgs/contacts" },
  "GET /v1/orgs/contacts/uploads": { service: "crm-service", method: "GET", path: "/orgs/contacts/uploads" },
  "GET /v1/orgs/contacts/serve-stats": { service: "crm-service", method: "GET", path: "/orgs/contacts/serve-stats" },
  "GET /v1/orgs/contacts/segments": { service: "crm-service", method: "GET", path: "/orgs/contacts/segments" },
  "POST /v1/orgs/contacts/serve-next": { service: "crm-service", method: "POST", path: "/orgs/contacts/serve-next" },
  "POST /v1/orgs/matrix/connections": { service: "crm-service", method: "POST", path: "/orgs/matrix/connections" },
  "GET /v1/orgs/matrix/connections": { service: "crm-service", method: "GET", path: "/orgs/matrix/connections" },
  "PATCH /v1/orgs/matrix/connections/{id}": { service: "crm-service", method: "PATCH", path: "/orgs/matrix/connections/{id}" },
  "GET /v1/orgs/matrix/leads": { service: "crm-service", method: "GET", path: "/orgs/matrix/leads" },
  "POST /v1/orgs/matrix/links": { service: "crm-service", method: "POST", path: "/orgs/matrix/links" },
  "GET /v1/orgs/matrix/links": { service: "crm-service", method: "GET", path: "/orgs/matrix/links" },
  "PATCH /v1/orgs/matrix/links/{linkId}": { service: "crm-service", method: "PATCH", path: "/orgs/matrix/links/{linkId}" },
  "POST /v1/orgs/gohighlevel/connections": { service: "crm-service", method: "POST", path: "/orgs/gohighlevel/connections" },
  "GET /v1/orgs/gohighlevel/connections": { service: "crm-service", method: "GET", path: "/orgs/gohighlevel/connections" },
  "PATCH /v1/orgs/gohighlevel/connections/{id}": { service: "crm-service", method: "PATCH", path: "/orgs/gohighlevel/connections/{id}" },
  "DELETE /v1/orgs/gohighlevel/connections/{id}": { service: "crm-service", method: "DELETE", path: "/orgs/gohighlevel/connections/{id}" },
  "POST /v1/orgs/gohighlevel/connections/{id}/booking-access": { service: "crm-service", method: "POST", path: "/orgs/gohighlevel/connections/{id}/booking-access" },
  "GET /v1/orgs/gohighlevel/scopes": { service: "crm-service", method: "GET", path: "/orgs/gohighlevel/scopes" },
  "GET /v1/orgs/gohighlevel/contacts": { service: "crm-service", method: "GET", path: "/orgs/gohighlevel/contacts" },
  "GET /v1/orgs/gohighlevel/contacts/origins": { service: "crm-service", method: "GET", path: "/orgs/gohighlevel/contacts/origins" },
  "GET /v1/orgs/gohighlevel/opportunities": { service: "crm-service", method: "GET", path: "/orgs/gohighlevel/opportunities" },
  "POST /v1/orgs/posthog/connections": { service: "crm-service", method: "POST", path: "/orgs/posthog/connections" },
  "GET /v1/orgs/posthog/connections": { service: "crm-service", method: "GET", path: "/orgs/posthog/connections" },
  "PATCH /v1/orgs/posthog/connections/{id}": { service: "crm-service", method: "PATCH", path: "/orgs/posthog/connections/{id}" },
  "DELETE /v1/orgs/posthog/connections/{id}": { service: "crm-service", method: "DELETE", path: "/orgs/posthog/connections/{id}" },
  "POST /v1/orgs/stripe/connections": { service: "crm-service", method: "POST", path: "/orgs/stripe/connections" },
  "GET /v1/orgs/stripe/connections": { service: "crm-service", method: "GET", path: "/orgs/stripe/connections" },
  "PATCH /v1/orgs/stripe/connections/{id}": { service: "crm-service", method: "PATCH", path: "/orgs/stripe/connections/{id}" },
  "DELETE /v1/orgs/stripe/connections/{id}": { service: "crm-service", method: "DELETE", path: "/orgs/stripe/connections/{id}" },
  "POST /v1/orgs/clerk/connections": { service: "crm-service", method: "POST", path: "/orgs/clerk/connections" },
  "GET /v1/orgs/clerk/connections": { service: "crm-service", method: "GET", path: "/orgs/clerk/connections" },
  "PATCH /v1/orgs/clerk/connections/{id}": { service: "crm-service", method: "PATCH", path: "/orgs/clerk/connections/{id}" },
  "DELETE /v1/orgs/clerk/connections/{id}": { service: "crm-service", method: "DELETE", path: "/orgs/clerk/connections/{id}" },
  "GET /v1/orgs/people": { service: "crm-service", method: "GET", path: "/orgs/people" },
  "GET /v1/orgs/people/timeline": { service: "crm-service", method: "GET", path: "/orgs/people/timeline" },
  "GET /v1/orgs/people/api-calls/{callId}": { service: "crm-service", method: "GET", path: "/orgs/people/api-calls/{callId}" },
  "GET /v1/orgs/people/outcomes": { service: "crm-service", method: "GET", path: "/orgs/people/outcomes" },
  "GET /v1/orgs/people/outcomes/people": { service: "crm-service", method: "GET", path: "/orgs/people/outcomes/people" },
  "POST /v1/orgs/people/merges": { service: "crm-service", method: "POST", path: "/orgs/people/merges" },
  "GET /v1/orgs/people/merges": { service: "crm-service", method: "GET", path: "/orgs/people/merges" },
  "POST /v1/orgs/people/merges/{mergeId}/undo": { service: "crm-service", method: "POST", path: "/orgs/people/merges/{mergeId}/undo" },
  "POST /v1/orgs/people/handles": { service: "crm-service", method: "POST", path: "/orgs/people/handles" },
  "GET /v1/orgs/people/handles": { service: "crm-service", method: "GET", path: "/orgs/people/handles" },
  "POST /v1/orgs/people/handles/{handleId}/undo": { service: "crm-service", method: "POST", path: "/orgs/people/handles/{handleId}/undo" },
  "POST /v1/orgs/people/corrections": { service: "crm-service", method: "POST", path: "/orgs/people/corrections" },
  "GET /v1/orgs/people/corrections": { service: "crm-service", method: "GET", path: "/orgs/people/corrections" },
  "POST /v1/orgs/people/corrections/{correctionId}/undo": { service: "crm-service", method: "POST", path: "/orgs/people/corrections/{correctionId}/undo" },
  "GET /v1/orgs/people/organizations": { service: "crm-service", method: "GET", path: "/orgs/people/organizations" },
  "GET /v1/qualification/catalog": { service: "lead-service", method: "GET", path: "/orgs/qualification/catalog" },
  "POST /v1/brands/{id}/offers/{offerId}/qualification/criteria": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/criteria" },
  "POST /v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}/sample": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/offers/{offerId}/qualification/criteria/{criterionId}/sample" },
  "GET /v1/leads/{id}/qualification": { service: "lead-service", method: "GET", path: "/orgs/leads/{id}/qualification" },
  "POST /v1/replies": { service: "instantly-service", method: "POST", path: "/orgs/replies" },
  "POST /v1/orgs/{orgId}/member-invitations": { service: "client-service", method: "POST", path: "/internal/orgs/{orgId}/member-invitations" },
  "GET /v1/orgs/{orgId}/member-invitations": { service: "client-service", method: "GET", path: "/internal/orgs/{orgId}/member-invitations" },
  "POST /v1/orgs/{orgId}/phone-members": { service: "client-service", method: "POST", path: "/internal/orgs/{orgId}/phone-members" },
  "DELETE /v1/orgs/{orgId}/member-invitations/{invitationId}": { service: "client-service", method: "DELETE", path: "/internal/orgs/{orgId}/member-invitations/{invitationId}" },
  "POST /v1/orgs/{orgId}/owner-telegram/link-codes": { service: "client-service", method: "POST", path: "/internal/orgs/{orgId}/owner-telegram/link-codes" },
  "GET /v1/orgs/{orgId}/owner-telegram": { service: "client-service", method: "GET", path: "/internal/orgs/{orgId}/owner-telegram" },
  "DELETE /v1/orgs/{orgId}/owner-telegram": { service: "client-service", method: "DELETE", path: "/internal/orgs/{orgId}/owner-telegram" },
  "GET /v1/brands/{brandId}/relationships/review": { service: "lead-service", method: "GET", path: "/orgs/brands/{brandId}/relationships/review" },
  "POST /v1/brands/{brandId}/relationships/merge-questions/{questionId}/answer": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/relationships/merge-questions/{questionId}/answer" },
  "POST /v1/brands/{brandId}/relationships/merges/{linkId}/undo": { service: "lead-service", method: "POST", path: "/orgs/brands/{brandId}/relationships/merges/{linkId}/undo" },
  "PUT /v1/brands/{brandId}/relationships/{humanId}/tags/{tag}": { service: "lead-service", method: "PUT", path: "/orgs/brands/{brandId}/relationships/{humanId}/tags/{tag}" },
  "DELETE /v1/brands/{brandId}/relationships/{humanId}/tags/{tag}": { service: "lead-service", method: "DELETE", path: "/orgs/brands/{brandId}/relationships/{humanId}/tags/{tag}" },
  "PUT /v1/brands/{brandId}/relationships/{humanId}/company": { service: "lead-service", method: "PUT", path: "/orgs/brands/{brandId}/relationships/{humanId}/company" },
  "GET /v1/leads/{id}/relationship": { service: "lead-service", method: "GET", path: "/orgs/leads/{id}/relationship" },
  "DELETE /v1/orgs/matrix/links/{channel}": { service: "crm-service", method: "DELETE", path: "/orgs/matrix/links/{channel}" },
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
        op.description = `${op.description ?? ""}\n\nResponse: documented from ${entry.service} ${entry.method} ${entry.path}, which owns it; the gateway forwards it unchanged. Its full document: GET /v1/platform/services/${entry.service.replace(/-service$/, "")}.`.trim();
      }
    }
  }
}
