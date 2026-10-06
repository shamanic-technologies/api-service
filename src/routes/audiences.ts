import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import {
  callExternalService,
  callExternalServiceWithStatus,
  externalServices,
  LONG_CALL_DISPATCHER,
} from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";
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

// Raw query string (from the first `?`), forwarded byte-identical (CLAUDE.md rule #11).
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

// Forward EVERY query param untouched. No `.max()` / `.default()` caps here —
// human-service owns the caps (CLAUDE.md "no-limit-defaults" rule) — and no
// whitelist either: the gateway does not own downstream shapes (CLAUDE.md #8),
// so a new human-service filter reaches it with no api-service edit.
//
// This used to take an explicit key list, which is the gateway-strips-a-field
// bug: `offerId` (the offer an audience belongs to) would have been dropped in
// silence, with the list still parsing and every guard still green. Naming one
// more key each time a filter ships reproduces that bug with extra steps.
function passthroughQuery(req: AuthenticatedRequest): string {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(req.query ?? {})) {
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

// POST /v1/orgs/audiences/split → human-service POST /orgs/audiences/split
// POST /v1/orgs/audiences/split/confirm → human-service POST /orgs/audiences/split/confirm
// POST /v1/orgs/audiences/split/estimate → human-service POST /orgs/audiences/split/estimate
// A target sentence split into segments (one LLM call + a typed judgment — up to a
// minute, well inside the default 300s service-client timeout /suggest also runs on),
// then the kept segments created as audiences; /split/estimate sizes proposed
// segments (estimated people per segment) without persisting anything. The downstream status (201, 409 on a
// name conflict, 502 on an LLM error) and its body are forwarded field for field via
// respondUpstreamError — not the flattened `fail` envelope older siblings use.
for (const suffix of ["/split", "/split/confirm", "/split/estimate"] as const) {
  router.post(`/orgs/audiences${suffix}`, ...authChain, async (req: AuthenticatedRequest, res) => {
    try {
      const { status, data } = await callExternalServiceWithStatus(
        externalServices.human,
        `/orgs/audiences${suffix}`,
        { method: "POST", headers: buildInternalHeaders(req), body: req.body },
      );
      res.status(status).json(data);
    } catch (error: any) {
      console.error(`[api-service] Audience ${suffix} error:`, error.message);
      respondUpstreamError(res, error, `Failed to call audiences${suffix}`);
    }
  });
}

// POST /v1/orgs/audiences/signal → human-service POST /orgs/audiences/signal
// A buying-signal audience (first type: linkedin_engagement). Body forwarded
// untransformed; the body's brandId ALSO rides `x-brand-id` (an identity value
// rides a header, never only the body), unless the caller already named the
// brand in the header/query, in which case a different body brandId is a 400.
// Status (201, 409 name conflict, apollo-service's named 4xx relayed by
// human-service) and body forwarded field for field.
router.post("/orgs/audiences/signal", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const headers = buildInternalHeaders(req);
    const bodyBrandId = req.body?.brandId;
    if (typeof bodyBrandId === "string" && bodyBrandId.length > 0) {
      if (headers["x-brand-id"] && headers["x-brand-id"] !== bodyBrandId) {
        res.status(400).json({
          error: `Conflict: x-brand-id (${headers["x-brand-id"]}) does not match body brandId (${bodyBrandId})`,
        });
        return;
      }
      headers["x-brand-id"] = bodyBrandId;
    }
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.human,
      "/orgs/audiences/signal",
      { method: "POST", headers, body: req.body },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] Audience signal error:", error.message);
    respondUpstreamError(res, error, "Failed to call audiences/signal");
  }
});

// POST /v1/orgs/audiences/portfolio → human-service POST /orgs/audiences/portfolio
// The ACTIVE audience portfolio (cold split + buying-signal audiences) for a
// brand + offer, derived from the ICP text the customer validated; the dashboard
// calls it at launch and polls it until `status: "ready"`. human-service answers
// once the cold audiences exist (seconds) and finishes the buying-signal audiences
// in the background; LONG_CALL_DISPATCHER (10 min) stays as headroom over the
// default 300s should a cold phase ever run long. A replay of the same brand +
// offer returns the current set without re-spending, which also makes the
// transient-network retry in callExternalServiceWithStatus safe here. Status and
// body (409, 502 `{error}`) forwarded field for field.
router.post("/orgs/audiences/portfolio", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const human = externalServices.human;
    const { status, data } = await callExternalServiceWithStatus(
      { url: human.url, apiKey: human.apiKey, dispatcher: LONG_CALL_DISPATCHER },
      "/orgs/audiences/portfolio",
      { method: "POST", headers: buildInternalHeaders(req), body: req.body },
    );
    res.status(status).json(data);
  } catch (error: any) {
    console.error("[api-service] Audience portfolio error:", error.message);
    respondUpstreamError(res, error, "Failed to call audiences/portfolio");
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
      `/orgs/audiences${passthroughQuery(req)}`,
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

// POST /v1/orgs/audiences/:id/avatar → human-service POST /orgs/audiences/{id}/avatar
// (Re)generate the audience avatar. Body { prompt? } forwarded untransformed.
// Mirrors /refresh-count: x-user-id is forwarded (chat-service avatar cost is
// org+user scoped) so the LLM spend is attributed to the caller.
router.post("/orgs/audiences/:id/avatar", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/avatar`,
      { method: "POST", headers: buildInternalHeaders(req), body: req.body },
    );
    res.json(result);
  } catch (error: any) {
    fail(res, error, "Generate audience avatar error");
  }
});

// GET /v1/orgs/audiences/:id/members → human-service GET /orgs/audiences/{id}/members
router.get("/orgs/audiences/:id/members", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/members${passthroughQuery(req)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    fail(res, error, "List audience members error");
  }
});

// GET /v1/orgs/audiences/:id/preview → human-service GET /orgs/audiences/{id}/preview
// A free sample of who the audience reaches (companies + people, no emails). The
// signed-out onboarding reads it on its anonymous org like any other org. Upstream
// status + body are forwarded field-for-field (CLAUDE.md #7 corollary).
router.get("/orgs/audiences/:id/preview", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/preview`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Audience preview error:", error?.message);
    respondUpstreamError(res, error, "Failed to preview audience");
  }
});

// GET /v1/orgs/audiences/:id/preview/email-checks → human-service GET /orgs/audiences/{id}/preview/email-checks
// Where the preview's email check stands, per sampled person (pending / found /
// not found, by which finder). Free, never an address. Upstream status + body
// forwarded field-for-field (CLAUDE.md #7 corollary).
router.get("/orgs/audiences/:id/preview/email-checks", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/preview/email-checks`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Audience preview email-checks error:", error?.message);
    respondUpstreamError(res, error, "Failed to read audience preview email checks");
  }
});

// POST /v1/orgs/audiences/:id/preview/email-checks/next → human-service POST /orgs/audiences/{id}/preview/email-checks/next
// Reveal + verify ONE more sampled person, billed to the caller's org downstream
// (the forwarded identity is the authenticated one). Body forwarded as-is.
router.post("/orgs/audiences/:id/preview/email-checks/next", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/preview/email-checks/next`,
      { method: "POST", headers: buildInternalHeaders(req), body: req.body },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Audience preview email-checks next error:", error?.message);
    respondUpstreamError(res, error, "Failed to check the next audience preview email");
  }
});

// GET /v1/orgs/audiences/:id/preview/companies → human-service GET /orgs/audiences/{id}/preview/companies
// A page of the real companies the audience reaches (offset/limit forwarded verbatim).
// Free. Upstream status + body forwarded field-for-field (CLAUDE.md #7 corollary).
router.get("/orgs/audiences/:id/preview/companies", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/preview/companies${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Audience preview companies error:", error?.message);
    respondUpstreamError(res, error, "Failed to read audience preview companies");
  }
});

// GET /v1/orgs/audiences/:id/preview/companies/email-checks → human-service GET /orgs/audiences/{id}/preview/companies/email-checks
// Where the per-company email check stands. Free, never an address. Upstream status +
// body forwarded field-for-field.
router.get("/orgs/audiences/:id/preview/companies/email-checks", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/preview/companies/email-checks`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Audience preview companies email-checks error:", error?.message);
    respondUpstreamError(res, error, "Failed to read audience preview company email checks");
  }
});

// POST /v1/orgs/audiences/:id/preview/companies/:index/email-check → human-service POST /orgs/audiences/{id}/preview/companies/{index}/email-check
// Find + verify the email of the one person to write to at company #index, billed to the
// caller's org downstream (the forwarded identity is the authenticated one). No body.
router.post("/orgs/audiences/:id/preview/companies/:index/email-check", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.human,
      `/orgs/audiences/${encodeURIComponent(req.params.id)}/preview/companies/${encodeURIComponent(req.params.index)}/email-check`,
      { method: "POST", headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Audience preview company email-check error:", error?.message);
    respondUpstreamError(res, error, "Failed to check the audience preview company email");
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
