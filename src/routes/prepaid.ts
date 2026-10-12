import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";
import {
  checkPrepayAmounts,
  DEFAULT_PREPAY_CANCEL_URL,
  DEFAULT_PREPAY_SUCCESS_URL,
} from "../lib/agent-prepay.js";

/**
 * Prepaid checkout with MANDATORY auto top-up — the way an org opened through the
 * API (an AI agent) pays. Pass-through to billing-service
 * `POST /v1/accounts/prepaid_checkout` and `GET /v1/accounts/prepaid_status`.
 *
 * Two owner-approved additions on the request, nothing on the response:
 *  - the minimums ($10 prepay, $15 reload, $5 threshold) are refused HERE with a
 *    named error (owner: minimums are front validation; this gateway is the
 *    agent's front; billing binds the figures unclamped), see lib/agent-prepay;
 *  - `success_url` / `cancel_url` default to a distribute.you page when the
 *    caller sends none (an agent has no page of its own to come back to).
 * Every other field is forwarded verbatim, and billing's status + body come back
 * byte-identical (pipe), refusals included (409 subscription_mode, owed money).
 */
const router = Router();

router.post(
  "/billing/accounts/prepaid_checkout",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    const refusal = checkPrepayAmounts(req.body);
    if (refusal) return res.status(400).json(refusal);

    try {
      await pipeExternalService(externalServices.billing, "/v1/accounts/prepaid_checkout", {
        expressRes: res,
        method: "POST",
        body: {
          ...req.body,
          success_url: req.body.success_url ?? DEFAULT_PREPAY_SUCCESS_URL,
          cancel_url: req.body.cancel_url ?? DEFAULT_PREPAY_CANCEL_URL,
        },
        headers: buildInternalHeaders(req),
      });
    } catch (error) {
      respondUpstreamError(res, error, "Failed to open the prepaid checkout");
    }
  },
);

router.get(
  "/billing/accounts/prepaid_status",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(externalServices.billing, "/v1/accounts/prepaid_status", {
        expressRes: res,
        headers: buildInternalHeaders(req),
      });
    } catch (error) {
      respondUpstreamError(res, error, "Failed to read the prepaid status");
    }
  },
);

export default router;
