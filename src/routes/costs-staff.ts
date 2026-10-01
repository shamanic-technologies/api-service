import { Router } from "express";
import { authenticatePlatform, requireStaff, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Staff-only costs-service reads. Kept out of routes/costs.ts, which is the
// public (no-auth) costs surface and is asserted to stay that way.
const router = Router();

/**
 * GET /v1/costs/vendor-costs → costs-service GET /internal/vendor-costs — STAFF ONLY.
 *
 * Every price version per cost name (all plans, all dates) with its vendor unit
 * cost next to the billed price: the margin, so `authenticatePlatform` +
 * `requireStaff`. Query string (`names` today) forwarded verbatim (#11), status +
 * body piped byte-for-byte (#10), errors field-for-field (#7).
 */
router.get("/v1/costs/vendor-costs", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    const i = req.originalUrl.indexOf("?");
    await pipeExternalService(
      externalServices.costs,
      `/internal/vendor-costs${i === -1 ? "" : req.originalUrl.slice(i)}`,
      { expressRes: res },
    );
  } catch (error: any) {
    console.error("[api-service] Vendor costs proxy error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read vendor costs");
  }
});

export default router;
