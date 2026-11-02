/**
 * Which operations need the person's YES before an agent calls them
 * (SOPHIE-YES-GATE-1102, owner rule: nothing that spends money, starts work or
 * sends something to a person happens without the person's explicit yes first).
 *
 * The gateway does NOT enforce the yes: the CALLER does (Sophie in chat-service,
 * the distribute.you MCP, any outside agent asking its own user). The gateway's
 * job is to SAY, per operation, in the document it serves, whether the operation
 * is one of those, so no consumer keeps its own list of operation ids.
 *
 * Every write operation of the document (anything but GET) carries a decision
 * here, keyed `"<METHOD> <path template>"` exactly like `STAFF_KEY_OPERATIONS`:
 *
 * - `yes([...], why)`: the operation is marked `x-needs-user-yes` in the
 *   document, with the reasons and one line the agent can turn into its ask.
 *   `notNeededWhen` lists request-body values that make THIS call harmless
 *   (a campaign created `status: "stopped"`, a brand set `paused: true`).
 * - `NO`: decided, no yes needed (a read, a setting, a creation that starts
 *   stopped / off / paused, a proposal or preview that is part of setting up).
 *
 * A GET is never marked: reads need no yes. `tests/unit/openapi-user-yes.test.ts`
 * fails the build when a write operation is added without a decision here, when
 * a decision names an operation that no longer exists, or when a GET appears.
 *
 * Where the line sits:
 * - `spends_money`: the call charges the account (card, balance, a plan) or
 *   changes how much it may be charged (caps, budgets, auto top-up, payment
 *   mode), or runs a per-item paid action in volume (email checks, audits,
 *   qualification runs on real leads, video). Drafting a proposal, a suggestion
 *   or a preview while setting up is NOT marked: it is the routine of building
 *   the account, asked for by the person in the same breath.
 * - `starts_work`: the call sets running something that will spend or contact
 *   people on its own (a campaign, a workflow run, an audience feeding a
 *   running campaign, a brand unpaused).
 * - `sends_to_person`: the call sends, or lets us send, a message to a human
 *   (an email, a reply, a post, an invitation, a mailing-list update).
 */

export type UserYesReason = "spends_money" | "starts_work" | "sends_to_person";

export interface UserYesMarker {
  because: UserYesReason[];
  why: string;
  /** Request-body values (each entry: every key equal) under which this call needs no yes. */
  notNeededWhen?: Record<string, unknown>[];
}

export const USER_YES_EXTENSION = "x-needs-user-yes";

const NO = null;
type Decision = UserYesMarker | null;

const yes = (
  because: UserYesReason[],
  why: string,
  notNeededWhen?: Record<string, unknown>[],
): UserYesMarker => (notNeededWhen ? { because, why, notNeededWhen } : { because, why });

const SPEND: UserYesReason[] = ["spends_money"];
const START: UserYesReason[] = ["starts_work", "spends_money"];
const SEND: UserYesReason[] = ["sends_to_person"];

export const USER_YES_DECISIONS: Record<string, Decision> = {
  // ── Campaigns ──────────────────────────────────────────────────────────────
  "POST /v1/campaigns": yes(START, "Creates a campaign that runs: it finds and contacts people and spends the budget."),
  "POST /v1/campaigns/start-funded-pair": yes(START, "Starts a campaign: it finds and contacts people and spends the budget."),
  "POST /v1/trigger-events": yes(
    ["sends_to_person", "starts_work", "spends_money"],
    "Fires a trigger for a person: the campaign on it writes to them (an email pushed this way is sent).",
  ),
  "POST /v1/sales-funnel-campaigns": yes(
    START,
    "Launches a sales funnel campaign running: it finds and contacts people and spends up to the funnel's max budget.",
    [{ status: "stopped" }],
  ),
  "PATCH /v1/sales-funnel-campaigns/{id}": yes(
    START,
    "Sets the whole sales funnel campaign running: it finds and contacts people and spends up to the funnel's max budget.",
    [{ status: "stop" }],
  ),
  "DELETE /v1/sales-funnel-campaigns/{id}": NO,
  "PATCH /v1/campaigns/{id}": yes(START, "Edits a campaign; resuming it starts finding and contacting people again.", [
    { status: "stopped" },
  ]),
  "POST /v1/campaigns/{id}/stop": NO,
  "PATCH /v1/brands/{brandId}/pause": yes(
    START,
    "Unpausing a brand lets every campaign of it run again: contacting people and spending.",
    [{ paused: true }],
  ),

  // ── Keys / auth ────────────────────────────────────────────────────────────
  "POST /v1/keys": NO,
  "DELETE /v1/keys/{provider}": NO,
  "POST /v1/keys/brands/{brandId}": NO,
  "DELETE /v1/keys/brands/{brandId}/{provider}": NO,
  "PUT /v1/keys/{provider}/source": NO,
  "POST /v1/keys/provider-requirements": NO,
  "POST /v1/api-keys": NO,
  "DELETE /v1/api-keys/{id}": NO,
  "POST /v1/api-keys/session": NO,
  "POST /v1/users/resolve": NO,
  "POST /v1/agent-signups/start": NO,
  "POST /v1/agent-signups/complete": NO,

  // ── Leads ──────────────────────────────────────────────────────────────────
  "POST /v1/leads/search": NO,
  "POST /v1/leads/crm-pairings/rulings": NO,
  "DELETE /v1/leads/crm-pairings/rulings": NO,
  "POST /v1/leads/{id}/step-statements": NO,
  "DELETE /v1/leads/{id}/step-statements/{step}": NO,
  "PUT /v1/leads/{id}/disqualification": NO,
  "DELETE /v1/leads/{id}/disqualification": NO,
  "PUT /v1/leads/{id}/not-a-person": NO,
  "DELETE /v1/leads/{id}/not-a-person": NO,
  "POST /v1/brands/{brandId}/conversions/{conversionId}/withdraw": NO,
  "DELETE /v1/brands/{brandId}/conversions/{conversionId}/withdrawal": NO,
  "POST /v1/leads/{id}/answered-outside": NO,
  "POST /v1/leads/{id}/followups": NO,
  "POST /v1/leads/crm-evidence/sync": NO,
  "PUT /v1/leads/{id}/crm-attribution/{step}": NO,
  "DELETE /v1/leads/{id}/crm-attribution/{step}": NO,
  "POST /v1/qualify": NO,
  "POST /v1/brands/{id}/offers/{offerId}/qualification/suggestions": yes(
    SPEND,
    "Writes qualification criteria with AI (billed to the account).",
  ),
  "POST /v1/brands/{id}/offers/{offerId}/qualification/criteria": NO,
  "PATCH /v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}": yes(
    SPEND,
    "Turning a qualification check on runs it, billed, on every new lead of the offer.",
    [{ enabled: false }],
  ),
  "DELETE /v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}": NO,
  "POST /v1/brands/{id}/offers/{offerId}/qualification/criteria/{criterionId}/sample": yes(
    SPEND,
    "Runs a qualification check on real leads (billed per lead).",
  ),
  "POST /v1/brands/{id}/offers/{offerId}/qualification/previews": yes(
    SPEND,
    "Runs the offer's qualification checks on sample companies (billed per company).",
  ),
  "POST /v1/brands/{brandId}/relationships/merge-questions/{questionId}/answer": NO,
  "POST /v1/brands/{brandId}/relationships/merges/{linkId}/undo": NO,
  "PUT /v1/brands/{brandId}/relationships/{humanId}/tags/{tag}": NO,
  "DELETE /v1/brands/{brandId}/relationships/{humanId}/tags/{tag}": NO,
  "PUT /v1/brands/{brandId}/relationships/{humanId}/company": NO,

  // ── Brand / offers ─────────────────────────────────────────────────────────
  "POST /v1/scraping/scrape": NO,
  "POST /v1/brands": NO,
  "PATCH /v1/brands/{id}": NO,
  "POST /v1/brands/extract-fields": NO,
  "POST /v1/brands/extract-images": NO,
  "PUT /v1/brands/{id}/leg-rates": NO,
  "PUT /v1/brands/{id}/offers/{offerId}/economics": NO,
  "POST /v1/brands/{id}/offers/proposals": NO,
  "POST /v1/brands/{id}/offers/confirm": NO,
  "POST /v1/brands/{id}/offers/{offerId}/image": NO,
  "POST /v1/brands/{id}/offers/{offerId}/archive": NO,
  "POST /v1/brands/{id}/offers/{offerId}/unarchive": NO,
  "PUT /v1/brands/{id}/offers/{offerId}/steps/{stepKey}": NO,
  "DELETE /v1/brands/{id}/offers/{offerId}/steps/{stepKey}": NO,
  "POST /v1/brands/{id}/offers/{offerId}/documents": NO,
  "PATCH /v1/brands/{id}/offers/{offerId}/documents/{documentId}": NO,
  "DELETE /v1/brands/{id}/offers/{offerId}/documents/{documentId}": NO,
  "PUT /v1/brands/{id}/click-destination": NO,
  "PUT /v1/brands/{id}/sales-rep-phone": NO,
  "DELETE /v1/brands/{id}/sales-rep-phone": NO,
  "PUT /v1/brands/{id}/linkedin-page": NO,
  "DELETE /v1/brands/{id}/linkedin-page": NO,
  "POST /v1/brands/{id}/competitors/discover": NO,
  "PUT /v1/brands/{id}/sales-rep": NO,
  "DELETE /v1/brands/{id}/sales-rep": NO,
  "PUT /v1/brands/{id}/business-context": NO,
  "POST /v1/brands/{id}/conversion-token/rotate": NO,
  "POST /v1/brands/{id}/share-token": NO,
  "DELETE /v1/brands/{id}/share-token": NO,
  "POST /v1/brands/{id}/share-token/rotate": NO,
  "POST /v1/share-tokens/resolve": NO,
  "POST /v1/brands/{id}/icp/suggest": NO,
  "PUT /v1/brands/{id}/user-fields": NO,
  "PUT /v1/brands/{id}/offers/{offerId}/user-fields": NO,
  "POST /v1/brands/{id}/transfer": NO,
  "POST /v1/features/{featureSlug}/prefill": NO,
  "POST /public/conversions": NO,

  // ── Workflows / scripts / content (authoring) ──────────────────────────────
  "POST /v1/workflows": NO,
  "PUT /v1/workflows/{id}": NO,
  "POST /v1/workflows/create": NO,
  "POST /v1/workflows/upgrade": NO,
  "POST /v1/workflows/{id}/validate": NO,
  "POST /v1/workflows/{id}/prompt-edit": NO,
  "POST /v1/workflows/dynasty/{workflowDynastySlug}/prompt-edit": NO,
  "POST /v1/workflows/{id}/fork": NO,
  "POST /v1/workflows/dynasty/{workflowDynastySlug}/fork": NO,
  "PUT /v1/workflows/dynasty/{workflowDynastySlug}/status": NO,
  "PUT /v1/workflows/{id}/status": NO,
  "POST /v1/workflows/{id}/execute": yes(START, "Runs a workflow now: it spends and may contact people."),
  "POST /v1/workflow-runs/{id}/cancel": NO,
  "POST /v1/workflows/retire-by-content": NO,
  "PUT /v1/prompts": NO,
  "POST /v1/scripts": NO,
  "POST /v1/scripts/dynasty/{outcome}/{dynasty}/upgrade": NO,
  "POST /v1/scripts/dynasty/{outcome}/{dynasty}/fork": NO,
  "PUT /v1/scripts/dynasty/{outcome}/{dynasty}/status": NO,
  "POST /v1/scripts/dynasty/{outcome}/{dynasty}/replay": NO,
  "POST /v1/content/compose": yes(SPEND, "Renders a personalized video (billed to the account)."),
  "POST /v1/content/generate-expert-quote-pitch": NO,
  "POST /v1/content/preview-email": NO,
  "POST /v1/content/preview-email/prepare": NO,
  "POST /v1/content/platform-prompts": NO,
  "PUT /v1/content/prompt-assignments": NO,
  "PUT /v1/content/models/{model}/status": NO,
  "PUT /v1/content/templates/{type}/status": NO,
  "POST /v1/content/template-dynasties": NO,
  "POST /v1/content/template-dynasties/{slug}/versions": NO,
  "POST /v1/content/template-dynasties/{slug}/merge": NO,

  // ── Chat / platform / activity ─────────────────────────────────────────────
  "POST /v1/activity": NO,
  "PUT /v1/chat/config": NO,
  "POST /v1/chat": NO,
  "PUT /v1/chat/skills/{slug}": NO,
  "POST /platform-keys": NO,
  "PUT /platform-prompts": NO,
  "PUT /platform-chat/config": NO,
  "POST /v1/staff-requests": NO,
  "POST /v1/platform-uploads": NO,
  "POST /v1/orgs/uploads": NO,

  // ── Billing ────────────────────────────────────────────────────────────────
  "PUT /v1/billing/accounts/monthly_charge_limit": yes(SPEND, "Changes how much the account may be charged per month."),
  "DELETE /v1/billing/accounts/monthly_charge_limit": yes(SPEND, "Removes the monthly charge limit: charges are no longer capped."),
  "POST /v1/billing/accounts/pay_balance": yes(SPEND, "Charges the saved card for what the account owes."),
  "PUT /v1/billing/accounts/topup_minimums": NO,
  "POST /v1/billing/accounts/card_setup": NO,
  "DELETE /v1/billing/accounts/saved_payment_method": NO,
  "PATCH /v1/billing/accounts/auto_topup": yes(SPEND, "Sets the card to be charged automatically when the balance runs low."),
  "DELETE /v1/billing/accounts/auto_topup": NO,
  "PATCH /v1/promo-codes/{code}": NO,
  "POST /v1/billing/credits/grant": NO,
  "POST /v1/billing/credits/debit": yes(SPEND, "Takes money off the account's balance."),
  "PUT /v1/billing/accounts/payment_mode": yes(SPEND, "Changes how the account is charged (prepaid or postpaid)."),
  "PUT /v1/billing/accounts/by-org/{orgId}/payment-mode": yes(SPEND, "Changes how the account is charged (prepaid or postpaid)."),
  "PATCH /v1/billing/accounts/subscription": yes(SPEND, "Changes the monthly amount charged to the card."),
  "POST /v1/billing/accounts/subscription/checkout_session": NO,
  "POST /v1/billing/accounts/subscription/start": yes(SPEND, "Starts the monthly plan: the card is charged."),
  "POST /v1/billing/accounts/subscription/cancel": NO,
  "POST /v1/billing/accounts/subscription/resume": yes(SPEND, "Resumes the monthly plan: the card is charged again."),
  "POST /v1/billing/accounts/subscription/pause": NO,
  "POST /v1/billing/accounts/subscription/unpause": yes(SPEND, "Unpauses the monthly plan: the card is charged again."),
  "POST /v1/billing/accounts/subscriptions": yes(SPEND, "Starts a monthly plan: the first month is charged now."),
  "PATCH /v1/billing/accounts/subscriptions/{subscriptionId}": yes(SPEND, "Changes the monthly amount charged to the card."),
  "POST /v1/billing/accounts/subscriptions/{subscriptionId}/cancel": NO,
  "POST /v1/billing/accounts/subscriptions/{subscriptionId}/resume": yes(SPEND, "Resumes a monthly plan: the card is charged again."),
  "POST /v1/billing/accounts/subscriptions/{subscriptionId}/pause": NO,
  "POST /v1/billing/accounts/subscriptions/{subscriptionId}/unpause": yes(SPEND, "Unpauses a monthly plan: the card is charged again."),
  "POST /v1/billing/accounts/prepaid_checkout": yes(SPEND, "Opens a payment for the amount chosen, with an automatic top-up."),
  "POST /v1/billing/checkout-sessions": yes(SPEND, "Opens a payment page that charges the card."),
  "POST /v1/billing/accounts/charge": yes(SPEND, "Charges the saved card the stated amount."),
  "POST /v1/billing/portal-sessions": NO,
  "PATCH /v1/brands/{brandId}/daily-budget": yes(SPEND, "Changes how much the brand may spend per day."),
  "PUT /v1/brands/{brandId}/sales-budget": yes(SPEND, "Changes how much the brand may spend per day."),
  "DELETE /v1/brands/{brandId}/sales-budget": yes(SPEND, "Removes the brand's daily budget: each campaign's own ceiling applies again."),
  "PUT /v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps": yes(
    SPEND,
    "Changes the sales funnel's max budget and max volume: what its campaign may spend.",
  ),
  "DELETE /v1/brands/{brandId}/offers/{offerId}/sales-funnels/{salesFunnelId}/caps": yes(
    SPEND,
    "Clears the sales funnel's max budget and max volume.",
  ),
  "PUT /v1/billing/usage-discount": NO,
  "DELETE /v1/billing/usage-discount": NO,
  "POST /v1/stripe/products": NO,
  "POST /v1/stripe/prices": NO,
  "POST /v1/stripe/coupons": NO,
  "POST /v1/stripe/checkout": yes(SPEND, "Opens a payment page that charges the card."),

  // ── Emails / conversations ─────────────────────────────────────────────────
  "POST /v1/emails/send": yes(SEND, "Sends an email."),
  "POST /v1/replies": yes(SEND, "Sends a reply to a person in their email thread."),
  "POST /v1/emails/manual-qualifications": NO,
  "POST /v1/emails/manual-qualifications/withdrawals": NO,
  "POST /v1/emails/opt-outs": NO,
  "POST /v1/emails/opt-outs/withdrawals": NO,
  "PUT /v1/emails/templates": NO,
  "PUT /internal/emails/templates": NO,
  "PUT /v1/email-signature": NO,
  "DELETE /v1/email-signature": NO,
  "POST /v1/followup-cuts": NO,

  // ── Staff ops ──────────────────────────────────────────────────────────────
  "POST /v1/features/stated-monthly-amounts": NO,
  "PATCH /v1/features/stated-monthly-amounts/{id}": NO,
  "DELETE /v1/features/stated-monthly-amounts/{id}": NO,
  "POST /v1/instantly/ops/domain-blocklist/check": NO,
  "POST /v1/instantly/ops/domain-blocklist/removal-requests": NO,
  "POST /v1/instantly/ops/lead-source-yield/sync": NO,
  "POST /v1/crm/ops/whatsapp-lines/check": NO,

  // ── Plays / catalogue ──────────────────────────────────────────────────────
  "POST /v1/tactics": NO,
  "PATCH /v1/tactics/{id}": NO,
  "POST /v1/strategies": NO,
  "PATCH /v1/strategies/{id}": NO,
  "POST /v1/plays": NO,
  "POST /v1/catalogue/steps": NO,
  "POST /v1/catalogue/sales-paths": NO,
  "POST /v1/catalogue/pipes": NO,
  "POST /v1/declarations/channels": NO,
  "PATCH /v1/declarations/channels/{slug}": NO,
  "POST /v1/declarations/channels/{slug}/legs": NO,
  "PATCH /v1/declarations/channels/{slug}/legs/{legKey}": NO,
  "POST /v1/catalogue/pipes/{pipeId}/retire": NO,
  "POST /v1/catalogue/plays/{playId}/retire": NO,
  "POST /v1/catalogue/sales-funnels": NO,
  "PUT /v1/catalogue/pipes/{pipeId}/default-play": NO,

  // ── Expert quotes / visibility (retired products still routed) ─────────────
  "POST /v1/orgs/opportunities/next": NO,
  "POST /v1/orgs/opportunities/discover": yes(SPEND, "Scores a batch of opportunities with AI (billed to the account)."),
  "POST /v1/orgs/opportunities/{id}/reply": yes(SEND, "Sends a pitch reply to a journalist."),
  "POST /v1/orgs/visibility-score-runs": yes(SPEND, "Runs an AI visibility audit (billed to the account)."),

  // ── Invites / waitlist / organizations ─────────────────────────────────────
  "POST /v1/invites/validate": NO,
  "POST /v1/waitlist/request-access": NO,
  "POST /v1/orgs/{orgId}/invites/claim": NO,
  "POST /v1/orgs": NO,
  "POST /v1/orgs/{orgId}/members": NO,
  "DELETE /v1/orgs/{orgId}/members/{userId}": NO,
  "POST /v1/orgs/{orgId}/join-link": NO,
  "DELETE /v1/orgs/{orgId}/join-link": NO,
  "PUT /v1/orgs/{orgId}/membership-limit": NO,
  "POST /v1/orgs/{orgId}/member-invitations": yes(SEND, "Emails an invitation to join the account to that person."),
  "DELETE /v1/orgs/{orgId}/member-invitations/{invitationId}": NO,
  "POST /v1/orgs/{orgId}/owner-telegram/link-codes": NO,
  "DELETE /v1/orgs/{orgId}/owner-telegram": NO,

  // ── Audiences ──────────────────────────────────────────────────────────────
  "POST /v1/orgs/audiences/suggest": NO,
  "POST /v1/orgs/audiences/split": NO,
  "POST /v1/orgs/audiences/split/confirm": NO,
  "POST /v1/orgs/audiences/split/estimate": NO,
  "POST /v1/orgs/audiences/signal": NO,
  "POST /v1/orgs/audiences/portfolio": NO,
  "POST /v1/orgs/audiences/stats": NO,
  "POST /v1/orgs/audiences": NO,
  "POST /v1/orgs/audiences/{id}/refresh-count": NO,
  "POST /v1/orgs/audiences/{id}/avatar": NO,
  "POST /v1/orgs/audiences/{id}/preview/email-checks/next": yes(SPEND, "Checks one more email (billed per check)."),
  "POST /v1/orgs/audiences/{id}/preview/companies/{index}/email-check": yes(SPEND, "Checks an email (billed per check)."),
  "PATCH /v1/orgs/audiences/{id}": NO,
  "DELETE /v1/orgs/audiences/{id}": NO,
  "PATCH /v1/orgs/audiences/{id}/status": yes(
    START,
    "An active audience feeds the brand's running campaigns: they find and contact its people.",
    [{ status: "paused" }, { status: "archived" }],
  ),
  "PATCH /v1/orgs/audiences/{id}/serve-source": NO,
  "POST /v1/orgs/audiences/{id}/sources": NO,
  "PATCH /v1/orgs/audiences/{id}/sources/{sourceId}": NO,

  // ── Connected accounts (Google, Threads, X, CRM connectors) ────────────────
  "POST /v1/orgs/google/auth/start": NO,
  "DELETE /v1/orgs/google/accounts/{email}": NO,
  "DELETE /v1/orgs/google/calendar/accounts/{email}": NO,
  "POST /v1/orgs/google/sync": NO,
  "PUT /v1/orgs/google/contact-links": NO,
  "POST /v1/orgs/threads/auth/start": NO,
  "POST /v1/orgs/threads/auth/callback": NO,
  "PATCH /v1/orgs/threads/accounts/{id}": NO,
  "DELETE /v1/orgs/threads/accounts/{id}": NO,
  "POST /v1/orgs/threads/accounts/{id}/posts": yes(SEND, "Publishes a post or a reply on Threads, in public."),
  "POST /v1/orgs/x/auth/start": NO,
  "POST /v1/orgs/x/auth/callback": NO,
  "PATCH /v1/orgs/x/accounts/{id}": NO,
  "DELETE /v1/orgs/x/accounts/{id}": NO,
  "POST /v1/orgs/contacts/upload": NO,
  "POST /v1/orgs/contacts": NO,
  "POST /v1/orgs/contacts/serve-next": yes(START, "Hands the next contacts to the brand's campaign, which writes to them."),
  "POST /v1/orgs/matrix/connections": NO,
  "PATCH /v1/orgs/matrix/connections/{id}": NO,
  "POST /v1/orgs/matrix/links": NO,
  "DELETE /v1/orgs/matrix/links/{channel}": NO,
  "PATCH /v1/orgs/matrix/links/{linkId}": yes(
    SEND,
    "Can let our AI write to people from this WhatsApp / Telegram / Discord account.",
    [{ automationAllowed: false }],
  ),
  "POST /v1/orgs/gohighlevel/connections": NO,
  "PATCH /v1/orgs/gohighlevel/connections/{id}": NO,
  "DELETE /v1/orgs/gohighlevel/connections/{id}": NO,
  "POST /v1/orgs/posthog/connections": NO,
  "PATCH /v1/orgs/posthog/connections/{id}": NO,
  "DELETE /v1/orgs/posthog/connections/{id}": NO,
  "POST /v1/orgs/stripe/connections": NO,
  "PATCH /v1/orgs/stripe/connections/{id}": NO,
  "DELETE /v1/orgs/stripe/connections/{id}": NO,
  "POST /v1/orgs/clerk/connections": NO,
  "PATCH /v1/orgs/clerk/connections/{id}": NO,
  "DELETE /v1/orgs/clerk/connections/{id}": NO,
  "POST /v1/orgs/people/sync": NO,
  "POST /v1/orgs/people/merges": NO,
  "POST /v1/orgs/people/merges/{mergeId}/undo": NO,
  "POST /v1/orgs/people/handles": NO,
  "POST /v1/orgs/people/handles/{handleId}/undo": NO,
  "POST /v1/orgs/people/corrections": NO,
  "POST /v1/orgs/people/corrections/{correctionId}/undo": NO,

  // ── Mailing lists (staff) ──────────────────────────────────────────────────
  "POST /v1/mailing-lists/{slug}/subscribers": NO,
  "DELETE /v1/mailing-lists/{slug}/subscribers": NO,
  "POST /v1/mailing-lists/updates/preview": NO,
  "POST /v1/mailing-lists/{slug}/updates": yes(SEND, "Emails the update to every address on the list."),
  "POST /v1/mailing-lists/{slug}/releases": yes(SEND, "Starts emailing the update to the list, a batch per day."),
  "PATCH /v1/mailing-lists/releases/{releaseId}/pace": NO,
  "POST /v1/mailing-lists/releases/{releaseId}/pause": NO,
  "POST /v1/mailing-lists/releases/{releaseId}/resume": yes(SEND, "Lets the held release email the list again."),
  "POST /v1/mailing-lists/releases/{releaseId}/cancel": NO,
};

interface OperationLike {
  [k: string]: unknown;
}

/**
 * Stamp `x-needs-user-yes` on every operation whose decision is a yes.
 * Runs on the full document, before the audience strip, so every audience
 * (public, staff-key, staff) carries the same marker on the operations it keeps.
 */
export function attachUserYes(document: Record<string, unknown>): void {
  const paths = document.paths as Record<string, Record<string, OperationLike>> | undefined;
  for (const [path, pathItem] of Object.entries(paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      const decision = USER_YES_DECISIONS[`${method.toUpperCase()} ${path}`];
      if (decision) operation[USER_YES_EXTENSION] = decision;
    }
  }
}
