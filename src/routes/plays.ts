import { Router, type Response } from "express";
import { authenticateUser, requireStaffActor, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Tactics, strategies and plays for ANY authenticated caller (a client's key, the Copilot, staff
// through the MCP): a shared catalogue every client may read and grow (owner decision relayed by
// features-service session casablanca-v10, 2026-10-13). features-service serves them on
// `/internal/catalogue/{tactics,strategies,plays}` (service key, no identity) and enforces every
// uniqueness rule there (409 with a named `reason`), so this gateway only authenticates and pipes.
//
// Gate: `authenticateUser` — the catalogue is fleet-wide, not one org's data, so a multi-org key
// needs to name no organization; the user is always known. Status + body piped byte-for-byte
// (#10, a create answers 201 or 200 `created: false`), errors field-for-field (#7), query string
// verbatim (#11), request body passthrough (#8 corollary).
//
// ONE body edit, on the writes: `createdBy` (creates) / `updatedBy` (tactic edit; the staff email on a strategy edit) is what the producer records as the author, so it is
// SET here from the authenticated identity and a caller-sent value is overwritten — a client must
// not be able to write someone else's name into the catalogue.
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

/** The author features-service records: the authenticated user, and the org it acted in when one resolved. */
export function createdByOf(req: AuthenticatedRequest): string {
  if (!req.userId) throw new Error("createdByOf: no authenticated user (authenticateUser must run first)");
  return req.orgId ? `org:${req.orgId}/user:${req.userId}` : `user:${req.userId}`;
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

  /** POST /v1/<object> → features-service POST /internal/catalogue/<object>, `createdBy` set from the caller's identity. */
  router.post(`/v1/${object}`, authenticateUser, (req: AuthenticatedRequest, res) => {
    return pipe(req, res, `/internal/catalogue/${object}`, `Failed to create ${object}`, {
      method: "POST",
      body: { ...jsonBody(req), createdBy: createdByOf(req) },
    });
  });
}

/**
 * PATCH /v1/tactics/:id → features-service PATCH /internal/catalogue/tactics/:id (edit a tactic's
 * description; the producer re-judges every workflow version on the new words). Same access as the
 * create; `updatedBy` is SET from the caller's identity (a sent one is overwritten), id re-encoded.
 */
router.patch("/v1/tactics/:id", authenticateUser, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/catalogue/tactics/${encodeURIComponent(req.params.id)}`, "Failed to edit tactic", {
    method: "PATCH",
    body: { ...jsonBody(req), updatedBy: createdByOf(req) },
  }),
);

/**
 * PATCH /v1/strategies/:id → features-service PATCH /internal/catalogue/strategies/:id
 * (STRATEGY-EDIT-PUBLIC-1014): change a strategy's `requires` / `excludes` (each the FULL new
 * list) and/or `description`. STAFF ONLY, unlike the create: an edit changes what every client's
 * campaigns on that strategy's plays run (a new tactic reaches no older strategy by itself, so staff
 * exclude it there). Gate = `authenticateUser + requireStaffActor`, like the pipe default play: a
 * staff member's own key (the distribute MCP) or the platform key + a staff x-email; a client key
 * gets 403 `staff_only`. Listed in `STAFF_KEY_OPERATIONS`.
 *
 * `updatedBy` is the AUTHENTICATED staff email (a sent value is overwritten); the rest of the body
 * is forwarded verbatim, id re-encoded, status and body piped byte-for-byte.
 */
router.patch("/v1/strategies/:id", authenticateUser, requireStaffActor, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/catalogue/strategies/${encodeURIComponent(req.params.id)}`, "Failed to edit strategy", {
    method: "PATCH",
    body: { ...jsonBody(req), updatedBy: req.staffEmail },
  }),
);

export default router;
