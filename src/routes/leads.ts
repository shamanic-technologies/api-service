import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, pipeExternalService, externalServices } from "../lib/service-client.js";
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

export default router;
