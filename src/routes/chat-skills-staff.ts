import { Router } from "express";
import { authenticatePlatform, requireStaff, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Staff-only chat-service reads/writes behind the dashboard v2 Monitoring > Chat >
// Skills page: the Copilot's skill tree (live-editable markdown, versioned) and the
// Copilot's staff requests (escalations). Gate: authenticatePlatform + requireStaff,
// like every other staff Monitoring route. Status + body piped byte-for-byte (#10),
// errors field-for-field (#7). No extra rate limit: the staff dashboard calls with
// the platform key, which the global limiter exempts, so an autosave is never dropped.
const router = Router();

/** Raw query string (with its `?`) off the original URL, forwarded verbatim (#11). */
function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
}

async function pipe(
  req: AuthenticatedRequest,
  res: import("express").Response,
  path: string,
  fallback: string,
  options: { method?: "PUT" | "POST" | "DELETE"; body?: unknown } = {},
) {
  try {
    await pipeExternalService(externalServices.chat, path, { ...options, expressRes: res });
  } catch (error: any) {
    console.error(`[api-service] ${fallback}:`, error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, fallback);
  }
}

/** Reject a non-object JSON body before forwarding (the writes below stamp `editedBy` into it). */
function objectBody(req: AuthenticatedRequest, res: import("express").Response): Record<string, unknown> | null {
  const body = req.body ?? {};
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "Request body must be a JSON object" });
    return null;
  }
  return body;
}

/** GET /v1/chat/skills → chat-service GET /internal/skills — the whole skill tree (no content). */
router.get("/v1/chat/skills", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/skills${rawQueryString(req.originalUrl)}`, "Failed to list Copilot skills"),
);

/** GET /v1/chat/skills/:slug/versions → chat-service GET /internal/skills/:slug/versions. */
router.get("/v1/chat/skills/:slug/versions", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/skills/${encodeURIComponent(req.params.slug)}/versions`, "Failed to list Copilot skill versions"),
);

/** GET /v1/chat/skills/:slug/versions/:version → chat-service GET /internal/skills/:slug/versions/:version. */
router.get("/v1/chat/skills/:slug/versions/:version", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(
    req,
    res,
    `/internal/skills/${encodeURIComponent(req.params.slug)}/versions/${encodeURIComponent(req.params.version)}`,
    "Failed to read Copilot skill version",
  ),
);

/** GET /v1/chat/skills/:slug → chat-service GET /internal/skills/:slug — one skill with its markdown. */
router.get("/v1/chat/skills/:slug", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/skills/${encodeURIComponent(req.params.slug)}`, "Failed to read Copilot skill"),
);

/**
 * PUT /v1/chat/skills/:slug → chat-service PUT /internal/skills/:slug — create or update a skill.
 *
 * The body is forwarded as sent EXCEPT `editedBy`, which the gateway sets to the
 * signed-in staff email (`req.staffEmail`, from requireStaff's allowlist match).
 * Owner-approved exception to "no body transforms" (CLAUDE.md rule #4): the author
 * of a Copilot skill edit is the authenticated staff member, never a value the
 * browser chose. That also makes `editedBy: "seed"` (chat-service's marker for
 * "never edited by a human", which lets its boot seed overwrite the row)
 * unforwardable: a staff email is never "seed".
 */
router.put("/v1/chat/skills/:slug", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) => {
  const body = req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Request body must be a JSON object" });
  }
  return pipe(req, res, `/internal/skills/${encodeURIComponent(req.params.slug)}`, "Failed to save Copilot skill", {
    method: "PUT",
    body: { ...body, editedBy: req.staffEmail },
  });
});

/**
 * POST /v1/chat/skills/:slug/move → chat-service POST /internal/skills/:slug/move — drag and drop
 * (`parentSlug`, `position`; SKILL-TREE-EDIT-1122). Body forwarded as sent EXCEPT `editedBy`, stamped
 * from the staff session like the PUT. Cycle / root / deleted-parent rules are chat-service's (400/404/409
 * piped verbatim), never checked here.
 */
router.post("/v1/chat/skills/:slug/move", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  return pipe(req, res, `/internal/skills/${encodeURIComponent(req.params.slug)}/move`, "Failed to move Copilot skill", {
    method: "POST",
    body: { ...body, editedBy: req.staffEmail },
  });
});

/**
 * DELETE /v1/chat/skills/:slug → chat-service DELETE /internal/skills/:slug — soft delete, versions kept
 * (SKILL-TREE-EDIT-1122). JSON body `{ editedBy }` stamped from the staff session (any browser value
 * replaced). Child / protected-skill refusals are chat-service's 409, piped verbatim.
 */
router.delete("/v1/chat/skills/:slug", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  return pipe(req, res, `/internal/skills/${encodeURIComponent(req.params.slug)}`, "Failed to delete Copilot skill", {
    method: "DELETE",
    body: { ...body, editedBy: req.staffEmail },
  });
});

/** GET /v1/chat/staff-requests → chat-service GET /internal/staff-requests (`orgId`, `limit` forwarded verbatim). */
router.get("/v1/chat/staff-requests", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/staff-requests${rawQueryString(req.originalUrl)}`, "Failed to list Copilot staff requests"),
);

/**
 * GET /v1/chat/ops/channel-replies/daily → chat-service GET /internal/copilot/channel-replies/daily
 * (`days` forwarded verbatim; chat-service owns the default 30 and bounds 1..90). Per UTC day, how many
 * of Sophie's (the Copilot on WhatsApp) replies were delivered vs not: dashboard v2 Monitoring chart.
 */
router.get("/v1/chat/ops/channel-replies/daily", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/copilot/channel-replies/daily${rawQueryString(req.originalUrl)}`, "Failed to read Copilot channel reply delivery"),
);

/**
 * GET /v1/chat/ops/vendor-credit → chat-service GET /internal/vendor-credit (`days` forwarded verbatim;
 * chat-service owns the default 30 and bounds 1..90). Per AI vendor: out of credit or not (red on dashboard v2
 * Monitoring until a call on it succeeds), the fallback model its calls go to, and a daily series (VENDOR-CREDIT-1030).
 */
router.get("/v1/chat/ops/vendor-credit", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/vendor-credit${rawQueryString(req.originalUrl)}`, "Failed to read AI vendor credit"),
);

/**
 * GET /v1/chat/ops/schema-conformance → chat-service GET /internal/schema-conformance (`days` forwarded verbatim;
 * chat-service owns the default 30 and bounds). Per AI model: how many of its answers did not follow the
 * responseSchema the calling script sent, with a verdict and a daily series (SCHEMA-HONOURED-1115). Verdicts are
 * chat-service's, never recomputed here.
 */
router.get("/v1/chat/ops/schema-conformance", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/schema-conformance${rawQueryString(req.originalUrl)}`, "Failed to read AI schema conformance"),
);

/**
 * GET /v1/chat/ops/distry-spend/daily → chat-service GET /internal/copilot/distry-spend/daily (`days` forwarded
 * verbatim; chat-service owns the default and bounds). Per UTC day, Distry's (our AI chat) spend on non-clients
 * against the daily cap, visitors cut, turns refused and whether the alert fired: dashboard v2 Monitoring chart
 * (DISTRY-SPEND-CHART-1119).
 */
router.get("/v1/chat/ops/distry-spend/daily", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/copilot/distry-spend/daily${rawQueryString(req.originalUrl)}`, "Failed to read Distry non-client spend"),
);

// --- Distry's definition, versioned (DISTRY-PRINCIPAL-1119) -----------------
// Dashboard v2 Monitoring > Distry: read/edit Distry (our AI) — prompt, tools, skills,
// model — see every version, restore one. chat-service /internal/distry/config*.


/** GET /v1/chat/distry/config → chat-service GET /internal/distry/config (current version, code's, pickable tools/skills/models). */
router.get("/v1/chat/distry/config", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "/internal/distry/config", "Failed to read Distry's definition"),
);

/**
 * PUT /v1/chat/distry/config → chat-service PUT /internal/distry/config — save a new version.
 * Body forwarded as sent EXCEPT `editedBy`, set to the signed-in staff email (same owner-approved
 * exception as PUT /v1/chat/skills/:slug: the author is the authenticated staff member, never a
 * browser value; it also makes chat-service's reserved `seed` unforwardable).
 */
router.put("/v1/chat/distry/config", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  return pipe(req, res, "/internal/distry/config", "Failed to save Distry's definition", {
    method: "PUT",
    body: { ...body, editedBy: req.staffEmail },
  });
});

/**
 * GET /v1/chat/distry/models → chat-service GET /internal/distry/models (DISTRY-MODELS-1119): every model
 * Distry can run, its price, Artificial Analysis Intelligence Index score/rank and intelligence per dollar.
 */
router.get("/v1/chat/distry/models", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "/internal/distry/models", "Failed to read Distry's models"),
);

/** GET /v1/chat/distry/config/versions → chat-service GET /internal/distry/config/versions (newest first). */
router.get("/v1/chat/distry/config/versions", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "/internal/distry/config/versions", "Failed to list Distry's versions"),
);

/** GET /v1/chat/distry/config/versions/:version → chat-service GET /internal/distry/config/versions/:version. */
router.get("/v1/chat/distry/config/versions/:version", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/distry/config/versions/${encodeURIComponent(req.params.version)}`, "Failed to read Distry's version"),
);

/**
 * POST /v1/chat/distry/config/versions/:version/restore → chat-service POST .../restore — restore an old
 * version (saved as a new one). `editedBy` stamped from the staff session, like the PUT.
 */
router.post("/v1/chat/distry/config/versions/:version/restore", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) => {
  const body = objectBody(req, res);
  if (!body) return;
  return pipe(req, res, `/internal/distry/config/versions/${encodeURIComponent(req.params.version)}/restore`, "Failed to restore Distry's version", {
    method: "POST",
    body: { ...body, editedBy: req.staffEmail },
  });
});

export default router;
