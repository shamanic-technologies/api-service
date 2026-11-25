import { Router, type Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// The signed-in founder hands themselves to Distry (our AI, chat-service) on a channel
// (COPILOT-HANDOFF-GATEWAY-1125, owner 2026-11-25: the user dashboard is killed, founders talk with
// Distry on WhatsApp, Telegram, email or their own AI). The signup end screen posts the founder's own
// choice: their campaign (created stopped, starts on their first message to Distry) and/or the channel
// Distry writes FIRST on ("whatsapp" | "email").
//
// Gate: `authenticate + requireOrg + requireUser` (downstream `/orgs/*`, rule #3); org + user come from
// the authenticated identity (`buildInternalHeaders`), never from the body. Pure byte pipe both ways:
// body verbatim to chat-service, its status + JSON verbatim back (200/202/400/409/502 included).
const router = Router();

async function pipe(req: AuthenticatedRequest, res: Response, method: "GET" | "POST", fallback: string) {
  try {
    await pipeExternalService(externalServices.chat, "/orgs/copilot/handoff", {
      method,
      body: method === "GET" ? undefined : req.body,
      headers: buildInternalHeaders(req),
      expressRes: res,
    });
  } catch (error: any) {
    console.error(`[api-service] ${fallback}: status ${error?.statusCode ?? "none"}`);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, fallback);
  }
}

/** POST /v1/copilot/handoff → chat-service POST /orgs/copilot/handoff: record the founder's choice, Distry says hello. */
router.post("/v1/copilot/handoff", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", "Failed to hand you to Distry"),
);

/** GET /v1/copilot/handoff → chat-service GET /orgs/copilot/handoff: the user's handoff state. */
router.get("/v1/copilot/handoff", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "GET", "Failed to read your handoff to Distry"),
);

export default router;
