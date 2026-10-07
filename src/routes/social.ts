import { Router } from "express";
import { authenticatePlatform, requireStaff, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Staff-only social-service reads (the posting service). social-service has no org tier:
// every read is a platform read billed to no org, so the gate is authenticatePlatform +
// requireStaff (like the Monitoring reads) and no org identity is forwarded.
const router = Router();

/** Raw query string (with its `?`) off the original URL, forwarded verbatim (#11). */
function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
}

/**
 * GET /v1/social/brands/:brandId/linkedin-posts → social-service
 * GET /internal/brands/:brandId/linkedin-posts — STAFF ONLY.
 *
 * A brand's own LinkedIn company page posts (dashboard v2 "Posting > Posts"). Fetching
 * spends platform money (treg), hence staff-only. Query (`limit`, `cursor` today)
 * forwarded verbatim, status + body piped byte-for-byte, errors field-for-field.
 */
router.get("/v1/social/brands/:brandId/linkedin-posts", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.social,
      `/internal/brands/${encodeURIComponent(req.params.brandId)}/linkedin-posts${rawQueryString(req.originalUrl)}`,
      { expressRes: res },
    );
  } catch (error: any) {
    console.error("[api-service] Social brand LinkedIn posts proxy error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read the brand's LinkedIn posts");
  }
});

export default router;
