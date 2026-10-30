import { Router, Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * Transparent proxy of social-service's org-scoped X surface (`/orgs/x/*`):
 * connect any number of X accounts to a brand (OAuth start + callback), list
 * them, set each one's account type, disconnect. Same shape as the Threads
 * proxy (`routes/threads.ts`, meta-service).
 *
 * Gateway path = social-service path prefixed with `/v1`. Nothing is renamed,
 * nothing in the body is transformed, the inbound query string is byte-copied
 * off `req.originalUrl` (CLAUDE.md rule #11; `brandId` also rides it and
 * `buildInternalHeaders` promotes it to `x-brand-id`), and the upstream STATUS
 * and body are relayed through `pipeExternalService`: the dashboard branches on
 * 400 `x_login_invalid`, 402 `insufficient_balance`, 409 `needs_reconnect` /
 * `already_held`, and 502 `x_not_configured` with `details.provider`. None of
 * them is flattened (`respondUpstreamError` on the catch).
 *
 * Auth tier: social-service requires `x-org-id` and `x-user-id` on every
 * `/orgs/x/*` route, so every route here is `authenticate + requireOrg +
 * requireUser`; identity reaches social-service only through
 * `buildInternalHeaders` (the authenticated org, never a caller-named one).
 *
 * NOT proxied: social-service's `/internal/x-accounts*` (access-token handout,
 * import, refresh cron).
 */
const router = Router();

const orgUserChain = [authenticate, requireOrg, requireUser] as const;

/** The inbound query string verbatim, leading `?` included (empty when none). */
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

async function forward(
  req: AuthenticatedRequest,
  res: Response,
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  label: string,
): Promise<void> {
  try {
    await pipeExternalService(externalServices.social, `${path}${rawQueryString(req.originalUrl)}`, {
      method,
      body: method === "POST" || method === "PATCH" ? req.body : undefined,
      headers: buildInternalHeaders(req),
      expressRes: res,
    });
  } catch (error) {
    console.error(`[api-service] ${label} error:`, error);
    // Failed mid-body: the status line is already on the wire, so close the response.
    if (res.headersSent) {
      res.end();
      return;
    }
    respondUpstreamError(res, error, `${label} error`);
  }
}

const accountPath = (id: string) => `/orgs/x/accounts/${encodeURIComponent(id)}`;

// POST /v1/orgs/x/auth/start → social-service POST /orgs/x/auth/start
router.post("/orgs/x/auth/start", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/x/auth/start", "POST", "X auth start"),
);

// POST /v1/orgs/x/auth/callback → social-service POST /orgs/x/auth/callback
router.post("/orgs/x/auth/callback", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/x/auth/callback", "POST", "X auth callback"),
);

// GET /v1/orgs/x/accounts?brandId → social-service GET /orgs/x/accounts
router.get("/orgs/x/accounts", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/x/accounts", "GET", "List X accounts"),
);

// PATCH /v1/orgs/x/accounts/:id → social-service PATCH /orgs/x/accounts/:id
router.patch("/orgs/x/accounts/:id", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, accountPath(req.params.id), "PATCH", "Update X account"),
);

// DELETE /v1/orgs/x/accounts/:id → social-service DELETE /orgs/x/accounts/:id
router.delete("/orgs/x/accounts/:id", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, accountPath(req.params.id), "DELETE", "Disconnect X account"),
);

export default router;
