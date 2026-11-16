/**
 * Campaign spend shown to a client is what the org PAYS (STATS-NET-1116, owner rule:
 * every money reader reads net; a usage discount applies to charges).
 *
 * runs-service `GET /v1/stats/costs` serves, per group, the gross amounts
 * (`totalCostInUsdCents`, `actualCostInUsdCents`, `provisionedCostInUsdCents`) AND the
 * frozen net ones (`netTotalCostInUsdCents`, ...: gross reduced by the usage discount
 * frozen on each cost row at write; equal to gross for an org with no discount). The
 * campaign stats routes publish the net amounts under the field names their consumers
 * already read, so a discounted org reads one figure everywhere (the dashboard's
 * "Invested" reads features-service at pricing=net, the same ledger rows).
 *
 * The price BEFORE the discount is served beside it, under its own name
 * (`...BeforeDiscount...`), so an agent can explain the discount (owner 2026-11-16: « que les
 * stats rendent les deux chiffres »). An org with no discount reads both equal.
 *
 * No fallback to gross: a group without its net amount is a producer contract break,
 * and printing the pre-discount price under the spend label is exactly the bug fixed here.
 */

export interface RunsNetCostGroup {
  dimensions: Record<string, string | null>;
  totalCostInUsdCents?: string;
  actualCostInUsdCents?: string;
  provisionedCostInUsdCents?: string;
  netTotalCostInUsdCents?: string;
  netActualCostInUsdCents?: string;
  netProvisionedCostInUsdCents?: string;
}

function required(group: RunsNetCostGroup, field: keyof Omit<RunsNetCostGroup, "dimensions">): string {
  const value = group[field];
  if (typeof value !== "string") {
    throw new Error(
      `runs-service /v1/stats/costs group ${JSON.stringify(group.dimensions)} carries no ${field}: ` +
        "refusing to serve a spend figure under the wrong basis",
    );
  }
  return value;
}

/** Total spend of one group: what the org pays (net) and the price before its discount. */
export function spendCents(group: RunsNetCostGroup): { paid: string; beforeDiscount: string } {
  return {
    paid: required(group, "netTotalCostInUsdCents"),
    beforeDiscount: required(group, "totalCostInUsdCents"),
  };
}

/**
 * One cost line: total / actual / provisioned are what the org pays (net of the usage
 * discount); the `...BeforeDiscount...` twins carry the price before the discount.
 */
export function costLine(group: RunsNetCostGroup): {
  totalCostInUsdCents: string;
  actualCostInUsdCents: string;
  provisionedCostInUsdCents: string;
  totalCostBeforeDiscountInUsdCents: string;
  actualCostBeforeDiscountInUsdCents: string;
  provisionedCostBeforeDiscountInUsdCents: string;
} {
  return {
    totalCostInUsdCents: required(group, "netTotalCostInUsdCents"),
    actualCostInUsdCents: required(group, "netActualCostInUsdCents"),
    provisionedCostInUsdCents: required(group, "netProvisionedCostInUsdCents"),
    totalCostBeforeDiscountInUsdCents: required(group, "totalCostInUsdCents"),
    actualCostBeforeDiscountInUsdCents: required(group, "actualCostInUsdCents"),
    provisionedCostBeforeDiscountInUsdCents: required(group, "provisionedCostInUsdCents"),
  };
}
