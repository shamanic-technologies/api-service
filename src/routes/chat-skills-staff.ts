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
  options: { method?: "PUT"; body?: unknown } = {},
) {
  try {
    await pipeExternalService(externalServices.chat, path, { ...options, expressRes: res });
  } catch (error: any) {
    console.error(`[api-service] ${fallback}:`, error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, fallback);
  }
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

/** GET /v1/chat/staff-requests → chat-service GET /internal/staff-requests (`orgId`, `limit` forwarded verbatim). */
router.get("/v1/chat/staff-requests", authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
  pipe(req, res, `/internal/staff-requests${rawQueryString(req.originalUrl)}`, "Failed to list Copilot staff requests"),
);

export default router;
