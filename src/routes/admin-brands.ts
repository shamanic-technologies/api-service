import { Router } from "express";
import { authenticatePlatform, requireStaff, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, pipeExternalService, externalServices } from "../lib/service-client.js";
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

export default router;
