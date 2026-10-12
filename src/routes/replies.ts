import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * POST /v1/replies → instantly-service `POST /orgs/replies`.
 *
 * Answer a person in their existing email thread, from the mailbox and persona
 * that wrote to them (the reply a sales rep sends). instantly-service resolves
 * the mailbox, persona, signature and thread from what already happened; the
 * caller names the person (and the campaign) and supplies the words.
 *
 * Pure passthrough (rules #4/#7/#8): body forwarded byte-identical, status and
 * body piped back, refusals included (409 `human_took_over`, 404 no thread).
 * Any member of the org may reply in its threads, clients included: it is
 * their own mailbox talking to their own prospect.
 */
const router = Router();

router.post("/replies", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(externalServices.instantly, "/orgs/replies", {
      expressRes: res,
      method: "POST",
      body: req.body,
      headers: buildInternalHeaders(req),
    });
  } catch (error) {
    respondUpstreamError(res, error, "Failed to send the reply");
  }
});

export default router;
