import type { AuthenticatedRequest } from "../middleware/auth.js";
import { isStaffEmail } from "./staff.js";

/**
 * The customer view of a content-generation-service generation row.
 *
 * SECURITY (owner 2026-10-12, hotfix): a generation row carries our internals — the full
 * LLM prompt (`promptRaw`), the raw model output (`responseRaw`), the raw template
 * variables (`variablesRaw`), token counts, model id, prompt type, workflow slugs, run ids —
 * and the gateway used to forward it verbatim to every caller, API-key and MCP callers
 * included. This is the one owner-approved exception to "no field stripping" (CLAUDE.md
 * rule #4) for generation reads: a customer receives ONLY the fields below.
 *
 * It is an ALLOWLIST on purpose: a field content-generation-service adds later stays
 * staff-only until someone decides here that a customer may read it.
 */
export const CUSTOMER_EMAIL_FIELDS = [
  "id",
  "leadId",
  "campaignId",
  "brandIds",
  "createdAt",
  "subject",
  "bodyHtml",
  "bodyText",
  "bodySource",
  "sequence",
  "leadFirstName",
  "leadLastName",
  "leadCompany",
  "leadTitle",
  "leadIndustry",
  "leadOrganizationDomain",
  "clientCompanyName",
] as const;

/** Fields of ONE step of `sequence` a customer may read. */
export const CUSTOMER_SEQUENCE_STEP_FIELDS = [
  "step",
  "subject",
  "bodyHtml",
  "bodyText",
  "daysSinceLastStep",
] as const;

function pick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) out[field] = source[field];
  }
  return out;
}

function toCustomerSequence(sequence: unknown): unknown {
  if (!Array.isArray(sequence)) return null;
  return sequence.map((step) =>
    step && typeof step === "object" ? pick(step as Record<string, unknown>, CUSTOMER_SEQUENCE_STEP_FIELDS) : null,
  );
}

/** Project one generation row onto the customer allowlist. */
export function toCustomerEmail(row: Record<string, unknown>): Record<string, unknown> {
  const out = pick(row, CUSTOMER_EMAIL_FIELDS);
  if ("sequence" in out) out.sequence = toCustomerSequence(out.sequence);
  return out;
}

/**
 * Staff keep the full generation row (prompt, raw output, run costs) for the staff console.
 * Same signal as `requireStaff`: the platform key (authType "admin") AND a forwarded staff
 * `x-email`. A staff member's own Bearer key gets the customer view, like any key.
 */
export function isStaffCaller(req: AuthenticatedRequest): boolean {
  if (req.authType !== "admin") return false;
  return isStaffEmail(req.headers["x-email"] as string | undefined);
}
