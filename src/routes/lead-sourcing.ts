import { Router } from "express";
import { authenticate, requireOrg, AuthenticatedRequest } from "../middleware/auth.js";
import { externalServices, pipeExternalService } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

/**
 * Transparent proxy of human-service's Lead Sourcing source choice: which lead
 * origins (Apollo Cold Filters, Apollo Buying Signals, LinkedIn Engagement
 * Signals, CRM contacts...) the generic "Lead Sourcing" channel uses for one
 * brand x offer. human-service owns the decision; the gateway forwards the
 * query verbatim (rule #11) and pipes status + body byte-identical (rules #7/#8),
 * no recomputation. Org scope = the authenticated `x-org-id` (buildInternalHeaders).
 */
const router = Router();

// Raw query string (from the first `?`), forwarded byte-identical (CLAUDE.md rule #11).
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

// GET /v1/orgs/lead-sourcing/sources?brandId&offerId → human-service GET /orgs/lead-sourcing/sources
router.get("/orgs/lead-sourcing/sources", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.human,
      `/orgs/lead-sourcing/sources${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req), expressRes: res },
    );
  } catch (error: any) {
    console.error("[api-service] Lead Sourcing sources error:", error?.message);
    respondUpstreamError(res, error, "Failed to read Lead Sourcing sources");
  }
});

export default router;
