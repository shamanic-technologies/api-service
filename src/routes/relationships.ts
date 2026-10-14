import { Router, Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalServiceWithStatus, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * Who each person is to a brand (RELATIONSHIP-TAGS-1014): the review page of the
 * dashboard brand settings and the distribute MCP read and fix relationships,
 * merges and companies here. Pass-through to lead-service
 * `/orgs/brands/{brandId}/relationships/...`, same suffix:
 *
 *   GET    /v1/brands/:brandId/relationships/review
 *   POST   /v1/brands/:brandId/relationships/merge-questions/:questionId/answer   {same: boolean}
 *   POST   /v1/brands/:brandId/relationships/merges/:linkId/undo
 *   PUT    /v1/brands/:brandId/relationships/:humanId/tags/:tag                    {state: "yes" | "no"}
 *   DELETE /v1/brands/:brandId/relationships/:humanId/tags/:tag                    (withdraw the person's word)
 *   PUT    /v1/brands/:brandId/relationships/:humanId/company                      {domain} | {name} | {none: true}
 *
 * `authenticate + requireOrg + requireUser`: lead-service scopes every read on the
 * AUTHENTICATED `x-org-id` and records the `x-user-id` behind a person's word, both
 * from `buildInternalHeaders(req)`, never from the caller. The `:brandId` in the path
 * also selects the org for a user key (`src/lib/org-scope.ts`). Body, query string,
 * status and body back are forwarded verbatim (rules #4, #7, #8, #11); lead-service
 * owns the vocabulary (tags, states) and every refusal.
 *
 * The literal `merge-questions` / `merges` segments sit two levels deep while
 * `:humanId` routes sit three levels deep, so no `:humanId` route can swallow them.
 */
const router = Router();

/** The inbound query string, verbatim, with its `?` (rule #11). */
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

const enc = encodeURIComponent;

async function forward(
  req: AuthenticatedRequest,
  res: Response,
  method: "GET" | "POST" | "PUT" | "DELETE",
  suffix: string,
  fallback: string,
) {
  try {
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.lead,
      `/orgs/brands/${enc(req.params.brandId)}/relationships/${suffix}${rawQueryString(req.originalUrl)}`,
      {
        method,
        headers: buildInternalHeaders(req),
        ...(method === "POST" || method === "PUT" ? { body: req.body } : {}),
      },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error(`[api-service] ${fallback}:`, error.message);
    respondUpstreamError(res, error, fallback);
  }
}

router.get(
  "/brands/:brandId/relationships/review",
  authenticate,
  requireOrg,
  requireUser,
  (req: AuthenticatedRequest, res) => forward(req, res, "GET", "review", "Failed to read relationship review"),
);

router.post(
  "/brands/:brandId/relationships/merge-questions/:questionId/answer",
  authenticate,
  requireOrg,
  requireUser,
  (req: AuthenticatedRequest, res) =>
    forward(req, res, "POST", `merge-questions/${enc(req.params.questionId)}/answer`, "Failed to answer merge question"),
);

router.post(
  "/brands/:brandId/relationships/merges/:linkId/undo",
  authenticate,
  requireOrg,
  requireUser,
  (req: AuthenticatedRequest, res) =>
    forward(req, res, "POST", `merges/${enc(req.params.linkId)}/undo`, "Failed to undo merge"),
);

router.put(
  "/brands/:brandId/relationships/:humanId/tags/:tag",
  authenticate,
  requireOrg,
  requireUser,
  (req: AuthenticatedRequest, res) =>
    forward(req, res, "PUT", `${enc(req.params.humanId)}/tags/${enc(req.params.tag)}`, "Failed to state relationship tag"),
);

router.delete(
  "/brands/:brandId/relationships/:humanId/tags/:tag",
  authenticate,
  requireOrg,
  requireUser,
  (req: AuthenticatedRequest, res) =>
    forward(req, res, "DELETE", `${enc(req.params.humanId)}/tags/${enc(req.params.tag)}`, "Failed to withdraw relationship tag"),
);

router.put(
  "/brands/:brandId/relationships/:humanId/company",
  authenticate,
  requireOrg,
  requireUser,
  (req: AuthenticatedRequest, res) =>
    forward(req, res, "PUT", `${enc(req.params.humanId)}/company`, "Failed to set company"),
);

export default router;
