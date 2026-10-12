import { Router, type Response } from "express";
import {
  authenticate,
  authenticateUser,
  requireOrg,
  requireStaffActor,
  requireUser,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * Organizations and their member invitations → client-service.
 *
 * - `POST /v1/orgs` → `POST /internal/orgs`: create an organization for a new
 *   client (staff only: `requireStaffActor`, a staff member's own key or the
 *   staff console; listed in `STAFF_KEY_OPERATIONS`). Owner rule 2026-10-12
 *   (`mcp-first`): staff open a client's account through the MCP like a client
 *   would. No org target: the caller is creating one.
 * - `POST|GET /v1/orgs/:orgId/member-invitations`, `DELETE
 *   .../:invitationId` → the same paths under `/internal`: any member of the org
 *   (clients too) invites a person by email and gets the link back, lists the
 *   pending invitations, revokes one. `:orgId` is the request's target, resolved
 *   and membership-checked by `authenticate`; the downstream path carries the
 *   AUTHENTICATED org.
 *
 * The acting user is identity, so the gateway supplies it from `authenticate`
 * (`createdByUserId` / `invitedByUserId`, client-service's body names for the
 * gateway's `x-user-id`), spread-then-override like `/orgs/:orgId/invites/claim`:
 * a caller-supplied value is discarded, every other body field passes through.
 * Responses are piped byte-identical with their status (201 created, 200
 * idempotent replay, 4xx refusals with `error` + `message`).
 */
const router = Router();

function pathOrgMismatch(req: AuthenticatedRequest, res: Response): boolean {
  if (req.params.orgId === req.orgId) return false;
  res.status(403).json({
    error: "org_mismatch",
    message: "The organization in the path is not the one this request is authenticated for.",
  });
  return true;
}

router.post("/orgs", authenticateUser, requireUser, requireStaffActor, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(externalServices.client, "/internal/orgs", {
      expressRes: res,
      method: "POST",
      body: { ...req.body, createdByUserId: req.userId },
      headers: buildInternalHeaders(req),
    });
  } catch (error) {
    respondUpstreamError(res, error, "Failed to create the organization");
  }
});

router.post(
  "/orgs/:orgId/member-invitations",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    if (pathOrgMismatch(req, res)) return;
    try {
      await pipeExternalService(
        externalServices.client,
        `/internal/orgs/${encodeURIComponent(req.orgId!)}/member-invitations`,
        {
          expressRes: res,
          method: "POST",
          body: { ...req.body, invitedByUserId: req.userId },
          headers: buildInternalHeaders(req),
        },
      );
    } catch (error) {
      respondUpstreamError(res, error, "Failed to invite the person");
    }
  },
);

router.get(
  "/orgs/:orgId/member-invitations",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    if (pathOrgMismatch(req, res)) return;
    try {
      await pipeExternalService(
        externalServices.client,
        `/internal/orgs/${encodeURIComponent(req.orgId!)}/member-invitations`,
        { expressRes: res, headers: buildInternalHeaders(req) },
      );
    } catch (error) {
      respondUpstreamError(res, error, "Failed to list the invitations");
    }
  },
);

router.delete(
  "/orgs/:orgId/member-invitations/:invitationId",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    if (pathOrgMismatch(req, res)) return;
    try {
      await pipeExternalService(
        externalServices.client,
        `/internal/orgs/${encodeURIComponent(req.orgId!)}/member-invitations/${encodeURIComponent(req.params.invitationId)}`,
        { expressRes: res, method: "DELETE", headers: buildInternalHeaders(req) },
      );
    } catch (error) {
      respondUpstreamError(res, error, "Failed to revoke the invitation");
    }
  },
);

export default router;
