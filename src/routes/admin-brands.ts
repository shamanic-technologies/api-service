import { Router } from "express";
import {
  authenticate,
  authenticatePlatform,
  requireOrg,
  requireStaff,
  requireUser,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { callExternalService, pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

// GET /v1/admin/brands — staff-only cross-org brands list for the admin CRM.
//
// Transparent proxy to brand-service GET /internal/brands/all (a cross-org read,
// so NO org context). This is fleet-wide ops data the customer dashboard must not
// reach, so it is gated with authenticatePlatform + requireStaff (CLAUDE.md staff
// section): the shared platform key alone is not a staff signal, the x-email in the
// STAFF_EMAILS allowlist is. Response forwarded byte-for-byte (rule #8), upstream
// errors propagated verbatim (rule #7).
router.get("/admin/brands", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.brand,
      "/internal/brands/all",
      { headers: req.staffEmail ? { "x-email": req.staffEmail } : {} }
    );
    res.json(result);
  } catch (error: any) {
    respondUpstreamError(res, error, "Failed to list brands");
  }
});

// Raw query string (from the first `?`), forwarded byte-identical (CLAUDE.md rule #11).
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

// GET /v1/admin/brands/:brandId/audience-snapshot[/people|/companies] — staff-only
// view of what we already HOLD in a brand's audiences: per list, people and
// companies stored and accepted by the target audience, then the paginated people
// and companies with the lists that surfaced them.
//
// Byte passthrough to human-service GET /internal/brands/{brandId}/audience-snapshot*.
// Cross-org, cross-audience data, so the same tier as /v1/admin/brands:
// authenticatePlatform + requireStaff, no requireOrg (the brand is the path param,
// the optional orgId is a query param human-service reads). The query string
// (orgId, limit, offset, acceptedOnly) is forwarded verbatim off originalUrl;
// human-service owns the caps and its 400s (rules #7/#11, no-limit-defaults).
const AUDIENCE_SNAPSHOT_READS = [
  { suffix: "", label: "brand audience snapshot" },
  { suffix: "/people", label: "brand held people" },
  { suffix: "/companies", label: "brand held companies" },
] as const;

for (const { suffix, label } of AUDIENCE_SNAPSHOT_READS) {
  router.get(
    `/admin/brands/:brandId/audience-snapshot${suffix}`,
    authenticatePlatform,
    requireStaff,
    async (req: AuthenticatedRequest, res) => {
      try {
        await pipeExternalService(
          externalServices.human,
          `/internal/brands/${encodeURIComponent(req.params.brandId as string)}/audience-snapshot${suffix}${rawQueryString(req.originalUrl)}`,
          { expressRes: res }
        );
      } catch (error: any) {
        respondUpstreamError(res, error, `Failed to read ${label}`);
      }
    }
  );
}

// GET /v1/admin/brands/:brandId/sourcing-investment[/people|/companies] — staff-only
// view of what we INVESTED to source a brand's audiences: $ per audience, per person,
// per company, billed AND vendor basis. The vendor basis reveals our margin.
//
// Byte passthrough to features-service GET /brands/{brandId}/sourcing-investment*.
// That read is org-scoped (x-org-id), so unlike audience-snapshot it needs the org
// being viewed: the gate is authenticatePlatform + requireStaff FIRST (network-free,
// so a non-staff caller reaches no service at all), then authenticate + requireOrg +
// requireUser resolve the viewed org's identity headers (same chain as
// /v1/features/:slug/revenue/actual-cost). Query string (limit, offset,
// apolloPersonIds, domains) forwarded verbatim; features-service owns caps and 400s.
const SOURCING_INVESTMENT_READS = [
  { suffix: "", label: "brand sourcing investment" },
  { suffix: "/people", label: "brand sourcing investment per person" },
  { suffix: "/companies", label: "brand sourcing investment per company" },
] as const;

for (const { suffix, label } of SOURCING_INVESTMENT_READS) {
  router.get(
    `/admin/brands/:brandId/sourcing-investment${suffix}`,
    authenticatePlatform,
    requireStaff,
    authenticate,
    requireOrg,
    requireUser,
    async (req: AuthenticatedRequest, res) => {
      try {
        await pipeExternalService(
          externalServices.features,
          `/brands/${encodeURIComponent(req.params.brandId as string)}/sourcing-investment${suffix}${rawQueryString(req.originalUrl)}`,
          { headers: buildInternalHeaders(req), expressRes: res }
        );
      } catch (error: any) {
        if (res.headersSent) { res.end(); return; }
        respondUpstreamError(res, error, `Failed to read ${label}`);
      }
    }
  );
}

export default router;
