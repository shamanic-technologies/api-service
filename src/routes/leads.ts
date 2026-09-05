import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import {
  callExternalService,
  callExternalServiceWithStatus,
  pipeExternalService,
  externalServices,
} from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";
import { LeadSearchRequestSchema } from "../schemas.js";

const router = Router();

/**
 * The inbound query string, verbatim, including the leading `?` (empty when there
 * is none). Read off `req.originalUrl` rather than re-serialized from `req.query`:
 * re-serializing imposes this gateway's opinion on repeated keys, ordering and
 * encoding, and silently drops anything the gateway does not know about.
 */
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

/**
 * GET /v1/leads — pass-through to lead-service GET /orgs/leads.
 * No body transform, no aggregation. Response shape is whatever lead-service returns.
 *
 * The caller's query string is forwarded verbatim, so any filter lead-service
 * accepts can be asked for without teaching this gateway about it one parameter
 * at a time. The only thing read out of it here is the brandId/campaignId
 * presence check the gateway 400s on.
 *
 * The upstream body is piped through as raw bytes rather than parsed and
 * re-serialized: the largest brands return 100–156 MB here, and holding the
 * parsed object graph plus its re-serialized copy OOM-killed the whole gateway
 * (every org's in-flight request dies with the process, not just this one).
 * See pipeExternalService.
 */
router.get("/leads", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { brandId, campaignId } = req.query as {
      brandId?: string;
      campaignId?: string;
    };
    if (!brandId && !campaignId) {
      return res.status(400).json({ error: "Missing required query parameter: brandId or campaignId" });
    }

    await pipeExternalService(
      externalServices.lead,
      `/orgs/leads${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req), expressRes: res }
    );
  } catch (error: any) {
    console.error("[api-service] Get brand leads error:", error);
    // The failure is raised before any byte of the upstream body is written, so
    // the error envelope is still the one this route has always sent.
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get leads" });
  }
});

/**
 * GET /v1/leads/stats — pass-through to lead-service GET /orgs/stats.
 *
 * The counts a surface needs to draw a badge, without any lead rows: lead-service
 * already computes `totalLeads` plus the per-lifecycle split (`buffered`, `skipped`,
 * `claimed`, and the `byOutreachStatus` / `repliesDetail` breakdowns) and serves them
 * from one aggregate query. Before this route the only way through the gateway to
 * learn a brand's lead count was `GET /v1/leads`, i.e. downloading every lead and
 * calling `.length` on a body that reaches 112 MB on the largest brand.
 *
 * The path differs from the downstream's (`/v1/leads/stats` → `/orgs/stats`) for the
 * same reason `/v1/leads` → `/orgs/leads` does: the gateway drops lead-service's
 * `/orgs` auth-tier prefix and namespaces by resource. No other transform — the query
 * string goes over verbatim and the body comes back untouched, so every filter and
 * every `groupBy` dimension lead-service accepts is reachable from here, including
 * ones it adds later.
 *
 * No brandId/campaignId guard, unlike `GET /v1/leads`: that guard exists there to keep
 * a caller from asking for the org's entire lead population by accident, and an
 * unfiltered count is a single small row. Org scope still comes from the authenticated
 * identity headers, never from the caller's query.
 */
router.get("/leads/stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.lead,
      `/orgs/stats${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) }
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get lead stats error:", error);
    respondUpstreamError(res, error, "Failed to get lead stats");
  }
});

/**
 * GET /v1/leads/:id — pass-through to lead-service GET /orgs/leads/{id}.
 *
 * Registered AFTER the literal `/leads/stats` above: a path parameter matches any
 * single segment, so declaring it first would swallow `/v1/leads/stats` and send
 * lead-service `stats` as a lead id.
 *
 * Reads ONE lead's full record. `id` is the `id` a row of GET /v1/leads already
 * carries, so a caller needs nothing it did not already receive from the list —
 * which is the point: a table + detail-panel surface takes the slim list for the
 * table and asks for depth one row at a time, instead of holding the full
 * projection for a whole brand (~57k rows / >100 MB on the largest one) so that one
 * panel can work.
 *
 * The caller's query string is forwarded verbatim for the same reason the list
 * route forwards it: `brandId` / `campaignId` decide which scope lead-service's
 * delivery overlay answers for, and a filter this gateway has never heard of must
 * still reach lead-service unchanged (CLAUDE.md rule #11). Nothing is read out of
 * it here — this route has no guard of its own to raise.
 *
 * The org boundary is the authenticated one: `x-org-id` comes from
 * `buildInternalHeaders(req)`, never from the caller, and lead-service scopes the
 * lookup on it — a lead in another org is a 404 there, indistinguishable from one
 * that does not exist.
 *
 * One record, not a list: the body is small, so it is forwarded through
 * `callExternalService` rather than piped (rule #10 is for bodies measured in MB).
 * The response shape is lead-service's; this gateway does not declare it (rule #8).
 */
router.get("/leads/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.lead,
      `/orgs/leads/${encodeURIComponent(req.params.id)}${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) }
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get lead detail error:", error);
    respondUpstreamError(res, error, "Failed to get lead");
  }
});

/**
 * POST /v1/leads/search
 * Search for leads via lead-service
 */
router.post("/leads/search", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = LeadSearchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const {
      person_titles,
      organization_locations,
      organization_industries,
      organization_num_employees_ranges,
      per_page,
    } = parsed.data;

    const result = await callExternalService(
      externalServices.lead,
      "/search",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: {
          personTitles: person_titles,
          organizationLocations: organization_locations,
          qOrganizationIndustryTagIds: organization_industries,
          organizationNumEmployeesRanges: organization_num_employees_ranges,
          perPage: Math.min(per_page, 100),
          orgId: req.orgId,
          userId: req.userId,
        },
      }
    );

    res.json(result);
  } catch (error: any) {
    console.error("Lead search error:", error);
    res.status(500).json({ error: error.message || "Failed to search leads" });
  }
});

// POST /v1/leads/enrich removed - no consumers

/**
 * GET /v1/leads/:id/step-statements — pass-through to lead-service
 * GET /orgs/leads/{id}/step-statements.
 *
 * What is known about EVERY step of one lead's campaign funnel: for each, whether it
 * happened, whether a human stated it never will, or whether nobody has said anything.
 * Pending is named by lead-service rather than inferred from an absent count, which is
 * the point of the endpoint — an outcome that has not arrived and a lead that is dead
 * at that step used to be indistinguishable.
 *
 * `id` is the `id` a row of GET /v1/leads already carries, exactly as on `/leads/:id`,
 * so the detail panel that lists the lead can ask for its steps with nothing new.
 *
 * The org boundary is the authenticated one: `x-org-id` comes from
 * `buildInternalHeaders(req)`, never from the caller, and lead-service scopes the
 * lookup on it.
 *
 * One record, forwarded through `callExternalService` rather than piped: the body is a
 * handful of steps (rule #10's piping is for bodies measured in MB). The response shape
 * is lead-service's and this gateway does not declare it (rule #8).
 */
router.get(
  "/leads/:id/step-statements",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.lead,
        `/orgs/leads/${encodeURIComponent(req.params.id)}/step-statements${rawQueryString(req.originalUrl)}`,
        { headers: buildInternalHeaders(req) }
      );

      res.json(result);
    } catch (error: any) {
      console.error("[api-service] Get lead step statements error:", error);
      respondUpstreamError(res, error, "Failed to get lead step statements");
    }
  }
);

/**
 * POST /v1/leads/:id/step-statements — pass-through to lead-service
 * POST /orgs/leads/{id}/step-statements.
 *
 * Records, by hand, what happened to this lead at one step of its campaign's funnel —
 * or that it never will. lead-service writes an `outcome` into the same conversion
 * ledger every consumer already counts, so a brand's outcome counts move on the next
 * read with no change anywhere downstream; a `never` goes to a store no count reads,
 * so it can never move a number.
 *
 * Why it matters that a browser can reach this at all: 26 of the 29 conversion events
 * ever recorded fleet-wide are unmatched, because the tracker's identity waterfall
 * misses whenever somebody signs up under a different address than the one we emailed.
 * A statement made here names the lead by the row id the caller already holds, so
 * nothing is matched and nothing is guessed.
 *
 * The body is forwarded VERBATIM. This gateway does not re-declare, narrow or validate
 * lead-service's request shape (rule #8): a field it stripped would be a bug no
 * consumer could see, and lead-service is the one that owns which statements are legal
 * — including the refusals (a `never` on a step that already happened, a value on a
 * `never`, an unparseable timestamp), each of which the two surfaces branch on to show
 * their own copy. `respondUpstreamError` forwards the upstream status and body
 * field-for-field so `code` survives; flattening it into a generic gateway error is
 * what makes a caller unable to say WHY a statement was refused.
 *
 * `buildInternalHeaders(req)` carries the caller's org AND user, because lead-service
 * records who stated the fact and attributes it to the caller's own campaign row.
 *
 * The upstream STATUS is forwarded as well, via `callExternalServiceWithStatus`. A
 * hardcoded `res.status(201)` reads as harmless while lead-service only ever answers
 * 201, and it is this gateway asserting a downstream shape all the same (rule #8): the
 * day lead-service distinguishes a created statement from a corrected one by status,
 * every consumer here would read the wrong one, with nothing in the body to catch it.
 * The query string is forwarded verbatim for the same reason as on the sibling read
 * (rule #11) — the downstream takes none today, and one it ships later needs no edit.
 */
router.post(
  "/leads/:id/step-statements",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { status, data } = await callExternalServiceWithStatus(
        externalServices.lead,
        `/orgs/leads/${encodeURIComponent(req.params.id)}/step-statements${rawQueryString(req.originalUrl)}`,
        {
          method: "POST",
          headers: buildInternalHeaders(req),
          body: req.body,
        }
      );

      res.status(status).json(data);
    } catch (error: any) {
      console.error("[api-service] Set lead step statement error:", error);
      respondUpstreamError(res, error, "Failed to record lead step statement");
    }
  }
);

/**
 * DELETE /v1/leads/:id/step-statements/:step — pass-through to lead-service
 * DELETE /orgs/leads/{id}/step-statements/{step}.
 *
 * Takes back a statement a person made by hand about one funnel step of one lead — the
 * undo of the POST above. Until it existed a statement made by mistake was permanent
 * and kept counting, so every cost-of-acquisition and return figure downstream carried
 * an outcome nobody had.
 *
 * `id` and `step` are the ones the caller already holds: the row id a list row carries
 * and the step it stated. Neither is validated here. The step vocabulary is
 * lead-service's and this gateway does not enumerate it (rule #8's corollary): a
 * `z.enum` copied here 400s a step lead-service accepts, and every step it ships later
 * needs a gateway release before a customer can withdraw one.
 *
 * The refusals are the point of forwarding the body untouched. Withdrawing something no
 * person stated answers 409 `nothing_stated`; withdrawing a tracker-reported or
 * delivery-measured outcome answers 409 `not_a_statement`; a pair outside this org is a
 * 404. A customer surface has to tell each of those apart from a server failure, and it
 * can only do that if `code` survives — `respondUpstreamError` re-emits the upstream
 * JSON field-for-field under the upstream status, where rebuilding the envelope from
 * the thrown Error would stringify the whole body into `error`.
 *
 * The upstream STATUS is forwarded for the same reason as on the write: withdrawing
 * what is already withdrawn is a 200 with `alreadyWithdrawn: true`, and a hardcoded
 * status here would be this gateway asserting a downstream shape.
 *
 * The org boundary is the authenticated one, and `buildInternalHeaders(req)` carries
 * the user too because lead-service records who withdrew the statement. The query
 * string is forwarded verbatim (rule #11) — the sibling read scopes on `brandId` there.
 */
router.delete(
  "/leads/:id/step-statements/:step",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { status, data } = await callExternalServiceWithStatus(
        externalServices.lead,
        `/orgs/leads/${encodeURIComponent(req.params.id)}/step-statements/${encodeURIComponent(
          req.params.step
        )}${rawQueryString(req.originalUrl)}`,
        {
          method: "DELETE",
          headers: buildInternalHeaders(req),
        }
      );

      res.status(status).json(data);
    } catch (error: any) {
      console.error("[api-service] Withdraw lead step statement error:", error);
      respondUpstreamError(res, error, "Failed to withdraw lead step statement");
    }
  }
);

/**
 * GET /v1/leads/:id/followups — pass-through to lead-service
 * GET /orgs/leads/{id}/followups.
 *
 * What we owe one person next on one campaign: when the next follow-up is due, whether
 * a worker currently holds them, how many have gone out, and why the schedule is empty
 * when it is. The detail panel already renders this state inside the lead's history;
 * this route is the same state on its own, so a surface that wrote to the sibling POST
 * can re-read what it now owes without pulling the whole timeline.
 *
 * `id` is the `id` a row of GET /v1/leads already carries, exactly as on `/leads/:id`
 * and `/leads/:id/step-statements`.
 *
 * The org boundary is the authenticated one: `x-org-id` comes from
 * `buildInternalHeaders(req)`, never from the caller, and lead-service scopes the
 * lookup on it — a lead in another org is a 404 there, indistinguishable from one that
 * does not exist. The query string is forwarded verbatim (rule #11); nothing is read
 * out of it here.
 *
 * One row, forwarded through `callExternalService` rather than piped (rule #10's piping
 * is for bodies measured in MB). The response shape is lead-service's and this gateway
 * does not declare it (rule #8).
 */
router.get(
  "/leads/:id/followups",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.lead,
        `/orgs/leads/${encodeURIComponent(req.params.id)}/followups${rawQueryString(req.originalUrl)}`,
        { headers: buildInternalHeaders(req) }
      );

      res.json(result);
    } catch (error: any) {
      console.error("[api-service] Get lead follow-up state error:", error);
      respondUpstreamError(res, error, "Failed to get lead follow-up state");
    }
  }
);

/**
 * POST /v1/leads/:id/followups — pass-through to lead-service
 * POST /orgs/leads/{id}/followups.
 *
 * States when the next follow-up to one person is owed. A customer looking at a lead
 * whose next answer is days out can say it is owed NOW — lead-service writes the due
 * date and releases any claim, so the campaign picks that person up on its next turn
 * instead of waiting out the schedule. Before this route the whole follow-up surface
 * was reachable only service-to-service, so no browser could state anything about it.
 *
 * `id` is the `id` a row of GET /v1/leads already carries — the same one the detail
 * panel used to read the lead and its history — so the caller supplies no identity
 * field about the person.
 *
 * The body is forwarded VERBATIM. This gateway does not re-declare, narrow or enumerate
 * lead-service's request shape (rule #8's corollary): `kind`, the timestamps and the
 * stop `reason` are its vocabulary, and a `z.enum` copied here would 400 a kind it
 * accepts and need a gateway release for every one it adds. It owns which statements
 * are legal, and its refusals are the reason this forwards untouched — a schedule that
 * was stopped, a date outside the accepted range (`due_date_out_of_bounds`, which
 * carries the bounds), an unparseable one (`due_date_unparseable`), a missing stop
 * reason (`reason_required`), a lead that is not this org's (404). Each is rendered to
 * the customer as the reason the button did nothing, which is only possible while
 * `code` survives: `respondUpstreamError` re-emits the upstream JSON field-for-field
 * under the upstream status, where rebuilding the envelope from the thrown Error would
 * stringify the whole body into `error` (rule #7).
 *
 * The upstream STATUS is forwarded via `callExternalServiceWithStatus` rather than
 * hardcoded, for the same reason as on the sibling write: lead-service answers 200
 * today, and a status this gateway asserts is a downstream shape it does not own.
 *
 * `buildInternalHeaders(req)` carries the caller's org AND user — the org is the
 * boundary lead-service scopes the row on, and it is never read from the caller's body
 * or query.
 */
router.post(
  "/leads/:id/followups",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { status, data } = await callExternalServiceWithStatus(
        externalServices.lead,
        `/orgs/leads/${encodeURIComponent(req.params.id)}/followups${rawQueryString(req.originalUrl)}`,
        {
          method: "POST",
          headers: buildInternalHeaders(req),
          body: req.body,
        }
      );

      res.status(status).json(data);
    } catch (error: any) {
      console.error("[api-service] Record lead follow-up error:", error);
      respondUpstreamError(res, error, "Failed to record lead follow-up");
    }
  }
);

/**
 * GET /v1/leads/:id/history — pass-through to lead-service
 * GET /orgs/leads/{id}/history.
 *
 * Everything that happened to one person, in order, in one place: both directions of
 * every exchange WITH the message bodies, what was sent and when it was delivered,
 * what the person did, what somebody recorded by hand, and what it converted into.
 * lead-service merges and de-duplicates it across the services that own each fact, so
 * this gateway forwards one ordered list and merges nothing (rule #2).
 *
 * `id` is the `id` a row of GET /v1/leads already carries, exactly as on `/leads/:id`
 * and `/leads/:id/step-statements`, so the detail panel listing the lead can ask for
 * its history with nothing new.
 *
 * Why the error path matters more here than on most reads: this endpoint deliberately
 * distinguishes a source it could NOT read (`sources[].status: "unavailable"`,
 * `complete: false`) from a fact that did not happen, and it says so in the body. A
 * gateway that flattened or rewrote that body would turn "we could not read your
 * mailbox" into "your prospect said nothing". `respondUpstreamError` re-emits the
 * upstream JSON field-for-field under the upstream status, so the 400 on a bad `scope`
 * and the 404 on a lead outside this org stay themselves.
 *
 * The query string is forwarded verbatim (rule #11): `scope` and `brandId` are the ones
 * lead-service documents today, and any it adds tomorrow reaches it without a change
 * here. Nothing is read out of it — this route has no guard of its own to raise.
 *
 * The org boundary is the authenticated one: `x-org-id` comes from
 * `buildInternalHeaders(req)`, never from the caller, and lead-service scopes the
 * lookup on it — a lead in another org is a 404 there.
 *
 * One person's history, forwarded through `callExternalService` rather than piped:
 * bounded by one lead's own events, not by a brand's population (rule #10's piping is
 * for bodies measured in MB). The response shape is lead-service's and this gateway
 * does not declare it (rule #8).
 */
router.get(
  "/leads/:id/history",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.lead,
        `/orgs/leads/${encodeURIComponent(req.params.id)}/history${rawQueryString(req.originalUrl)}`,
        { headers: buildInternalHeaders(req) }
      );

      res.json(result);
    } catch (error: any) {
      console.error("[api-service] Get lead history error:", error);
      respondUpstreamError(res, error, "Failed to get lead history");
    }
  }
);

export default router;
