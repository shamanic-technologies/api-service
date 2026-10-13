import { Router, type Response } from "express";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.js";
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
// ONE body edit, on the creates: `createdBy` is what the producer records as the author, so it is
// SET here from the authenticated identity and a caller-sent value is overwritten — a client must
// not be able to write someone else's name into the catalogue.
const router = Router();

export const PLAY_OBJECTS = ["tactics", "strategies", "plays"] as const;

/** Raw query string (with its `?`) off the original URL, forwarded verbatim (#11). */
function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
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
  write?: { body: Record<string, unknown> },
) {
  try {
    await pipeExternalService(externalServices.features, path, {
      expressRes: res,
      ...(write ? { method: "POST", body: write.body } : {}),
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
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    return pipe(req, res, `/internal/catalogue/${object}`, `Failed to create ${object}`, {
      body: { ...body, createdBy: createdByOf(req) },
    });
  });
}

export default router;
