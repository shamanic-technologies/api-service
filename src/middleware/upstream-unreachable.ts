import type { Request, Response, NextFunction } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import type { UpstreamUnreachableError } from "../lib/service-client.js";

/**
 * Named answer when a downstream never answered, for EVERY route.
 *
 * `respondUpstreamError` already emits `UpstreamUnreachableError.body` (503
 * `upstream_unreachable` / 504 `upstream_timeout`). Many route catches still
 * rebuild their own envelope instead — `res.status(error.statusCode || 500)
 * .json({ error: error.message })`, or a hard-coded 500 — which would lose the
 * `code` a client branches on. The service client records the named failure
 * here; when the route then answers 5xx with `{ error: <that exact message> }`
 * (nothing else in the body), the answer is replaced by the named one. Matching
 * the message byte-for-byte means a downstream's OWN error body is never touched.
 */
const storage = new AsyncLocalStorage<{ unreachable?: UpstreamUnreachableError }>();

/** Called by the service client when it names a fetch failure. */
export function noteUpstreamUnreachable(error: UpstreamUnreachableError): void {
  const state = storage.getStore();
  if (state) state.unreachable = error;
}

export function upstreamUnreachable(_req: Request, res: Response, next: NextFunction) {
  storage.run({}, () => {
    const state = storage.getStore()!;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const named = state.unreachable;
      if (named && res.statusCode >= 500 && isBareEnvelope(body, named.message)) {
        res.status(named.statusCode);
        res.setHeader("Retry-After", String(named.body.retryAfterSeconds));
        return originalJson(named.body);
      }
      return originalJson(body);
    }) as Response["json"];
    next();
  });
}

function isBareEnvelope(body: unknown, message: string): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "error" && (body as { error: unknown }).error === message;
}
