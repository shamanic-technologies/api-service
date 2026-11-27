import { Router, type NextFunction, type Response } from "express";
import { authenticateUser, requireStaffActor, staffKeyEmail, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Tactics, strategies and plays: a shared catalogue features-service serves on
// `/internal/catalogue/{tactics,strategies,plays}` (service key, no identity); it enforces every
// uniqueness rule there (409 with a named `reason`), so this gateway only authenticates and pipes.
//
// READS: any authenticated caller (`authenticateUser`; the catalogue is fleet-wide, so a multi-org
// key names no organization). WRITES (tactic/strategy/play create, tactic and strategy edit): STAFF
// ONLY (`requireStaffActor`: a pinned staff user's own key, or the platform key + a staff x-email),
// listed in `STAFF_KEY_OPERATIONS` (CATALOGUE-GATE-1127, security hotfix 2026-11-27). A tactic is
// judged by Jev on EVERY workflow/script version (our spend) and changes what every client's
// campaigns run; on 2026-11-20 a self-signed-up org created tactic `x` with its user key and
// triggered 1,407 verdicts. A client key gets 403 `staff_only` naming the staff-request door.
// Our own servers (the Copilot's create_tactic/create_strategy/create_play) call features-service
// directly, never through here.
//
// Status + body piped byte-for-byte (#10, a create answers 201 or 200 `created: false`), errors
// field-for-field (#7), query string verbatim (#11), request body passthrough (#8 corollary).
//
// ONE body edit, on the writes: `createdBy` (creates) / `updatedBy` (edits) is SET to the
// authenticated staff email and a caller-sent value is overwritten (CLAUDE.md rule #4, third exception).
const router = Router();

export const PLAY_OBJECTS = ["tactics", "strategies", "plays"] as const;

/** Raw query string (with its `?`) off the original URL, forwarded verbatim (#11). */
function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
}

/** The caller's JSON object body, `{}` for anything else. */
function jsonBody(req: AuthenticatedRequest): Record<string, unknown> {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
}

/**
 * The gate of every catalogue WRITE here: a customer's own key gets 403 `staff_only` with what it can do
 * instead; anything else goes through `requireStaffActor` (staff key, or platform key + staff x-email).
 */
function staffWriter(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.authType === "user_key" && !staffKeyEmail(req)) {
    return void res.status(403).json({
      error: "Staff access required",
      code: "staff_only",
      message:
        "Tactics, strategies and plays are shared by every client and judged on every workflow: only distribute.you staff create or edit one. " +
        "Pick an existing play (GET /v1/plays?pipe=..., GET /v1/strategies, GET /v1/tactics), or ask us for a new behaviour with POST /v1/staff-requests.",
    });
  }
  return requireStaffActor(req, res, next);
}

async function pipe(
  req: AuthenticatedRequest,
  res: Response,
  path: string,
  fallback: string,
  write?: { method: "POST" | "PATCH"; body: Record<string, unknown> },
) {
  try {
    await pipeExternalService(externalServices.features, path, {
      expressRes: res,
      ...(write ? { method: write.method, body: write.body } : {}),
    });
  } catch (error: any) {
    console.error(`[api-service] ${fallback}:`, error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, fallback);
  }
}

for (const object of PLAY_OBJECTS) {
  /** GET /v1/<object> → features-service GET /internal/catalogue/<object> (one page of rows; plays per `?pipe=`). */
  router.get(`/v1/${object}`, authenticateUser, (req: AuthenticatedRequest, res) =>
    pipe(req, res, `/internal/catalogue/${object}${rawQueryString(req.originalUrl)}`, `Failed to list ${object}`),
  );

  /**
   * GET /v1/<object>/:id → features-service GET /internal/catalogue/<object>/:id. Express decodes the
   * id, so it is re-encoded on the way down (a play id carries `|` and `~`).
   */
  router.get(`/v1/${object}/:id`, authenticateUser, (req: AuthenticatedRequest, res) =>
    pipe(
      req,
      res,
      `/internal/catalogue/${object}/${encodeURIComponent(req.params.id)}${rawQueryString(req.originalUrl)}`,
      `Failed to read ${object}`,
    ),
  );

  /** POST /v1/<object> → features-service POST /internal/catalogue/<object>. STAFF ONLY; `createdBy` = the staff email. */
  router.post(`/v1/${object}`, authenticateUser, staffWriter, (req: AuthenticatedRequest, res) => {
    return pipe(req, res, `/internal/catalogue/${object}`, `Failed to create ${object}`, {
      method: "POST",
      body: { ...jsonBody(req), createdBy: req.staffEmail },
    });
  });
}

/**
 * PATCH /v1/tactics/:id → features-service PATCH /internal/catalogue/tactics/:id (edit a tactic's
 * description; the producer re-judges every workflow version on the new words, our spend). STAFF ONLY,
 * like the create; `updatedBy` = the staff email (a sent one is overwritten), id re-encoded.
 */
router.patch("/v1/tactics/:id", authenticateUser, staffWriter, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/catalogue/tactics/${encodeURIComponent(req.params.id)}`, "Failed to edit tactic", {
    method: "PATCH",
    body: { ...jsonBody(req), updatedBy: req.staffEmail },
  }),
);

/**
 * PATCH /v1/strategies/:id → features-service PATCH /internal/catalogue/strategies/:id
 * (STRATEGY-EDIT-PUBLIC-1014): change a strategy's `requires` / `excludes` (each the FULL new
 * list) and/or `description`. STAFF ONLY, like every write here: an edit changes what every client's
 * campaigns on that strategy's plays run (a new tactic reaches no older strategy by itself, so staff
 * exclude it there). Gate = `authenticateUser + requireStaffActor`, like the pipe default play: a
 * staff member's own key (the distribute MCP) or the platform key + a staff x-email; a client key
 * gets 403 `staff_only`. Listed in `STAFF_KEY_OPERATIONS`.
 *
 * `updatedBy` is the AUTHENTICATED staff email (a sent value is overwritten); the rest of the body
 * is forwarded verbatim, id re-encoded, status and body piped byte-for-byte.
 */
router.patch("/v1/strategies/:id", authenticateUser, staffWriter, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/catalogue/strategies/${encodeURIComponent(req.params.id)}`, "Failed to edit strategy", {
    method: "PATCH",
    body: { ...jsonBody(req), updatedBy: req.staffEmail },
  }),
);

export default router;
