import { Router, type Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Requests to the distribute.you team from ANY agent acting for an org (owner 2026-10-16, standard
// vocabulary): the Copilot's request_staff / request_skill_upgrade / contact_human, for an outside
// agent on the MCP or the API. chat-service `/orgs/staff-requests` records it, opens the GitHub issue
// in the owning repo and pings the team on Telegram, exactly as for the Copilot. A NEW outcome or
// trigger is only ever this (kind feature + newStepOrTrigger): there is no create route for one.
//
// Gate: `authenticate + requireOrg + requireUser` (downstream `/orgs/*`, rule #3): the request is filed
// for the org and the user the key acts as. Status + body piped byte-for-byte (201 filed, 200 duplicate,
// 400 refused with its message).
const router = Router();

async function pipe(req: AuthenticatedRequest, res: Response, method: "GET" | "POST", fallback: string) {
  try {
    await pipeExternalService(externalServices.chat, "/orgs/staff-requests", {
      method,
      body: method === "POST" ? req.body : undefined,
      headers: buildInternalHeaders(req),
      expressRes: res,
    });
  } catch (error: any) {
    console.error(`[api-service] ${fallback}:`, error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, fallback);
  }
}

/** POST /v1/staff-requests → chat-service POST /orgs/staff-requests: file a bug, feature, skill upgrade or contact a human. */
router.post("/v1/staff-requests", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", "Failed to file the request"),
);

/** GET /v1/staff-requests → chat-service GET /orgs/staff-requests: the org's own requests, newest first. */
router.get("/v1/staff-requests", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "GET", "Failed to list requests"),
);

export default router;
