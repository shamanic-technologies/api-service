/**
 * Prepay instructions for organizations opened through the API (AI agents).
 *
 * Owner 2026-11-18: « enlever definitivement le seuil de $5. On mets $0 pour tout
 * le monde. On ne permet pas de changer cette valeur nulle part »: the reload
 * threshold is billing's ($0, not changeable), so these instructions never name
 * nor send one. The reload AMOUNT minimum/default and the first top-up minimum
 * are read from billing too. Those
 * figures have ONE home, billing-service (RELOAD-RULE-ONE-HOME-1118): a stale
 * local copy here ($15) gave a real client a $15 reload. So this file holds NO
 * amount: the instructions quote billing's `reload-rules` for the org, and the
 * prepaid checkout forwards the body to billing, which applies its default when
 * the reload amount is absent and refuses anything under the org's rule
 * (400 `code` + `minimum_cents` + `error`, relayed verbatim).
 * No free credit, no trial, no subscription on this path.
 */
import { callExternalService, externalServices } from "./service-client.js";

/** Where the payment page sends the payer back when the caller names no page. */
export const DEFAULT_PREPAY_SUCCESS_URL = "https://distribute.you/?prepaid=paid";
export const DEFAULT_PREPAY_CANCEL_URL = "https://distribute.you/?prepaid=cancelled";

export const PREPAID_CHECKOUT_PATH = "/v1/billing/accounts/prepaid_checkout";
export const PREPAID_STATUS_PATH = "/v1/billing/accounts/prepaid_status";
export const RELOAD_RULES_PATH = "/v1/billing/accounts/reload_rules";

/** billing-service `GET /internal/accounts/by-org/{orgId}/reload-rules`, the fields read here. */
export interface ReloadRules {
  first_topup_minimum_cents: number;
  reload_amount_minimum_cents: number;
  default_reload_amount_cents: number;
}

export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function isReloadRules(value: unknown): value is ReloadRules {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return [
    "first_topup_minimum_cents",
    "reload_amount_minimum_cents",
    "default_reload_amount_cents",
  ].every((k) => typeof v[k] === "number");
}

/**
 * The org's reload rules, read from billing. Fail-soft: null (logged) when billing
 * cannot answer, so a 402 or a signup still answers; the instructions then point
 * at `rules_path` instead of quoting figures. Never a local fallback figure.
 */
export async function fetchReloadRules(orgId: string): Promise<ReloadRules | null> {
  try {
    const rules = await callExternalService<unknown>(
      externalServices.billing,
      `/internal/accounts/by-org/${encodeURIComponent(orgId)}/reload-rules`,
    );
    if (isReloadRules(rules)) return rules;
    console.error(`[agent-prepay] reload rules for org ${orgId} came back without the expected fields`);
    return null;
  } catch (error) {
    console.error(`[agent-prepay] reload rules unreadable for org ${orgId}:`, (error as Error).message);
    return null;
  }
}

/** The machine-readable "how to prepay" block, shared by the 402 answer and the signup answer. */
export function prepayInstructions(rules: ReloadRules | null) {
  return {
    method: "POST",
    path: PREPAID_CHECKOUT_PATH,
    rules_path: RELOAD_RULES_PATH,
    minimums_cents: rules
      ? {
          topup_amount_cents: rules.first_topup_minimum_cents,
          auto_topup_amount_cents: rules.reload_amount_minimum_cents,
        }
      : null,
    defaults_cents: rules
      ? {
          auto_topup_amount_cents: rules.default_reload_amount_cents,
        }
      : null,
    example_body: rules ? { topup_amount_cents: rules.first_topup_minimum_cents } : {},
    auto_topup:
      "The automatic top-up reloads the card when the balance runs out. Omit `auto_topup_amount_cents` to get the default " +
      "reload amount, or send a larger one. An amount under the minimum answers 400 with `code` and `minimum_cents`.",
    returns:
      "`url`: a hosted card payment page. A human may need to open it and pay; nothing is charged until someone pays it.",
    then: `Poll GET ${PREPAID_STATUS_PATH} until \`state\` is \`active\`, then retry the call.`,
    status_path: PREPAID_STATUS_PATH,
  };
}

/** One sentence naming the prepay route and the org's figures (or where to read them). */
export function prepayHowTo(rules: ReloadRules | null): string {
  const figures = rules
    ? `topup_amount_cents >= ${rules.first_topup_minimum_cents} (${usd(rules.first_topup_minimum_cents)}); the automatic top-up ` +
      `adds ${usd(rules.default_reload_amount_cents)} when the balance runs out, unless you send a larger auto_topup_amount_cents`
    : `minimums and defaults at GET ${RELOAD_RULES_PATH}`;
  return `Prepay with POST ${PREPAID_CHECKOUT_PATH} (${figures}).`;
}
