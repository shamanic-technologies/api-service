/**
 * Prepay rules for organizations opened through the API (AI agents).
 *
 * Owner 2026-10-12: "By API the checkout amount (prepaid) can be set by them,
 * minimum $10. For the autotopup, minimum $15, when passing below $5 or more."
 * These minimums are the API's FRONT validation (owner: minimums are front
 * validation; billing-service binds the figures unclamped). Example: prepay
 * $10 → balance $10, auto top-up $15 whenever the balance would fall below $5.
 * No free credit, no trial, no subscription on this path.
 */

export const PREPAY_MINIMUMS_CENTS = {
  topup_amount_cents: 1000,
  auto_topup_amount_cents: 1500,
  auto_topup_threshold_cents: 500,
} as const;

export type PrepayAmountField = keyof typeof PREPAY_MINIMUMS_CENTS;

export const PREPAY_AMOUNT_FIELDS = Object.keys(PREPAY_MINIMUMS_CENTS) as PrepayAmountField[];

/** Where the payment page sends the payer back when the caller names no page. */
export const DEFAULT_PREPAY_SUCCESS_URL = "https://distribute.you/?prepaid=paid";
export const DEFAULT_PREPAY_CANCEL_URL = "https://distribute.you/?prepaid=cancelled";

export const PREPAID_CHECKOUT_PATH = "/v1/billing/accounts/prepaid_checkout";
export const PREPAID_STATUS_PATH = "/v1/billing/accounts/prepaid_status";

export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The machine-readable "how to prepay" block, shared by the 402 answer and the docs. */
export function prepayInstructions() {
  return {
    method: "POST",
    path: PREPAID_CHECKOUT_PATH,
    minimums_cents: { ...PREPAY_MINIMUMS_CENTS },
    example_body: { ...PREPAY_MINIMUMS_CENTS },
    returns:
      "`url`: a hosted card payment page. A human may need to open it and pay; nothing is charged until someone pays it.",
    then: `Poll GET ${PREPAID_STATUS_PATH} until \`state\` is \`active\`, then retry the call.`,
    status_path: PREPAID_STATUS_PATH,
  };
}

export type PrepayAmountRefusal = {
  error: "invalid_amount" | "amount_below_minimum";
  code: "invalid_amount" | "amount_below_minimum";
  field: PrepayAmountField;
  minimum_cents: number;
  message: string;
};

/** The first prepay amount that is missing, not a whole number of cents, or under its minimum. */
export function checkPrepayAmounts(body: unknown): PrepayAmountRefusal | null {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  for (const field of PREPAY_AMOUNT_FIELDS) {
    const minimum = PREPAY_MINIMUMS_CENTS[field];
    const value = record[field];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return {
        error: "invalid_amount",
        code: "invalid_amount",
        field,
        minimum_cents: minimum,
        message: `${field} is required, as a whole number of cents, at least ${minimum} (${usd(minimum)}).`,
      };
    }
    if (value < minimum) {
      return {
        error: "amount_below_minimum",
        code: "amount_below_minimum",
        field,
        minimum_cents: minimum,
        message: `${field} must be at least ${minimum} (${usd(minimum)}); got ${value} (${usd(value)}).`,
      };
    }
  }
  return null;
}
