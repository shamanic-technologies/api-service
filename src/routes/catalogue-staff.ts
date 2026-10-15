import { Router, type NextFunction, type Response } from "express";
import { authenticatePlatform, authenticateUser, requireStaff, requireStaffActor, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Staff-only reads of features-service's agent catalogue (`/internal/catalogue/*`, features-service
// PR #1482): steps, sales paths, channels, pipes, sales funnels, workflows, triggers, tactics, strategies and plays, each a small LIST
// (`q`, `limit` <= 25, the "contains at least one" filters) and ONE object by id. Behind the
// dashboard v2 Staff sections (one per business object: an overview, the ongoing ones, a page
// each) and behind the distribute MCP (a staff member's own key: the reads it needs to compose a pipe,
// a funnel, a play). Fleet-wide, no org scoping: the producer takes no identity. Gate: a staff member's
// own key (`requireStaffActor`, listed in `STAFF_KEY_OPERATIONS`), or the platform key + a staff
// x-email (`authenticatePlatform + requireStaff`, the dashboard's path, unchanged). Status + body piped
// byte-for-byte (#10), errors field-for-field (#7), query string verbatim (#11).
const router = Router();

/**
 * A Bearer key with no X-API-Key = a person's own key: staff only (`requireStaffActor`). Anything else
 * takes the platform path the dashboard has always used, which needs no identity headers.
 */
function staffKeyOrPlatform(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.headers.authorization && !req.headers["x-api-key"]) {
    return void authenticateUser(req, res, () => requireStaffActor(req, res, next));
  }
  return void authenticatePlatform(req, res, () => requireStaff(req, res, next));
}

/**
 * The catalogue objects features-service serves, in its own path spelling (triggers: what starts a
 * reactive pipe; tactics: a yes/no tag on a workflow version; strategies: tactics a workflow must /
 * must not follow; plays: a pipe x a strategy, listed per `?pipe=`).
 */
export const CATALOGUE_OBJECTS = ["steps", "sales-paths", "channels", "pipes", "sales-funnels", "workflows", "triggers", "tactics", "strategies", "plays"] as const;

/** Raw query string (with its `?`) off the original URL, forwarded verbatim (#11). */
function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
}

async function pipe(res: import("express").Response, path: string, fallback: string) {
  try {
    await pipeExternalService(externalServices.features, path, { expressRes: res });
  } catch (error: any) {
    console.error(`[api-service] ${fallback}:`, error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, fallback);
  }
}

// One explicit route per downstream path (no catch-all): the list, then the object by id.
for (const object of CATALOGUE_OBJECTS) {
  /** GET /v1/catalogue/<object> → features-service GET /internal/catalogue/<object> (one page of rows). */
  router.get(`/v1/catalogue/${object}`, staffKeyOrPlatform, (req: AuthenticatedRequest, res) =>
    pipe(res, `/internal/catalogue/${object}${rawQueryString(req.originalUrl)}`, `Failed to list catalogue ${object}`),
  );

  /**
   * GET /v1/catalogue/<object>/:id → features-service GET /internal/catalogue/<object>/:id (one object).
   * Express decodes the id, so it is re-encoded on the way down: a sales path id carries `+`
   * (sent as `%2B`, never a space) a pipe id carries `|`, and a play id carries `|` and `~` (`~` is unreserved, sent as is). A workflow needs `?pipe=`, which
   * rides the verbatim query string.
   */
  router.get(`/v1/catalogue/${object}/:id`, staffKeyOrPlatform, (req: AuthenticatedRequest, res) =>
    pipe(
      res,
      `/internal/catalogue/${object}/${encodeURIComponent(req.params.id)}${rawQueryString(req.originalUrl)}`,
      `Failed to read catalogue ${object}`,
    ),
  );
}

/**
 * PUT /v1/catalogue/pipes/:pipeId/default-play → features-service
 * PUT /internal/catalogue/pipes/{pipeId}/default-play `{strategyId, decidedBy}`
 * (RELATIONSHIP-TAGS-1014): which play a pipe runs when a campaign names none. A
 * fleet-wide STAFF write, no org: `authenticateUser + requireStaffActor`, so a staff
 * member's own key (the distribute MCP) or the platform key + a staff x-email may
 * call it, a client key gets 403 `staff_only`. Listed in `STAFF_KEY_OPERATIONS`.
 *
 * `decidedBy` is the AUTHENTICATED staff email, never a body value (CLAUDE.md rule #4,
 * third exception: an author the producer records is the authenticated identity).
 * Everything else in the body is forwarded verbatim; status and body come back
 * byte-for-byte (409 `default_play_runs_nothing` included).
 */
router.put(
  "/v1/catalogue/pipes/:pipeId/default-play",
  authenticateUser,
  requireStaffActor,
  async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(
        externalServices.features,
        `/internal/catalogue/pipes/${encodeURIComponent(req.params.pipeId)}/default-play`,
        {
          method: "PUT",
          body: { ...(req.body ?? {}), decidedBy: req.staffEmail },
          expressRes: res,
        },
      );
    } catch (error: any) {
      console.error("[api-service] Failed to set pipe default play:", error.message);
      if (res.headersSent) { res.end(); return; }
      respondUpstreamError(res, error, "Failed to set pipe default play");
    }
  },
);

/**
 * POST /v1/catalogue/pipes/:pipeId/retire → features-service
 * POST /internal/catalogue/pipes/{id}/retire `{retiredBy, note?}` (MCP-PIPE-GAPS-1015): take a pipe
 * created by mistake out of every catalogue read. Same staff gate as the default-play PUT (a staff
 * key or the platform key + staff x-email; a client key gets 403 `staff_only`), listed in
 * `STAFF_KEY_OPERATIONS`. `retiredBy` is the AUTHENTICATED staff email, never a body value (CLAUDE.md
 * rule #4, third exception). The gateway checks nothing else (usage, funnels, coded pipes are the
 * producer's refusals); status and body come back byte-for-byte.
 */
router.post(
  "/v1/catalogue/pipes/:pipeId/retire",
  authenticateUser,
  requireStaffActor,
  async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(
        externalServices.features,
        `/internal/catalogue/pipes/${encodeURIComponent(req.params.pipeId)}/retire`,
        {
          method: "POST",
          body: { ...(req.body ?? {}), retiredBy: req.staffEmail },
          expressRes: res,
        },
      );
    } catch (error: any) {
      console.error("[api-service] Failed to retire pipe:", error.message);
      if (res.headersSent) { res.end(); return; }
      respondUpstreamError(res, error, "Failed to retire pipe");
    }
  },
);

/**
 * POST /v1/catalogue/pipes → features-service POST /internal/catalogue/pipes: a NEW pipe, a channel
 * on a leg it does not perform yet (`{channelSlug, fromStep, toStep, mode, triggerId?, published?,
 * conversionRatePct?, requestedByOrgId?}`; a reactive pipe names the trigger that asks for it). A
 * fleet-wide catalogue write, like tactics, strategies and plays: staff only, the same gate as the
 * default-play PUT (a staff key or the platform key + staff x-email; a client key gets 403
 * `staff_only`). Listed in `STAFF_KEY_OPERATIONS`, so the distribute MCP finds it.
 *
 * `createdBy` is the AUTHENTICATED staff email, never a body value (CLAUDE.md rule #4, third
 * exception). Everything else is forwarded verbatim; the 201 and every refusal (400 `trigger_required`,
 * `conversion_rate_required`, ..., 404 `channel_not_found` / `trigger_not_found`, 409 `leg_exists` /
 * `trigger_not_fired`) come back byte-for-byte.
 */
/**
 * POST /v1/catalogue/sales-funnels → features-service POST /internal/catalogue/sales-funnels: declare a
 * sales funnel from its pipes (`{pipeIds, requestedByOrgId?}`: one pipe or play id per leg of a sales
 * path, in order). Idempotent: 201 new, 200 already declared. Same gate and `createdBy` rule as the
 * pipe create above; status and body byte-for-byte.
 */
for (const object of ["pipes", "sales-funnels"] as const) {
  router.post(`/v1/catalogue/${object}`, authenticateUser, requireStaffActor, async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(externalServices.features, `/internal/catalogue/${object}`, {
        method: "POST",
        body: { ...(req.body ?? {}), createdBy: req.staffEmail },
        expressRes: res,
      });
    } catch (error: any) {
      console.error(`[api-service] Failed to create catalogue ${object}:`, error.message);
      if (res.headersSent) { res.end(); return; }
      respondUpstreamError(res, error, `Failed to create catalogue ${object}`);
    }
  });
}

export default router;
