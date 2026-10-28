import { Router, Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * Transparent proxy of meta-service's org-scoped Threads surface
 * (`/orgs/threads/*`): connect any number of Threads accounts to a brand
 * (OAuth start + callback), list them, set each one's account type, disconnect,
 * and publish a post or a reply on one.
 *
 * Gateway path = meta-service path prefixed with `/v1`. Nothing is renamed,
 * nothing in the body is transformed, the inbound query string is byte-copied
 * off `req.originalUrl` (CLAUDE.md rule #11; `brandId` also rides it and
 * `buildInternalHeaders` promotes it to `x-brand-id`), and the upstream STATUS
 * and body are relayed through `pipeExternalService`: publish answers 201, a
 * revoked login answers 409 `{ reason: "needs_reconnect", accountId }`, missing
 * Threads app keys or a Threads refusal answer 502 with meta-service's named
 * error. None of them is flattened (`respondUpstreamError` on the catch).
 *
 * Auth tier: meta-service requires `x-org-id`, `x-user-id` and `x-run-id` on
 * every `/orgs/threads/*` route, so every route here is
 * `authenticate + requireOrg + requireUser`; identity reaches meta-service only
 * through `buildInternalHeaders` (the authenticated org, never a caller-named one).
 *
 * NOT proxied: meta-service's `/internal/threads/*` (token refresh cron, rule #3)
 * and its managed ads routes.
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
    await pipeExternalService(externalServices.meta, `${path}${rawQueryString(req.originalUrl)}`, {
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

const accountPath = (id: string) => `/orgs/threads/accounts/${encodeURIComponent(id)}`;

// POST /v1/orgs/threads/auth/start → meta-service POST /orgs/threads/auth/start
router.post("/orgs/threads/auth/start", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/threads/auth/start", "POST", "Threads auth start"),
);

// POST /v1/orgs/threads/auth/callback → meta-service POST /orgs/threads/auth/callback
router.post("/orgs/threads/auth/callback", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/threads/auth/callback", "POST", "Threads auth callback"),
);

// GET /v1/orgs/threads/accounts?brandId → meta-service GET /orgs/threads/accounts
router.get("/orgs/threads/accounts", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/threads/accounts", "GET", "List Threads accounts"),
);

// PATCH /v1/orgs/threads/accounts/:id → meta-service PATCH /orgs/threads/accounts/:id
router.patch("/orgs/threads/accounts/:id", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, accountPath(req.params.id), "PATCH", "Update Threads account"),
);

// DELETE /v1/orgs/threads/accounts/:id → meta-service DELETE /orgs/threads/accounts/:id
router.delete("/orgs/threads/accounts/:id", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, accountPath(req.params.id), "DELETE", "Disconnect Threads account"),
);

// POST /v1/orgs/threads/accounts/:id/posts → meta-service POST /orgs/threads/accounts/:id/posts (201 relayed)
router.post("/orgs/threads/accounts/:id/posts", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, `${accountPath(req.params.id)}/posts`, "POST", "Publish Threads post"),
);

export default router;
