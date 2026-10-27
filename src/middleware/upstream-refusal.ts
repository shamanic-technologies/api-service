import type { Request, Response, NextFunction } from "express";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A downstream REFUSAL reaches the caller under the downstream's status and body,
 * for EVERY route (GATEWAY-500-ON-400-1028).
 *
 * `respondUpstreamError` already does this. About a hundred route catches still
 * rebuild their own envelope instead: `res.status(500).json({ error: error.message })`
 * (turns a producer 400 into a 500, so a caller reads its own mistake as an outage)
 * or `res.status(error.statusCode || 500).json({ error: error.message })` (right
 * status, but the producer's JSON body is stringified INTO `error`, so `code` and
 * friends are lost). Seen 2026-10-27: `GET /v1/campaigns?status=all` answered
 * `500 {"error":"{\"error\":\"status must be ...\"}"}` for campaign-service's 400.
 *
 * The service client records every non-2xx answer here (status + the exact
 * `Error.message` it throws). When the route then answers an error with a body
 * that is ONLY `{ error: <that exact message> }`, the answer is replaced by what
 * `respondUpstreamError` would have sent: the downstream status, and its JSON
 * object field-for-field (a non-JSON body stays wrapped as `{ error }`). Matching
 * the message byte-for-byte means a route's own error envelope is never touched.
 */
interface Refusal {
  status: number;
  message: string;
}

const storage = new AsyncLocalStorage<{ refusals: Refusal[] }>();

/** Called by the service client on every non-2xx downstream answer it throws or relays. */
export function noteUpstreamRefusal(status: number, message: string): void {
  storage.getStore()?.refusals.push({ status, message });
}

export function upstreamRefusal(_req: Request, res: Response, next: NextFunction) {
  storage.run({ refusals: [] }, () => {
    const state = storage.getStore()!;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 400) {
        const message = bareEnvelopeMessage(body);
        const refusal = message === null ? undefined : findLast(state.refusals, message);
        if (refusal) {
          res.status(refusal.status);
          return originalJson(parseJsonObject(refusal.message) ?? body);
        }
      }
      return originalJson(body);
    }) as Response["json"];
    next();
  });
}

function findLast(refusals: Refusal[], message: string): Refusal | undefined {
  for (let i = refusals.length - 1; i >= 0; i--) {
    if (refusals[i].message === message) return refusals[i];
  }
  return undefined;
}

function bareEnvelopeMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "error") return null;
  const error = (body as { error: unknown }).error;
  return typeof error === "string" ? error : null;
}

/** Same detection as `respondUpstreamError`: only a JSON object carries named fields. */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
