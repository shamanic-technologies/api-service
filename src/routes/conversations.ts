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

/**
 * The inbound query string, verbatim, including the leading `?` (empty when there
 * is none). Read off `req.originalUrl` rather than re-serialized from `req.query`:
 * re-serializing imposes this gateway's opinion on repeated keys, ordering and
 * encoding, and silently drops anything the gateway does not know about
 * (CLAUDE.md rule #11).
 */
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

/**
 * GET /v1/conversations — pass-through to instantly-service GET /orgs/conversations.
 *
 * Reads the messages exchanged with one lead on one campaign, oldest first, so the
 * dashboard's lead detail panel can show what that person actually wrote and what we
 * answered. instantly-service covers both transports (Instantly Unibox and our own
 * SMTP/IMAP self-send) behind one response shape; it declares no cost and sends
 * nothing.
 *
 * The org boundary is the authenticated `x-org-id` from `buildInternalHeaders` — a
 * conversation belonging to another org is a 404 downstream, not a check here.
 *
 * The caller's query string is forwarded verbatim; the only thing read out of it is
 * the required-parameter presence check this gateway 400s on. An invalid VALUE is
 * the downstream's 400 to raise (rule #7 forwards it verbatim).
 *
 * Failures are forwarded with `respondUpstreamError`, which re-emits the upstream
 * JSON body field-for-field under the upstream status. That is load-bearing here:
 * instantly-service deliberately separates 404 `campaign_not_found` (no record of
 * this conversation) from a 200 with an empty `messages` (the sequence exists,
 * nothing exchanged yet) from 502 `thread_unavailable` (we hold the thread but
 * could not read it). Each renders differently in the dashboard, so the `code`
 * must survive the hop — flattening the body into an `error` string would collapse
 * them (rule #7, first corollary).
 */
router.get(
  "/conversations",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { campaign_id: campaignId, email } = req.query as {
        campaign_id?: string;
        email?: string;
      };
      if (!campaignId || !email) {
        return res
          .status(400)
          .json({ error: "Missing required query parameters: campaign_id and email" });
      }

      const result = await callExternalService(
        externalServices.instantly,
        `/orgs/conversations${rawQueryString(req.originalUrl)}`,
        { headers: buildInternalHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      console.error("[api-service] Get conversation error:", error);
      respondUpstreamError(res, error, "Failed to get conversation");
    }
  },
);

export default router;
