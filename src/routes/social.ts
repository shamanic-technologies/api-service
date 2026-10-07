import { Router } from "express";
import { authenticatePlatform, requireStaff, authenticateUser, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Staff-only social-service reads (the posting service). social-service has no org tier:
// every read is a platform read billed to no org, so the gate is authenticatePlatform +
// requireStaff (like the Monitoring reads). The brand read forwards no identity; the
// "my own posts" read adds authenticateUser to know WHO is asking.
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

/**
 * GET /v1/social/me/linkedin-posts → social-service
 * GET /internal/users/{userId}/linkedin-posts — STAFF ONLY.
 *
 * The signed-in user's OWN LinkedIn profile posts (dashboard v2 Profile page), same
 * contract as the brand read. The user is the one the gateway authenticated
 * (`authenticateUser` → `req.userId`, the internal id): the browser never names it, so the
 * path carries no user id. Staff gate first (no network before the 403), then the
 * identity resolution. Identity headers forwarded as everywhere (`buildInternalHeaders`);
 * query forwarded verbatim; status + body piped byte-for-byte.
 */
router.get("/v1/social/me/linkedin-posts", authenticatePlatform, requireStaff, authenticateUser, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.social,
      `/internal/users/${encodeURIComponent(req.userId!)}/linkedin-posts${rawQueryString(req.originalUrl)}`,
      { expressRes: res, headers: buildInternalHeaders(req) },
    );
  } catch (error: any) {
    console.error("[api-service] Social user LinkedIn posts proxy error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read your LinkedIn posts");
  }
});

export default router;
