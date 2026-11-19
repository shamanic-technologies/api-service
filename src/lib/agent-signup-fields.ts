/**
 * What a PUBLIC caller may state on the keyless agent signup (security hotfix
 * 2026-11-19, DISTRY-ONE-AI-1118; owner-approved exception to CLAUDE.md rule #4).
 *
 * `POST /v1/agent-signups/{start,complete}` take no key, and client-service's
 * `/internal/agent-signups/*` is also called by our own trusted channels, which
 * set fields no stranger may set: on complete, `whatsappPhone` moves a WhatsApp
 * number onto the proven account (and off whoever held it), `claimOrgId` +
 * `claimOrgExternalId` hand an unclaimed org to the proven person. Forwarding the
 * whole body made each of them public the day client-service shipped it.
 *
 * So these two routes forward an ALLOW-list: the email and its proof. A field
 * client-service adds later is internal-only here until it is added below, which
 * is the point (same stance as `customer-email-view.ts`). A trusted channel calls
 * client-service itself, never this route.
 *
 * The published body follows the same lists (`DOWNSTREAM_BODY_SOURCES.only` for
 * start, the typed `AgentSignupCompleteRequestSchema` for complete), pinned by
 * `tests/unit/agent-signups-openapi.test.ts`.
 */
export const AGENT_SIGNUP_START_FIELDS = ["email", "phone"] as const;
export const AGENT_SIGNUP_COMPLETE_FIELDS = ["email", "code", "pollToken"] as const;

/** A 10 MB body can carry any number of keys of any length: the log line names a few, shortened. */
const MAX_NAMED_KEYS = 10;
const MAX_KEY_CHARS = 40;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * The part of `body` a public caller may state, in the caller's own key order
 * (an allowed body goes out byte-equal). Anything else is dropped silently for
 * the caller (no new 400: a live caller must not start failing) and named once
 * in the log: the keys only, never a value, since a value here is an email
 * proof, a phone number or an org secret.
 *
 * `own` = fields the gateway consumes itself (`keyName`): not forwarded, and not
 * a dropped field either.
 */
export function pickPublicSignupFields(
  route: "start" | "complete",
  body: unknown,
  allowed: readonly string[],
  own: readonly string[] = [],
): Record<string, unknown> {
  if (!isObject(body)) return {};
  const allow = new Set(allowed);
  const mine = new Set(own);
  const forwarded: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (allow.has(key)) forwarded[key] = value;
    else if (!mine.has(key)) dropped.push(key);
  }
  if (dropped.length > 0) {
    // JSON.stringify escapes control characters: a key cannot forge a second log line.
    const named = JSON.stringify(dropped.slice(0, MAX_NAMED_KEYS).map((key) => key.slice(0, MAX_KEY_CHARS)));
    const more = dropped.length > MAX_NAMED_KEYS ? ` (first ${MAX_NAMED_KEYS} shown)` : "";
    console.warn(
      `[agent-signups] ${route}: dropped ${dropped.length} body field(s) a public caller may not state, not forwarded to client-service: ${named}${more}`,
    );
  }
  return forwarded;
}
