/**
 * A refusal because a campaign (sales funnel) reached the MAX BUDGET its owner set.
 *
 * billing-service `POST /v1/customer_balance/authorize` answers `sufficient: false`
 * for two different reasons: the balance is too low, or the funnel's max budget is
 * reached. Only the second carries `reason` (`sales_funnel_max_budget_reached` /
 * `sales_funnel_max_budget_unreadable`) and `sales_funnel_cap`
 * `{ salesFunnelId, salesFunnelCampaignId, amountCents, period, consumedCents,
 * reservedCents }`. Siblings that relay the refusal (chat-service, lead-service, ...)
 * keep both fields under the same names on their 402 body.
 *
 * Adding credit changes nothing for a cap refusal, so the gateway must never answer
 * it with "add credit / prepay" advice nor flatten those fields away. It relays
 * what billing decided; it decides nothing itself.
 */

export const SALES_FUNNEL_CAP_REASONS = [
  "sales_funnel_max_budget_reached",
  "sales_funnel_max_budget_unreadable",
] as const;

export type SalesFunnelCapReason = (typeof SALES_FUNNEL_CAP_REASONS)[number];

export interface SalesFunnelCapRefusal extends Record<string, unknown> {
  reason: SalesFunnelCapReason;
}

/** The body, when it is a JSON object refusing a call for a funnel's max budget. */
export function asSalesFunnelCapRefusal(body: unknown): SalesFunnelCapRefusal | null {
  const obj = typeof body === "string" ? parseObject(body) : body;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const reason = (obj as Record<string, unknown>).reason;
  if (typeof reason !== "string" || !(SALES_FUNNEL_CAP_REASONS as readonly string[]).includes(reason)) return null;
  return obj as SalesFunnelCapRefusal;
}

/** Plain words naming the cause and the one action that helps: raise the max budget. */
export function salesFunnelCapMessage(reason: SalesFunnelCapReason): string {
  if (reason === "sales_funnel_max_budget_unreadable") {
    return (
      "This call was refused because the campaign's max budget could not be read, so the spend could not be checked against it. " +
      "Adding credit will not help. Check the campaign's max budget, then retry."
    );
  }
  return (
    "This call was refused because the campaign reached the max budget set for it. " +
    "Adding credit will not help. Raise the campaign's max budget, or wait for the next budget period."
  );
}

/**
 * The answer the caller gets: the refusal's own fields verbatim (`reason`,
 * `sales_funnel_cap`, `error`, `type`, balance fields...), plus a `message` naming
 * the max budget when the sender wrote none.
 */
export function namedSalesFunnelCapBody(refusal: SalesFunnelCapRefusal): Record<string, unknown> {
  if (typeof refusal.message === "string" && refusal.message.length > 0) return refusal;
  return { ...refusal, message: salesFunnelCapMessage(refusal.reason) };
}

function parseObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Not JSON: no fields to read, so not a cap refusal.
    return null;
  }
}
