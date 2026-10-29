import { Router } from "express";
import { authenticate, requireOrg, requireUser, requireStaffActor, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * Scripts (FACTORY-P2-ENGINES): code stored as data in workflow-service, versioned in
 * dynasties (create = new dynasty v1, upgrade = next version, fork = new dynasty,
 * retire/restore a dynasty). Byte passthroughs via `pipeExternalService`: the
 * producer's status (201, 409 dynasty exists, 422 `replay_failed`, ...) and body reach
 * the caller verbatim. Bodies are not validated here: workflow-service owns them.
 *
 * Reads: any authenticated org + user. Writes and the replay: STAFF ONLY
 * (`requireStaffActor`, listed in `STAFF_KEY_OPERATIONS`): a script is a cross-org
 * catalogue object, a new version runs for every client on its next run.
 *
 * NOT proxied, on purpose: `POST /orgs/scripts/run` (a workflow step, Windmill calls
 * it) and `PUT /internal/scripts/.../cases` (recorded cases hold real personal data).
 */
const router = Router();

/** Identity headers + the staff actor's email as `x-email`: workflow-service records it as the script's author. */
function staffActorHeaders(req: AuthenticatedRequest): Record<string, string> {
  const headers = buildInternalHeaders(req);
  if (req.staffEmail) headers["x-email"] = req.staffEmail;
  return headers;
}

function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
}

function dynastyPath(req: AuthenticatedRequest): string {
  return `/scripts/dynasty/${encodeURIComponent(req.params.outcome)}/${encodeURIComponent(req.params.dynasty)}`;
}

async function pipe(
  req: AuthenticatedRequest,
  res: any,
  method: "GET" | "POST" | "PUT",
  path: string,
  headers: Record<string, string>,
  what: string,
) {
  try {
    await pipeExternalService(externalServices.workflow, path, {
      method,
      headers,
      ...(method === "GET" ? {} : { body: req.body ?? {} }),
      expressRes: res,
    });
  } catch (error: any) {
    console.error(`[api-service] scripts: ${what} error:`, error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, `Failed to ${what}`);
  }
}

// Reads. Literal-prefixed `/scripts/dynasty/...` is declared before `/scripts/:id`.
router.get("/scripts", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "GET", `/scripts${rawQueryString(req.originalUrl)}`, buildInternalHeaders(req), "list scripts"));

router.get("/scripts/dynasty/:outcome/:dynasty", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "GET", dynastyPath(req), buildInternalHeaders(req), "read script dynasty"));

router.get("/scripts/:id", authenticate, requireOrg, requireUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "GET", `/scripts/${encodeURIComponent(req.params.id)}`, buildInternalHeaders(req), "read script"));

// Staff writes.
router.post("/scripts", authenticate, requireOrg, requireUser, requireStaffActor, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", "/scripts", staffActorHeaders(req), "create script"));

router.post("/scripts/dynasty/:outcome/:dynasty/upgrade", authenticate, requireOrg, requireUser, requireStaffActor, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", `${dynastyPath(req)}/upgrade`, staffActorHeaders(req), "upgrade script"));

router.post("/scripts/dynasty/:outcome/:dynasty/fork", authenticate, requireOrg, requireUser, requireStaffActor, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", `${dynastyPath(req)}/fork`, staffActorHeaders(req), "fork script"));

router.put("/scripts/dynasty/:outcome/:dynasty/status", authenticate, requireOrg, requireUser, requireStaffActor, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "PUT", `${dynastyPath(req)}/status`, staffActorHeaders(req), "set script dynasty status"));

router.post("/scripts/dynasty/:outcome/:dynasty/replay", authenticate, requireOrg, requireUser, requireStaffActor, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", `${dynastyPath(req)}/replay`, staffActorHeaders(req), "replay script"));

export default router;
