import { Router } from "express";
import {
  authenticate,
  requireOrg,
  requireUser,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

// POST /v1/invites/validate — public lookup of an invite code (Wave 0.5)
router.post("/invites/validate", async (req, res) => {
  try {
    const result = await callExternalService(
      externalServices.client,
      "/public/invites/validate",
      { method: "POST", body: req.body },
    );
    res.json(result);
  } catch (error: any) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Failed to validate invite" });
  }
});

// GET /v1/orgs/:orgId/invites/status — authed quota lookup for the org
router.get(
  "/orgs/:orgId/invites/status",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (req.params.orgId !== req.orgId) {
        return res.status(403).json({
          error: "orgId path parameter does not match authenticated org",
        });
      }
      const result = await callExternalService(
        externalServices.client,
        `/internal/orgs/${encodeURIComponent(req.params.orgId)}/invites/status`,
        { headers: buildInternalHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || "Failed to fetch invite status" });
    }
  },
);

// POST /v1/orgs/:orgId/invites/claim — authed claim. Downstream client-service
// orchestrates: record claim row → grant credits to inviter + invitee via
// billing-service → send the invite confirmation emails via
// transactional-email-service. api-service stays a transparent proxy.
//
// The downstream route is POST /internal/invites/claim — NOT org-scoped in the
// path. It identifies the claiming org from the request BODY (`inviteeOrgId`),
// so the gateway supplies that field from the identity `authenticate` resolved
// (`req.orgId`, an internal UUID). This is the one place the gateway writes a
// body field rather than forwarding it: letting the browser name the claiming
// org would let any signed-in caller claim on behalf of another org. The
// spread-then-override order is deliberate — a client-supplied `inviteeOrgId`
// is discarded, and any future downstream body field still passes through.
// The {orgId} path segment is kept (published contract + the self-claim check
// below); it is validated against the authenticated org and never forwarded.
router.post(
  "/orgs/:orgId/invites/claim",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      if (req.params.orgId !== req.orgId) {
        return res.status(403).json({
          error: "orgId path parameter does not match authenticated org",
        });
      }
      const result = await callExternalService(
        externalServices.client,
        "/internal/invites/claim",
        {
          method: "POST",
          body: { ...req.body, inviteeOrgId: req.orgId },
          headers: buildInternalHeaders(req),
        },
      );
      res.json(result);
    } catch (error) {
      // Forward the upstream body field-for-field (CLAUDE.md #7 corollary): the
      // cap rejection is `{ error, used, total }` and the dashboard branches on
      // `used`/`total`. Flattening it into `{ error: <stringified body> }` would
      // destroy those fields.
      respondUpstreamError(res, error, "Failed to claim invite");
    }
  },
);

export default router;
