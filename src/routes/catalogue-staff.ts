import { Router, type NextFunction, type Response } from "express";
import { authenticatePlatform, authenticateUser, requireStaff, requireStaffActor, staffKeyEmail, AuthenticatedRequest } from "../middleware/auth.js";
import { requireStaffKeyOrPlatform } from "../middleware/staff-gate.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Reads of features-service's agent catalogue (`/internal/catalogue/*`, features-service
// PR #1482): steps, sales paths, channels, pipes, sales funnels, workflows, triggers, tactics, strategies and plays, each a small LIST
// (`q`, `limit` <= 25, the "contains at least one" filters) and ONE object by id. Behind the
// dashboard v2 Staff sections (one per business object: an overview, the ongoing ones, a page
// each) and behind the distribute MCP (a staff member's own key: the reads it needs to compose a pipe,
// a funnel, a play; and, owner 2026-10-16, a CUSTOMER's own key: steps, sales paths, channels, pipes, funnels
// and triggers, lists forced to `runnable=true`). Fleet-wide, no org scoping: the producer takes no identity.
// Gate: a staff member's own key (`requireStaffActor`, `STAFF_KEY_OPERATIONS`), a customer key on the customer
// objects, or the platform key + a staff x-email (`authenticatePlatform + requireStaff`, the dashboard's path,
// unchanged). Status + body piped
// byte-for-byte (#10), errors field-for-field (#7), query string verbatim (#11).
const router = Router();

const staffKeyOrPlatform = requireStaffKeyOrPlatform;

/**
 * After `authenticateUser`: a CUSTOMER's own key (a `user_key` whose user is not staff) passes as a customer
 * (`req.catalogueCustomer = true`); anything else must be staff (`requireStaffActor`: a staff key, or the platform
 * key + a staff x-email). Owner 2026-10-16 (standard vocabulary): an outside agent on a customer key does on the
 * catalogue what the same customer does in the Copilot; WHAT a customer may create stays features-service's call.
 */
function customerKeyOrStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.authType === "user_key" && !staffKeyEmail(req)) {
    req.catalogueCustomer = true;
    return next();
  }
  return requireStaffActor(req, res, next);
}

/** Reads a customer key may make: the Bearer path admits it, the platform path stays staff (the dashboard's). */
function customerKeyOrStaffRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.headers.authorization && !req.headers["x-api-key"]) {
    return void authenticateUser(req, res, () => customerKeyOrStaff(req, res, next));
  }
  return void authenticatePlatform(req, res, () => requireStaff(req, res, next));
}

/**
 * The catalogue objects features-service serves, in its own path spelling (triggers: what starts a
 * reactive pipe; tactics: a yes/no tag on a workflow version; strategies: tactics a workflow must /
 * must not follow; plays: a pipe x a strategy, listed per `?pipe=`).
 */
export const CATALOGUE_OBJECTS = ["steps", "sales-paths", "channels", "pipes", "sales-funnels", "workflows", "triggers", "tactics", "strategies", "plays"] as const;

/**
 * What a CUSTOMER key reads (the Copilot's customer reads: steps, sales paths, channels, pipes, funnels, triggers).
 * Workflows, tactics, strategies and plays stay staff here (a customer reads plays and strategies at /v1/plays,
 * /v1/strategies).
 */
export const CUSTOMER_CATALOGUE_OBJECTS = new Set<string>(["steps", "sales-paths", "channels", "pipes", "sales-funnels", "triggers"]);

/**
 * Lists features-service filters with `runnable`. A customer's list carries `runnable=true` (the Copilot's customer
 * default, owner 2026-10-10: never present what we do not run): the producer's own filter, picked by who calls.
 */
const RUNNABLE_FILTERED_LISTS = new Set<string>(["sales-paths", "channels", "pipes", "sales-funnels"]);

/** The raw query string with `runnable` forced to `true`; every other parameter stays byte-for-byte. */
export function withRunnableForced(rawQuery: string): string {
  const kept = rawQuery.replace(/^\?/, "").split("&").filter((part) => part !== "" && part.split("=")[0] !== "runnable");
  return `?${[...kept, "runnable=true"].join("&")}`;
}

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
  const gate = CUSTOMER_CATALOGUE_OBJECTS.has(object) ? customerKeyOrStaffRead : staffKeyOrPlatform;
  /** GET /v1/catalogue/<object> → features-service GET /internal/catalogue/<object> (one page of rows). */
  router.get(`/v1/catalogue/${object}`, gate, (req: AuthenticatedRequest, res) => {
    const raw = rawQueryString(req.originalUrl);
    const query = req.catalogueCustomer && RUNNABLE_FILTERED_LISTS.has(object) ? withRunnableForced(raw) : raw;
    return pipe(res, `/internal/catalogue/${object}${query}`, `Failed to list catalogue ${object}`);
  });

  /**
   * GET /v1/catalogue/<object>/:id → features-service GET /internal/catalogue/<object>/:id (one object).
   * Express decodes the id, so it is re-encoded on the way down: a sales path id carries `+`
   * (sent as `%2B`, never a space) a pipe id carries `|`, and a play id carries `|` and `~` (`~` is unreserved, sent as is). A workflow needs `?pipe=`, which
   * rides the verbatim query string.
   */
  router.get(`/v1/catalogue/${object}/:id`, gate, (req: AuthenticatedRequest, res) =>
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
 * POST /v1/catalogue/plays/:playId/retire → features-service
 * POST /internal/catalogue/plays/{id}/retire `{retiredBy, note?}` (PLAY-RETIRE-1022): take a
 * non-default play off its pipe; the campaigns that ran it keep running on the pipe's default play.
 * `playId` = `<pipe id>~<strategy id>` (carries `|` and `~`, URL-encoded). Same staff gate as the
 * pipe retire (a staff key or the platform key + staff x-email; a client key gets 403 `staff_only`),
 * listed in `STAFF_KEY_OPERATIONS`. `retiredBy` is the AUTHENTICATED staff email, never a body value
 * (CLAUDE.md rule #4, third exception). Refusals are the producer's; status and body byte-for-byte.
 */
router.post(
  "/v1/catalogue/plays/:playId/retire",
  authenticateUser,
  requireStaffActor,
  async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(
        externalServices.features,
        `/internal/catalogue/plays/${encodeURIComponent(req.params.playId)}/retire`,
        {
          method: "POST",
          body: { ...(req.body ?? {}), retiredBy: req.staffEmail },
          expressRes: res,
        },
      );
    } catch (error: any) {
      console.error("[api-service] Failed to retire play:", error.message);
      if (res.headersSent) { res.end(); return; }
      respondUpstreamError(res, error, "Failed to retire play");
    }
  },
);

/**
 * POST /v1/catalogue/pipes → features-service POST /internal/catalogue/pipes: a NEW pipe, a channel
 * on a leg it does not perform yet (`{channelSlug, fromStep, toStep, mode, triggerId?, published?,
 * conversionRatePct?, requestedByOrgId?}`; a reactive pipe names the trigger that asks for it). A pipe is a
 * channel we would have to run: STAFF only (a staff key or the platform key + staff x-email); a customer key
 * gets 403 `staff_only` saying what it can do instead. Listed in `STAFF_KEY_OPERATIONS`.
 *
 * `createdBy` is the AUTHENTICATED staff email, never a body value (CLAUDE.md rule #4, third
 * exception). Everything else is forwarded verbatim; the 201 and every refusal come back byte-for-byte.
 */
router.post("/v1/catalogue/pipes", authenticateUser, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.authType === "user_key" && !staffKeyEmail(req)) {
    return res.status(403).json({
      error: "Staff access required",
      code: "staff_only",
      message:
        "A new pipe is a channel on a leg we would have to run: only distribute.you staff create one. Build a sales funnel from the pipes we run (GET /v1/catalogue/pipes, then POST /v1/catalogue/sales-funnels), or ask us for this channel with a feature request.",
    });
  }
  return requireStaffActor(req, res, next);
}, (req: AuthenticatedRequest, res) => create(req, res, "pipes"));

/**
 * POST /v1/catalogue/sales-funnels → features-service POST /internal/catalogue/sales-funnels: declare a sales
 * funnel from its pipes (`{pipeIds, triggerId?}`: one pipe or play id per leg of a sales path, in order).
 * POST /v1/catalogue/sales-paths → features-service POST /internal/catalogue/sales-paths: declare a sales path
 * (`{legKeys, triggerId?}`: the legs in order, optionally headed by a trigger).
 * Idempotent (201 new, 200 already declared). A customer's own key may call both (owner 2026-10-16: everything but
 * outcomes and triggers is creatable through the MCP); a customer write of either is sent `runnableOnly: true` and
 * features-service refuses what we do not run (funnel: 400 `pipe_not_runnable`; path: 400 `leg_not_runnable`, a leg
 * no pipe we run works), the gateway checks nothing itself. A staff write never carries it.
 * `createdBy` = the authenticated identity (staff email, else the key user's email, else their id), `requestedByOrgId`
 * = the org the key acts in for a customer (provenance only). Status and body byte-for-byte.
 */
for (const object of ["sales-funnels", "sales-paths"] as const) {
  router.post(`/v1/catalogue/${object}`, authenticateUser, customerKeyOrStaff, (req: AuthenticatedRequest, res) => create(req, res, object));
}

/**
 * STAFF RELAY of a features-service catalogue declaration (THREADS-CAMPAIGN-1028, owner 2026-10-12 mcp-first: every
 * catalogue object is created through the MCP, never a staff script). Gate: a staff member's own key
 * (`requireStaffActor`, listed in `STAFF_KEY_OPERATIONS`) or the platform key + a staff x-email; a customer key gets
 * 403 `staff_only` (features-service refuses a customer channel / leg / step itself, and a channel PATCH publishes for
 * every org). The author field the producer records (`createdBy` on a create, `updatedBy` on an edit) is the
 * AUTHENTICATED staff email, never a body value (CLAUDE.md rule #4, third exception); everything else is forwarded
 * verbatim, status and body byte-for-byte (refusals included).
 */
function staffRelay(method: "GET" | "POST" | "PATCH", downstreamPath: (req: AuthenticatedRequest) => string, author: "createdBy" | "updatedBy" | null, what: string) {
  return async (req: AuthenticatedRequest, res: Response) => {
    try {
      await pipeExternalService(externalServices.features, downstreamPath(req), {
        method,
        ...(author ? { body: { ...(req.body ?? {}), [author]: req.staffEmail } } : {}),
        expressRes: res,
      });
    } catch (error: any) {
      console.error(`[api-service] Failed to ${what}:`, error.message);
      if (res.headersSent) { res.end(); return; }
      respondUpstreamError(res, error, `Failed to ${what}`);
    }
  };
}

const slugOf = (req: AuthenticatedRequest) => encodeURIComponent(req.params.slug);

/** POST /v1/declarations/channels → features-service POST /internal/declarations/channels: declare a new channel (unpublished until PATCHed). */
router.post("/v1/declarations/channels", authenticateUser, requireStaffActor, staffRelay("POST", () => "/internal/declarations/channels", "createdBy", "declare channel"));

/** GET /v1/declarations/channels/:slug → features-service GET /internal/declarations/channels/:slug: one channel with every leg, published or not. */
router.get("/v1/declarations/channels/:slug", authenticateUser, requireStaffActor, staffRelay("GET", (req) => `/internal/declarations/channels/${slugOf(req)}`, null, "read channel declaration"));

/** PATCH /v1/declarations/channels/:slug → features-service PATCH /internal/declarations/channels/:slug (`published: true` publishes it). */
router.patch("/v1/declarations/channels/:slug", authenticateUser, requireStaffActor, staffRelay("PATCH", (req) => `/internal/declarations/channels/${slugOf(req)}`, "updatedBy", "update channel declaration"));

/** POST /v1/declarations/channels/:slug/legs → features-service POST /internal/declarations/channels/:slug/legs: a leg (pipe) on the channel. */
router.post("/v1/declarations/channels/:slug/legs", authenticateUser, requireStaffActor, staffRelay("POST", (req) => `/internal/declarations/channels/${slugOf(req)}/legs`, "createdBy", "declare leg"));

/** PATCH /v1/declarations/channels/:slug/legs/:legKey → features-service PATCH .../legs/:legKey (publish a draft, change mode/trigger). */
router.patch(
  "/v1/declarations/channels/:slug/legs/:legKey",
  authenticateUser,
  requireStaffActor,
  staffRelay("PATCH", (req) => `/internal/declarations/channels/${slugOf(req)}/legs/${encodeURIComponent(req.params.legKey)}`, "updatedBy", "update leg declaration"),
);

/** POST /v1/catalogue/steps → features-service POST /internal/catalogue/steps: declare a new step (outcome). */
router.post("/v1/catalogue/steps", authenticateUser, requireStaffActor, staffRelay("POST", () => "/internal/catalogue/steps", "createdBy", "declare step"));

async function create(req: AuthenticatedRequest, res: Response, object: "pipes" | "sales-funnels" | "sales-paths") {
  const body: Record<string, unknown> = { ...(req.body ?? {}) };
  if (req.catalogueCustomer) {
    body.createdBy = req.userKeyScope?.email?.trim().toLowerCase() || req.userId;
    body.requestedByOrgId = req.orgId ?? null;
    if (object === "sales-funnels" || object === "sales-paths") body.runnableOnly = true;
  } else {
    body.createdBy = req.staffEmail;
  }
  try {
    await pipeExternalService(externalServices.features, `/internal/catalogue/${object}`, {
      method: "POST",
      body,
      expressRes: res,
    });
  } catch (error: any) {
    console.error(`[api-service] Failed to create catalogue ${object}:`, error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, `Failed to create catalogue ${object}`);
  }
}

export default router;
