import { Request, Response, NextFunction } from "express";

/**
 * Server-to-server gate for platform-key routes (SEC-TEMPLATES-1120 generalised it out of
 * `src/routes/subscriber-links.ts`).
 *
 * The platform key (ADMIN_DISTRIBUTE_API_KEY) is ALSO held by the customer dashboard's
 * generic `/api/v1/*` proxy (and the anonymous `/api/anon/v1/*` one, the admin one), which
 * forward browser traffic. Every one of those proxies stamps the session's identity on the
 * request (`x-external-org-id` + `x-external-user-id`; the anon proxy its anon org) and none
 * can drop it. A server calling a platform route has no visitor identity to send, so any
 * identity header means the request came through a browser-facing proxy: refused 403 before
 * any downstream call. Mount AFTER `authenticatePlatform`.
 */
export const FORWARDED_IDENTITY_HEADERS = [
  "x-external-org-id",
  "x-external-user-id",
  "x-org-id",
  "x-user-id",
  "x-email",
  "authorization",
] as const;

export function refuseForwardedIdentity(req: Request, res: Response, next: NextFunction) {
  const carried = FORWARDED_IDENTITY_HEADERS.filter((h) => req.headers[h] !== undefined);
  if (carried.length > 0) {
    return res.status(403).json({
      error:
        "This operation is server-to-server only: the request carries a user or org identity, " +
        "so it came through a browser-facing proxy.",
      code: "server_to_server_only",
      headers: carried,
    });
  }
  return next();
}
