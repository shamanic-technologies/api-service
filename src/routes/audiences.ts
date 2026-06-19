import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

/**
 * Transparent proxy of human-service `/orgs/audiences/*` (audiences = saved
 * people-filter-sets with dynamic membership). Every sub-path is forwarded
 * verbatim — no path rename, no body transform, no field stripping, no
 * aggregation. Response is whatever human-service returns (CLAUDE.md rules
 * #1/#2/#4/#6/#8). All routes are org+user scoped: human-service `/suggest`
 * and `/refresh-count` require `x-user-id`, and audiences are created by a
 * user, so `requireUser` is applied uniformly.
 *
 * Identity (org + user) is forwarded via `buildInternalHeaders`; the
 * `x-api-key: HUMAN_SERVICE_API_KEY` header is added by `callExternalService`.
 * If the human-service env vars are unset the lazy getters throw with
 * `statusCode: 502`, so a deploy that lands before the Railway vars are set
 * degrades to a 502 on these routes only — never a boot-loop.
 */
const router = Router();

const authChain = [authenticate, requireOrg, requireUser] as const;

// Forward the audience list/members pagination + brand filter query params
// untouched. No `.max()` / `.default()` caps here — human-service owns the
// caps (CLAUDE.md "no-limit-defaults" rule). Unknown params are dropped.
function passthroughQuery(req: AuthenticatedRequest, keys: string[]): string {
  const params = new URLSearchParams();
  for (const key of keys) {
    const val = req.query?.[key];
    if (typeof val === "string" && val.length > 0) params.set(key, val);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function fail(res: import("express").Response, error: any, msg: string): void {
  console.error(`[api-service] ${msg}:`, error);
  res.status(error.statusCode || 500).json({ error: error.message || msg });
}

// POST /v1/orgs/audiences/suggest → human-service POST /orgs/audiences/suggest
router.post("/orgs/audiences/suggest", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(externalServices.human, "/orgs/audiences/suggest", {
      method: "POST",
      headers: buildInternalHeaders(req),
      body: req.body,
    });
    res.json(result);
  } catch (error: any) {
    fail(res, error, "Suggest audiences error");
  }
});

// POST /v1/orgs/audiences/stats → human-service POST /orgs/audiences/stats
router.post("/orgs/audiences/stats", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(externalServices.human, "/orgs/audiences/stats", {
      method: "POST",
      headers: buildInternalHeaders(req),
      body: req.body,
    });
    res.json(result);
  } catch (error: any) {
    fail(res, error, "Audience stats error");
  }
});

// POST /v1/orgs/audiences → human-service POST /orgs/audiences
router.post("/orgs/audiences", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(externalServices.human, "/orgs/audiences", {
      method: "POST",
      headers: buildInternalHeaders(req),
      body: req.body,
    });
    res.json(result);
  } catch (error: any) {
    fail(res, error, "Create audience error");
  }
});

// GET /v1/orgs/audiences → human-service GET /orgs/audiences
router.get("/orgs/audiences", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences${passthroughQuery(req, ["limit", "offset", "brandId"])}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    fail(res, error, "List audiences error");
  }
});

// POST /v1/orgs/audiences/:id/refresh-count → human-service POST /orgs/audiences/{id}/refresh-count
router.post("/orgs/audiences/:id/refresh-count", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/refresh-count`,
      { method: "POST", headers: buildInternalHeaders(req), body: req.body },
    );
    res.json(result);
  } catch (error: any) {
    fail(res, error, "Refresh audience count error");
  }
});

// GET /v1/orgs/audiences/:id/members → human-service GET /orgs/audiences/{id}/members
router.get("/orgs/audiences/:id/members", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/members${passthroughQuery(req, ["limit", "offset"])}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    fail(res, error, "List audience members error");
  }
});

// PATCH /v1/orgs/audiences/:id/status → human-service PATCH /orgs/audiences/{id}/status
router.patch("/orgs/audiences/:id/status", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/status`,
      { method: "PATCH", headers: buildInternalHeaders(req), body: req.body },
    );
    res.json(result);
  } catch (error: any) {
    fail(res, error, "Update audience status error");
  }
});

// GET /v1/orgs/audiences/:id → human-service GET /orgs/audiences/{id}
router.get("/orgs/audiences/:id", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    fail(res, error, "Get audience error");
  }
});

// PATCH /v1/orgs/audiences/:id → human-service PATCH /orgs/audiences/{id}
router.patch("/orgs/audiences/:id", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}`,
      { method: "PATCH", headers: buildInternalHeaders(req), body: req.body },
    );
    res.json(result);
  } catch (error: any) {
    fail(res, error, "Update audience error");
  }
});

// DELETE /v1/orgs/audiences/:id → human-service DELETE /orgs/audiences/{id}
router.delete("/orgs/audiences/:id", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}`,
      { method: "DELETE", headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    fail(res, error, "Delete audience error");
  }
});

export default router;
