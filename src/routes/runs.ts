import { Router } from "express";
import { authenticate, requireOrg, requireUser, requireStaff, AuthenticatedRequest, authenticatePlatform } from "../middleware/auth.js";
import { callExternalService, externalServices, pipeExternalService, streamExternalService } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

/**
 * GET /v1/runs
 * List runs from runs-service. Transparent proxy — all query params forwarded as-is.
 */
router.get("/runs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const qs = new URLSearchParams();
    for (const [key, val] of Object.entries(req.query)) {
      if (val != null) qs.set(key, String(val));
    }

    const result = await callExternalService(
      externalServices.runs,
      `/v1/runs?${qs.toString()}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] List runs error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list runs" });
  }
});

/**
 * GET /v1/runs/stats/costs
 * Get cost stats from runs-service.
 *
 * Query params:
 * - groupBy (required): "brandId" | "costName" | "campaignId" | "serviceName"
 * - brandId: filter by brand
 * - campaignId: filter by campaign
 * - taskName: filter by task name (e.g. "lead-serve")
 * - featureSlug: filter by one exact feature slug
 * - featureSlugs: comma-separated feature slugs (runs-service `IN (...)`), e.g. a channel
 *   slug plus its sourcing origin slugs. Without it here, a multi-slug caller got the
 *   UNFILTERED total back with a 200.
 * - startedAfter / startedBefore: filter by run start window (ISO date-time)
 */
router.get("/runs/stats/costs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.orgId!;
    const groupBy = req.query.groupBy as string;

    if (!groupBy) {
      return res.status(400).json({ error: "groupBy query param is required" });
    }

    const params = new URLSearchParams({
      orgId,
      groupBy,
    });
    // featureDynastySlug intentionally omitted — runs-service v0.31.3 (DIS-14) dropped the param.
    // Inbound callers (e.g. dashboard) may still send it; we accept it silently and don't forward.
    for (const key of [
      "brandId",
      "campaignId",
      "taskName",
      "workflowSlug",
      "featureSlug",
      "featureSlugs",
      "workflowDynastySlug",
      "startedAfter",
      "startedBefore",
    ]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }

    const data = await callExternalService<{
      groups: Array<Record<string, unknown>>;
    }>(
      externalServices.runs,
      `/v1/stats/costs?${params}`,
      { headers: buildInternalHeaders(req) },
    );

    res.json(data);
  } catch (error: any) {
    console.error("Get runs stats costs error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get runs stats" });
  }
});

/**
 * Everything after the first `?` of the original URL, `?` included (or "").
 * Forwarded verbatim so repeated keys, ordering and the caller's encoding survive
 * byte-identical (CLAUDE.md rule #11).
 */
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

/**
 * GET /v1/runs/stats/run-outcomes → runs-service GET /v1/stats/run-outcomes
 *
 * How the org's runs ended (completed / failed / running, success rate) and the
 * median duration of the completed ones, per group (default one per campaign).
 * Pure passthrough: the query string is forwarded verbatim (campaignIds,
 * startedAfter, groupBy, scope and whatever runs-service accepts next), and the
 * body comes back untouched. The org is NOT a query parameter: runs-service scopes
 * on the `x-org-id` header, which `buildInternalHeaders` sets from the
 * authenticated identity only.
 */
router.get("/runs/stats/run-outcomes", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const data = await callExternalService(
      externalServices.runs,
      `/v1/stats/run-outcomes${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(data);
  } catch (error: any) {
    console.error("[api-service] Get run outcomes error:", error);
    respondUpstreamError(res, error, "Failed to get run outcomes");
  }
});

/**
 * The caller's query with every `orgId` parameter dropped and the authenticated org
 * appended as the only one. Everything else is kept byte-identical (#11); the org is
 * the one identity the gateway owns, so a caller-supplied `orgId` never chooses it.
 */
function queryWithOrgId(originalUrl: string, orgId: string): string {
  const raw = rawQueryString(originalUrl).slice(1);
  const kept = raw
    .split("&")
    .filter((pair) => {
      if (pair === "") return false;
      const key = pair.split("=")[0];
      let decoded = key;
      try { decoded = decodeURIComponent(key.replace(/\+/g, " ")); } catch { /* keep the raw key */ }
      return decoded !== "orgId";
    });
  kept.push(`orgId=${encodeURIComponent(orgId)}`);
  return `?${kept.join("&")}`;
}

/**
 * GET /v1/runs/vendor → runs-service GET /internal/runs/vendor — STAFF ONLY.
 *
 * The GET /v1/runs list with each run's cost ALSO stated at what the vendors charged
 * us before markup (own + subtree). It reveals our margin, so `authenticatePlatform` +
 * `requireStaff` run first (no network, so a non-staff caller reaches no service), then
 * `authenticate` + `requireOrg` + `requireUser` resolve the org being viewed — the same
 * org GET /v1/runs lists. runs-service takes that org as the `orgId` QUERY parameter, so
 * the gateway sets it from the authenticated org and drops any caller-supplied one; the
 * rest of the query is forwarded verbatim (#11), status + body piped (#10), errors
 * field-for-field (#7).
 *
 * Declared before `/runs/:id` so `vendor` is never bound as a run id (#13).
 */
router.get(
  "/runs/vendor",
  authenticatePlatform,
  requireStaff,
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(
        externalServices.runs,
        `/internal/runs/vendor${queryWithOrgId(req.originalUrl, req.orgId as string)}`,
        { headers: buildInternalHeaders(req), expressRes: res },
      );
    } catch (error: any) {
      console.error("[api-service] List runs at vendor cost error:", error.message);
      if (res.headersSent) { res.end(); return; }
      respondUpstreamError(res, error, "Failed to list runs at vendor cost");
    }
  },
);

/**
 * GET /v1/runs/stats/costs/vendor → runs-service GET /internal/stats/costs/vendor — STAFF ONLY.
 *
 * The fleet-wide grouped cost aggregation on the VENDOR-cost basis (what the
 * committed cost rows cost us before markup). It reveals our margin across every
 * org, so `authenticatePlatform` + `requireStaff` and nothing else: no org is
 * resolved, and runs-service treats an absent `orgId` as the whole fleet. The
 * query string (`groupBy`, and whatever runs-service accepts next) is forwarded
 * verbatim (#11), status + body piped byte-for-byte (#10), errors field-for-field (#7).
 */
router.get("/runs/stats/costs/vendor", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.runs,
      `/internal/stats/costs/vendor${rawQueryString(req.originalUrl)}`,
      { expressRes: res },
    );
  } catch (error: any) {
    console.error("[api-service] Fleet vendor cost stats error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read fleet vendor cost stats");
  }
});

/**
 * GET /v1/runs/stats/costs/margin → runs-service GET /internal/stats/costs/margin — STAFF ONLY.
 *
 * Platform-billed spend with its vendor cost and margin, fleet-wide (or one org
 * via runs-service's own optional `orgId` query parameter). Same gate and same
 * passthrough as the vendor read above.
 */
router.get("/runs/stats/costs/margin", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.runs,
      `/internal/stats/costs/margin${rawQueryString(req.originalUrl)}`,
      { expressRes: res },
    );
  } catch (error: any) {
    console.error("[api-service] Fleet cost margin stats error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read fleet cost margin stats");
  }
});

/**
 * GET /v1/runs/stats/costs/margin/timeseries → runs-service GET /internal/stats/costs/margin/timeseries — STAFF ONLY.
 *
 * The margin read above split into UTC calendar months, every provider in one
 * response (the Monitoring > Cost drawer chart). Same gate, same passthrough.
 */
router.get("/runs/stats/costs/margin/timeseries", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.runs,
      `/internal/stats/costs/margin/timeseries${rawQueryString(req.originalUrl)}`,
      { expressRes: res },
    );
  } catch (error: any) {
    console.error("[api-service] Fleet cost margin timeseries error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read fleet cost margin timeseries");
  }
});

/**
 * GET /v1/runs/:id → runs-service GET /v1/runs/:id
 *
 * One run by id, with its cost roll-up and its descendants, forwarded untouched.
 * runs-service keys this read on the id alone and does not scope it to an org, so
 * the gateway does: a run whose `organizationId` is not the caller's authenticated
 * org is answered exactly as runs-service answers an unknown id (404 "Run not
 * found"), so another org's run is neither readable nor distinguishable from a
 * missing one. The comparison reads one field; the body is never altered.
 *
 * Declared after the literal `/runs/stats/*` siblings (CLAUDE.md rule #13).
 */
router.get("/runs/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const run = await callExternalService<{ organizationId?: string | null }>(
      externalServices.runs,
      `/v1/runs/${encodeURIComponent(req.params.id as string)}`,
      { headers: buildInternalHeaders(req) },
    );
    if (!run || run.organizationId !== req.orgId) {
      return res.status(404).json({ error: "Run not found" });
    }
    res.json(run);
  } catch (error: any) {
    console.error("[api-service] Get run error:", error);
    respondUpstreamError(res, error, "Failed to get run");
  }
});

/**
 * GET /v1/events
 * Cross-run event listing from runs-service for the authenticated org.
 * orgId is injected from the auth context — never trusted from client query.
 * Whitelisted query params are forwarded: campaignId, brandId, level, limit,
 * offset, service, workflowSlug, featureSlug, event.
 */
const EVENTS_QUERY_WHITELIST = [
  "campaignId",
  "brandId",
  "level",
  "limit",
  "offset",
  "service",
  "workflowSlug",
  "featureSlug",
  "event",
] as const;

router.get("/events", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const qs = new URLSearchParams();
    qs.set("orgId", req.orgId!);
    for (const key of EVENTS_QUERY_WHITELIST) {
      const val = req.query[key];
      if (val != null) qs.set(key, String(val));
    }

    const result = await callExternalService(
      externalServices.runs,
      `/v1/events?${qs.toString()}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] List events error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list events" });
  }
});

/**
 * GET /v1/runs/:id/events
 * List events for a specific run. Admin-only.
 */
router.get("/runs/:id/events", authenticatePlatform, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.runs,
      `/v1/runs/${req.params.id}/events`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get run events error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get run events" });
  }
});

/**
 * GET /v1/runs/:id/events/stream
 * SSE stream for run events. Admin-only.
 */
router.get("/runs/:id/events/stream", authenticatePlatform, async (req: AuthenticatedRequest, res) => {
  try {
    await streamExternalService(externalServices.runs, `/v1/runs/${req.params.id}/events/stream`, {
      method: "GET",
      headers: buildInternalHeaders(req),
      expressRes: res,
    });
  } catch (error: any) {
    console.error("[api-service] Stream run events error:", error);
    if (!res.headersSent) {
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to stream events" });
    }
  }
});

/**
 * POST /v1/runs/:id/events
 * Create an event for a run. Service-to-service (API key auth).
 */
router.post("/runs/:id/events", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.runs,
      `/v1/runs/${req.params.id}/events`,
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) },
    );
    res.status(201).json(result);
  } catch (error: any) {
    console.error("[api-service] Create run event error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create event" });
  }
});

export default router;
