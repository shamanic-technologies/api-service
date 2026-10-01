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
 * GET /v1/costs/provider-payment-sources → costs-service GET /internal/provider-payment-sources — STAFF ONLY.
 *
 * Every catalogue provider with the accounts that pay it, which costs-service reads
 * live from the bank ledger (a ledger failure comes back as its 502, verbatim).
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
 * GET /v1/costs/email-send-price → costs-service GET /internal/email-send-price — STAFF ONLY.
 *
 * The price of one cold email sent to a lead, as a series costs-service computes
 * from the bank ledger. Before its first refresh costs-service answers 503
 * `{ error, lastRefresh }`; that status and body come back verbatim like the 200.
 * The upstream `POST /internal/email-send-price/refresh` is deliberately not proxied.
 */
router.get("/v1/costs/email-send-price", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.costs,
      `/internal/email-send-price${rawQueryString(req.originalUrl)}`,
      { expressRes: res },
    );
  } catch (error: any) {
    console.error("[api-service] Email send price proxy error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read the email send price");
  }
});

/**
 * GET /v1/costs/subscription-costs → costs-service GET /internal/subscription-costs — STAFF ONLY.
 *
 * The real cost per credit of each vendor subscription, as a series costs-service
 * computes. Before its first refresh costs-service answers 503 `{ error, lastRefresh }`;
 * that status and body come back verbatim like the 200.
 * The upstream `POST /internal/subscription-costs/refresh` is deliberately not proxied.
 */
router.get("/v1/costs/subscription-costs", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.costs,
      `/internal/subscription-costs${rawQueryString(req.originalUrl)}`,
      { expressRes: res },
    );
  } catch (error: any) {
    console.error("[api-service] Subscription costs proxy error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read subscription costs");
  }
});

/**
 * Real-cost / proposed-price / price-comparison reads — STAFF ONLY, byte passthrough:
 *   GET /v1/costs/real-costs            → costs-service GET /internal/real-costs
 *   GET /v1/costs/real-costs/:costName  → costs-service GET /internal/real-costs/:costName
 *   GET /v1/costs/price-lists           → costs-service GET /internal/price-lists
 *   GET /v1/costs/price-comparison      → costs-service GET /internal/price-comparison
 * Query string forwarded verbatim (#11); 200/400/404 and the pre-refresh 503
 * `{ error, lastRefresh }` come back with their bodies untouched.
 * The upstream `POST /internal/real-costs/refresh` is deliberately not proxied.
 */
function proxyCostsRead(downstream: (req: AuthenticatedRequest) => string, label: string) {
  return async (req: AuthenticatedRequest, res: any) => {
    try {
      await pipeExternalService(
        externalServices.costs,
        `${downstream(req)}${rawQueryString(req.originalUrl)}`,
        { expressRes: res },
      );
    } catch (error: any) {
      console.error(`[api-service] ${label} proxy error:`, error.message);
      if (res.headersSent) { res.end(); return; }
      respondUpstreamError(res, error, `Failed to read ${label}`);
    }
  };
}

router.get("/v1/costs/real-costs", authenticatePlatform, requireStaff,
  proxyCostsRead(() => "/internal/real-costs", "real costs"));

router.get("/v1/costs/real-costs/:costName", authenticatePlatform, requireStaff,
  proxyCostsRead((req) => `/internal/real-costs/${encodeURIComponent(req.params.costName)}`, "the real cost"));

router.get("/v1/costs/price-lists", authenticatePlatform, requireStaff,
  proxyCostsRead(() => "/internal/price-lists", "price lists"));

router.get("/v1/costs/price-comparison", authenticatePlatform, requireStaff,
  proxyCostsRead(() => "/internal/price-comparison", "the price comparison"));

export default router;
