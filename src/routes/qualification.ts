import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalServiceWithStatus, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * QUALIFICATION — lead-service's checks on whether a person fits an offer, proxied.
 *
 *   GET    /v1/qualification/catalog                                        → GET    /orgs/qualification/catalog
 *   POST   /v1/brands/:id/offers/:offerId/qualification/suggestions          → POST   /orgs/brands/:id/offers/:offerId/qualification/suggestions
 *   POST   /v1/brands/:id/offers/:offerId/qualification/criteria             → POST   /orgs/brands/:id/offers/:offerId/qualification/criteria
 *   GET    /v1/brands/:id/offers/:offerId/qualification/criteria             → GET    /orgs/brands/:id/offers/:offerId/qualification/criteria
 *   PATCH  /v1/brands/:id/offers/:offerId/qualification/criteria/:criterionId → PATCH  …/criteria/:criterionId
 *   DELETE /v1/brands/:id/offers/:offerId/qualification/criteria/:criterionId → DELETE …/criteria/:criterionId
 *   POST   /v1/brands/:id/offers/:offerId/qualification/criteria/:criterionId/sample → POST …/criteria/:criterionId/sample
 *   GET    /v1/leads/:id/qualification                                       → GET    /orgs/leads/:id/qualification
 *
 * Criteria belong to an OFFER, so their routes sit beside the other offer routes
 * (`/v1/brands/:id/offers/:offerId/...`, src/routes/brand.ts) with lead-service's `/orgs`
 * tier prefix dropped, exactly as `/v1/leads/:id/...` does for one lead.
 *
 * Pure passthroughs: bodies and query strings go over verbatim (rules #8, #11), the
 * upstream status comes back as sent (lead-service answers 201 on create, 402
 * `insufficient_credit` on a spend the org cannot afford, 404 `criterion_not_found`), and
 * refusals reach the caller field for field through respondUpstreamError (rule #7).
 *
 * Identity: `buildInternalHeaders(req)` carries org, user AND run. Suggestions and sample
 * SPEND (lead-service opens a child run under `x-run-id` and refuses 400 without
 * `x-user-id` + `x-run-id`), hence `requireUser` on every route. The brand named in the
 * path also rides as `x-brand-id`, so it cannot disagree with a caller-sent one: a
 * conflicting header is a 400 here rather than a request about two brands.
 */
const router = Router();

function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

/** Identity headers, with the path's brand promoted to `x-brand-id`. Null after a 400. */
function offerHeaders(req: AuthenticatedRequest, res: any): Record<string, string> | null {
  const headers = buildInternalHeaders(req);
  const brandId = req.params.id;
  if (headers["x-brand-id"] && headers["x-brand-id"] !== brandId) {
    res.status(400).json({
      error: `Conflict: x-brand-id (${headers["x-brand-id"]}) does not match the brand in the path (${brandId})`,
    });
    return null;
  }
  headers["x-brand-id"] = brandId;
  return headers;
}

function offerPath(req: AuthenticatedRequest, suffix: string): string {
  return (
    `/orgs/brands/${encodeURIComponent(req.params.id)}/offers/${encodeURIComponent(req.params.offerId)}` +
    `/qualification${suffix}${rawQueryString(req.originalUrl)}`
  );
}

function criterionSuffix(req: AuthenticatedRequest, tail = ""): string {
  return `/criteria/${encodeURIComponent(req.params.criterionId)}${tail}`;
}

router.get("/qualification/catalog", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.lead,
      `/orgs/qualification/catalog${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] Get qualification catalog error:", error.message);
    respondUpstreamError(res, error, "Failed to get qualification catalog");
  }
});

/**
 * The offer routes differ only by method, suffix and the sentence logged on refusal, so
 * they are declared from one table (same shape as OFFER_ROUTES in src/routes/brand.ts).
 */
const OFFER_QUALIFICATION_ROUTES = [
  { method: "post", path: "/qualification/suggestions", suffix: () => "/suggestions", what: "suggest qualification criteria" },
  { method: "post", path: "/qualification/criteria", suffix: () => "/criteria", what: "create qualification criterion" },
  { method: "get", path: "/qualification/criteria", suffix: () => "/criteria", what: "list qualification criteria" },
  { method: "patch", path: "/qualification/criteria/:criterionId", suffix: (r: AuthenticatedRequest) => criterionSuffix(r), what: "update qualification criterion" },
  { method: "delete", path: "/qualification/criteria/:criterionId", suffix: (r: AuthenticatedRequest) => criterionSuffix(r), what: "archive qualification criterion" },
  { method: "post", path: "/qualification/criteria/:criterionId/sample", suffix: (r: AuthenticatedRequest) => criterionSuffix(r, "/sample"), what: "run qualification criterion on a sample" },
] as const;

for (const route of OFFER_QUALIFICATION_ROUTES) {
  router[route.method](
    `/brands/:id/offers/:offerId${route.path}`,
    authenticate,
    requireOrg,
    requireUser,
    async (req: AuthenticatedRequest, res) => {
      try {
        const headers = offerHeaders(req, res);
        if (!headers) return;
        const { status, data } = await callExternalServiceWithStatus(
          externalServices.lead,
          offerPath(req, route.suffix(req)),
          {
            method: route.method.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE",
            headers,
            ...(route.method === "post" || route.method === "patch" ? { body: req.body } : {}),
          },
        );
        res.status(status).json(data);
      } catch (error: any) {
        console.error(`[api-service] Failed to ${route.what}:`, error.message);
        respondUpstreamError(res, error, `Failed to ${route.what}`);
      }
    },
  );
}

/**
 * What the checks say about one lead: per criterion, the verdict, the evidence in plain
 * words and the screenshot. `brandId` (required) and `offerId` (optional) are lead-service's
 * query parameters, forwarded verbatim; `buildInternalHeaders` also promotes `brandId` to
 * `x-brand-id`. One lead, so no pipe (rule #10).
 */
router.get("/leads/:id/qualification", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.lead,
      `/orgs/leads/${encodeURIComponent(req.params.id)}/qualification${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] Get lead qualification error:", error.message);
    respondUpstreamError(res, error, "Failed to get lead qualification");
  }
});

export default router;
