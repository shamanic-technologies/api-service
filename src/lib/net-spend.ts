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
 * No fallback to gross: a group without its net amount is a producer contract break,
 * and printing the pre-discount price under the spend label is exactly the bug fixed here.
 */

export interface RunsNetCostGroup {
  dimensions: Record<string, string | null>;
  netTotalCostInUsdCents?: string;
  netActualCostInUsdCents?: string;
  netProvisionedCostInUsdCents?: string;
}

function required(group: RunsNetCostGroup, field: keyof Omit<RunsNetCostGroup, "dimensions">): string {
  const value = group[field];
  if (typeof value !== "string") {
    throw new Error(
      `runs-service /v1/stats/costs group ${JSON.stringify(group.dimensions)} carries no ${field}: ` +
        "refusing to show the pre-discount spend as what the org pays",
    );
  }
  return value;
}

/** Total spend of one group, net of the org's usage discount. */
export function netSpendCents(group: RunsNetCostGroup): string {
  return required(group, "netTotalCostInUsdCents");
}

/** One cost line (total / actual / provisioned), every amount net of the usage discount. */
export function netCostLine(group: RunsNetCostGroup): {
  totalCostInUsdCents: string;
  actualCostInUsdCents: string;
  provisionedCostInUsdCents: string;
} {
  return {
    totalCostInUsdCents: required(group, "netTotalCostInUsdCents"),
    actualCostInUsdCents: required(group, "netActualCostInUsdCents"),
    provisionedCostInUsdCents: required(group, "netProvisionedCostInUsdCents"),
  };
}
