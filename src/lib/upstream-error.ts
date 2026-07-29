import type { Response } from "express";

/**
 * Forward a downstream-service failure to the client with its status AND its body
 * intact.
 *
 * `callExternalService` (src/lib/service-client.ts) throws an Error whose
 * `message` is the upstream response body VERBATIM and whose `statusCode` is the
 * upstream status (CLAUDE.md rule #7). Routes used to rebuild their own envelope
 * out of that message — `res.json({ error: err.message })` — which stringifies the
 * whole downstream JSON body INTO the `error` string. Two consequences, both hit in
 * prod: the machine-readable fields are destroyed (no consumer can branch on
 * `code`), and the dashboard renders the raw body to the end user, e.g.
 *
 *   Could not save: {"error":"A brand already exists for domain \"x.com\"","code":"DOMAIN_CONFLICT"}
 *
 * This helper re-emits the upstream body as the response body when it is a JSON
 * object, so `{ error, code, details, ... }` reaches the caller field-for-field
 * under the upstream status. The gateway does not own downstream shapes (rule #8),
 * so it must not flatten them.
 *
 * The `JSON.parse` try/catch is content-type detection, NOT error swallowing: a
 * non-JSON upstream body (an HTML error page, a bare string, an empty body) has no
 * fields to preserve, so it is wrapped as `{ error: <body> }` — still verbatim, and
 * still under the upstream status. `fallbackMessage` is used only when the upstream
 * gave no body at all (or the failure never reached the upstream, e.g. a thrown
 * env-var error), which is the sole case where the gateway has nothing to forward.
 */
export function respondUpstreamError(res: Response, error: unknown, fallbackMessage: string): void {
  const err = error as { statusCode?: unknown; message?: unknown } | null;
  const status = typeof err?.statusCode === "number" ? err.statusCode : 500;
  const rawBody = typeof err?.message === "string" ? err.message : "";

  const structured = parseJsonObject(rawBody);
  if (structured) {
    res.status(status).json(structured);
    return;
  }

  res.status(status).json({ error: rawBody || fallbackMessage });
}

/**
 * Parse `raw` as a JSON object, or return null when it is not one (plain text, an
 * HTML page, a JSON array/primitive). Only an object can carry the named fields
 * (`error`, `code`, `details`) a consumer branches on.
 */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
