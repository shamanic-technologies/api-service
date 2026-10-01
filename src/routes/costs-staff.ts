import { Router } from "express";
import { authenticatePlatform, requireStaff, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Staff-only costs-service reads. Kept out of routes/costs.ts, which is the
// public (no-auth) costs surface and is asserted to stay that way.
const router = Router();

/** Raw query string (with its `?`) off the original URL, forwarded verbatim (#11). */
function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
}

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

/**
 * GET /v1/costs/payment-sources → costs-service GET /internal/payment-sources — STAFF ONLY.
 *
 * The vocabulary of our own payment accounts (bank, card processor) a vendor can
 * be paid from. Reveals our accounts, so `authenticatePlatform` + `requireStaff`.
 * Growing the vocabulary (PUT /internal/payment-sources/:key) is deliberately not
 * proxied: it stays a backend operation.
 */
router.get("/v1/costs/payment-sources", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(externalServices.costs, `/internal/payment-sources${rawQueryString(req.originalUrl)}`, {
      expressRes: res,
    });
  } catch (error: any) {
    console.error("[api-service] Payment sources proxy error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read payment sources");
  }
});

/**
 * GET /v1/costs/provider-payment-sources → costs-service GET /internal/provider-payment-sources — STAFF ONLY.
 *
 * Every catalogue provider with the payment sources that pay it.
 */
router.get("/v1/costs/provider-payment-sources", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.costs,
      `/internal/provider-payment-sources${rawQueryString(req.originalUrl)}`,
      { expressRes: res },
    );
  } catch (error: any) {
    console.error("[api-service] Provider payment sources proxy error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read provider payment sources");
  }
});

/**
 * PUT /v1/costs/provider-payment-sources/:provider → costs-service PUT /internal/provider-payment-sources/:provider — STAFF ONLY.
 *
 * Replaces one provider's set of payment sources (`{ sources: [...] }`, `[]`
 * clears). Body forwarded as-is (#4); an unknown source key (400) or provider
 * (404) comes back with the producer's status and body (#7).
 */
router.put(
  "/v1/costs/provider-payment-sources/:provider",
  authenticatePlatform,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(
        externalServices.costs,
        `/internal/provider-payment-sources/${encodeURIComponent(req.params.provider)}`,
        { method: "PUT", body: req.body, expressRes: res },
      );
    } catch (error: any) {
      console.error("[api-service] Set provider payment sources proxy error:", error.message);
      if (res.headersSent) { res.end(); return; }
      respondUpstreamError(res, error, "Failed to set provider payment sources");
    }
  },
);

export default router;
