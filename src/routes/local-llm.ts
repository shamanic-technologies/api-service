import { Router, type Response } from "express";
import { authenticate, authenticateUser, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { fetchUserOrganizations } from "../lib/org-scope.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// The org's LLM runs on the user's OWN Claude Code subscription, on their machine (LOCAL-CLAUDE-1116,
// owner 2026-11-16: « le user dépense $0, car tout depuis sa subscription Claude Code »). chat-service
// (the single LLM door) owns the declaration and the work queue; this file is the public way in for a
// user key: the runner in the distribute.you Mac app claims work and posts results, and the Mac app,
// the MCP and the dashboard Integrations page set and read the declaration.
//
// Gate: `authenticate + requireOrg + requireUser` (downstream `/orgs/*`, rule #3), identity from
// `buildInternalHeaders` (x-org-id, x-user-id, x-run-id). Pure byte pipe: status + body both ways,
// verbatim (200, 400, 404, 409, 410 included). The claim is a LONG POLL (up to 25 s at chat-service):
// the default undici headers timeout (300 s) covers it, and a runner that hangs up aborts the upstream
// call (pipeExternalService). No body is logged here, and the call log skips the work routes
// (`src/lib/call-log.ts`): a claim answer and a result carry customer content.
const router = Router();

type Method = "GET" | "PUT" | "POST";

async function pipe(req: AuthenticatedRequest, res: Response, method: Method, path: string, fallback: string) {
  try {
    await pipeExternalService(externalServices.chat, path, {
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

/**
 * GET /v1/local-llm/orgs → chat-service GET /internal/local-llm/orgs?orgIds=<the caller's orgs>
 * (LOCAL-CLAUDE-ORGS-1116): the runner learns in ONE call which of its user's organizations declared
 * local Claude, so a declaration made anywhere (dashboard, MCP, Conductor) is served within its refresh,
 * with no per-org scan.
 *
 * Who sees which org is decided HERE (chat-service runs no membership check): the organizations the
 * user is a MEMBER of right now (client-service), for every caller, staff included. A staff key can
 * ACT in every org, but this list stays its real memberships: a staff Mac never picks up a customer's
 * calls, which would run them on the staff member's own Claude subscription. A customer who wants
 * staff to run their calls adds that staff member to their org.
 *
 * No org target needed (`authenticateUser`): the answer is about the user. A user key reads its
 * memberships from the scope `authenticate` already loaded; the platform key (dashboard) reads them
 * for the resolved user. Zero memberships = `orgIds=` (empty), which chat-service answers with none.
 * Byte pipe of chat-service's answer `{orgs: [{orgId, declaredAt, declaredByUserId, runner, pendingCalls}]}`.
 */
router.get("/v1/local-llm/orgs", authenticateUser, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const memberships = req.userKeyScope
      ? req.userKeyScope.memberships
      : await fetchUserOrganizations(req.userId as string);
    const orgIds = memberships.map((o) => encodeURIComponent(o.id)).join(",");
    await pipeExternalService(externalServices.chat, `/internal/local-llm/orgs?orgIds=${orgIds}`, {
      method: "GET",
      expressRes: res,
    });
  } catch (error: any) {
    console.error(`[api-service] Failed to list the orgs that run on local Claude: status ${error?.statusCode ?? "none"}`);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to list the orgs that run on local Claude");
  }
});

/** GET /v1/local-llm → chat-service GET /orgs/local-llm: the org's state (declared, runner, pending calls, usage). */
router.get("/v1/local-llm", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "GET", "/orgs/local-llm", "Failed to read the local LLM state"),
);

/** PUT /v1/local-llm → chat-service PUT /orgs/local-llm: declare ({enabled: true}) or stop; answers the state. */
router.put("/v1/local-llm", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "PUT", "/orgs/local-llm", "Failed to change the local LLM declaration"),
);

/** POST /v1/local-llm/work/claim → chat-service POST /orgs/local-llm/work/claim: long poll for calls to run. */
router.post("/v1/local-llm/work/claim", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", "/orgs/local-llm/work/claim", "Failed to claim local LLM work"),
);

/** POST /v1/local-llm/work/:id/result → chat-service POST /orgs/local-llm/work/:id/result: the answer of one call. */
router.post("/v1/local-llm/work/:id/result", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(
    req,
    res,
    "POST",
    `/orgs/local-llm/work/${encodeURIComponent(req.params.id)}/result`,
    "Failed to post the local LLM result",
  ),
);

export default router;
