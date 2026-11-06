import { Router, Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * Transparent proxy of social-service's org-scoped LinkedIn surface
 * (`/orgs/linkedin/*`, LINKEDIN-ACCOUNTS-1106): connect LinkedIn accounts to a
 * brand (LinkedIn login start + callback, the member states the profile or
 * company page whose posts are imported), list them with their health and
 * history import state, set an account's type or page, disconnect. Mirror of
 * the X proxy (`routes/x-accounts.ts`).
 *
 * Gateway path = social-service path prefixed with `/v1`. Nothing is renamed,
 * nothing in the body is transformed, the inbound query string is byte-copied
 * off `req.originalUrl` (CLAUDE.md rule #11; `brandId` also rides it and
 * `buildInternalHeaders` promotes it to `x-brand-id`), and the upstream STATUS
 * and body are relayed through `pipeExternalService`: the dashboard branches on
 * 400 `linkedin_login_invalid` and 502 `linkedin_not_configured` with
 * `details.provider`. None of
 * them is flattened (`respondUpstreamError` on the catch).
 *
 * Auth tier: social-service requires `x-org-id` and `x-user-id` on every
 * `/orgs/linkedin/*` route, so every route here is `authenticate + requireOrg +
 * requireUser`; identity reaches social-service only through
 * `buildInternalHeaders` (the authenticated org, never a caller-named one).
 *
 * NOT proxied: social-service's `/internal/linkedin-accounts*` (staff).
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

const accountPath = (id: string) => `/orgs/linkedin/accounts/${encodeURIComponent(id)}`;

// POST /v1/orgs/linkedin/auth/start → social-service POST /orgs/linkedin/auth/start
router.post("/orgs/linkedin/auth/start", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/linkedin/auth/start", "POST", "LinkedIn auth start"),
);

// POST /v1/orgs/linkedin/auth/callback → social-service POST /orgs/linkedin/auth/callback
router.post("/orgs/linkedin/auth/callback", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/linkedin/auth/callback", "POST", "LinkedIn auth callback"),
);

// GET /v1/orgs/linkedin/accounts?brandId → social-service GET /orgs/linkedin/accounts
router.get("/orgs/linkedin/accounts", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/linkedin/accounts", "GET", "List LinkedIn accounts"),
);

// PATCH /v1/orgs/linkedin/accounts/:id → social-service PATCH /orgs/linkedin/accounts/:id
router.patch("/orgs/linkedin/accounts/:id", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, accountPath(req.params.id), "PATCH", "Update LinkedIn account"),
);

// DELETE /v1/orgs/linkedin/accounts/:id → social-service DELETE /orgs/linkedin/accounts/:id
router.delete("/orgs/linkedin/accounts/:id", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, accountPath(req.params.id), "DELETE", "Disconnect LinkedIn account"),
);

export default router;
