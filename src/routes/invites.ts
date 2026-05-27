import { Router } from "express";
import {
  authenticate,
  requireOrg,
  requireUser,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

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
// orchestrates: record claim row → grant $25 to inviter + $25 to invitee via
// billing-service → send invite-claimed-welcome + invite-success-notification
// via transactional-email-service. api-service stays a transparent proxy.
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
        `/internal/orgs/${encodeURIComponent(req.params.orgId)}/invites/claim`,
        {
          method: "POST",
          body: req.body,
          headers: buildInternalHeaders(req),
        },
      );
      res.json(result);
    } catch (error: any) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || "Failed to claim invite" });
    }
  },
);

export default router;
