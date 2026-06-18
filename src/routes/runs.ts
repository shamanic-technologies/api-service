import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest, authenticatePlatform } from "../middleware/auth.js";
import { callExternalService, externalServices, streamExternalService } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

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
