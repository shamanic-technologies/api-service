import { Router, Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * Transparent proxy of social-service's org-scoped Instagram surface
 * (`/orgs/instagram/*`, REELS-1124): connect any number of Instagram professional
 * accounts to a brand (Instagram login start + callback), list them, set each
 * one's account type, disconnect. The twin of the X accounts proxy
 * (`routes/x-accounts.ts`), same mechanism, same guarantees.
 *
 * Gateway path = social-service path prefixed with `/v1`. Nothing is renamed,
 * nothing in the body is transformed, the inbound query string is byte-copied
 * off `req.originalUrl` (CLAUDE.md rule #11; `brandId` also rides it and
 * `buildInternalHeaders` promotes it to `x-brand-id`), and the upstream STATUS
 * and body are relayed through `pipeExternalService`: the dashboard branches on
 * 400 `instagram_login_invalid`, 409 `needs_reconnect` / `already_held`, and
 * 502 `instagram_not_configured` naming the missing variable. None of
 * them is flattened (`respondUpstreamError` on the catch).
 *
 * Auth tier: social-service requires `x-org-id` and `x-user-id` on every
 * `/orgs/instagram/*` route, so every route here is `authenticate + requireOrg +
 * requireUser`; identity reaches social-service only through
 * `buildInternalHeaders` (the authenticated org, never a caller-named one).
 *
 * NOT proxied: social-service's `/internal/instagram-accounts*` (token
 * handout, refresh cron).
 *
 * One PUBLIC route: `GET /v1/public/instagram/auth/return` (LOCKED: the
 * redirect URI registered in Meta's console), the address Instagram redirects
 * the account owner's browser to. See its handler.
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

/** social-service answers a person: a page under every status, not a JSON envelope. */
function isHtmlPage(body: unknown): body is string {
  return typeof body === "string" && /^\s*<!doctype html/i.test(body);
}

// GET /v1/public/instagram/auth/return?code=&state= → social-service GET /public/instagram/auth/return
//
// Public tier (CLAUDE.md rule #3): NO middleware and NO identity header. The
// caller is the Instagram account owner's browser, sent here by Instagram after
// he authorized a link started with POST /v1/orgs/instagram/auth/start (no
// `redirectUri`). He has
// no key and maybe no account. social-service names the pending login from the
// `state` ALONE (256 random bits, single use, expiring) and reads no org, brand
// or user from this request, so nothing here may add one. A request that is not
// Instagram's redirect of a live link costs one primary-key miss downstream, under the
// anonymous per-IP budget of the global limiter.
//
// The answer is social-service's HTML page, piped as-is under its status: 200
// connected, 4xx/5xx a page saying why. `pipeExternalService` throws a non-2xx
// with the body as the message; a page is re-emitted as the page it is (a JSON
// envelope around HTML would be shown raw to a person). Any other failure
// (social-service unreachable, a JSON refusal) keeps the gateway's usual answer.
router.get("/public/instagram/auth/return", async (req, res) => {
  // The address carries Instagram's one-time code: never cached, never sent on as a referrer.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    await pipeExternalService(externalServices.social, `/public/instagram/auth/return${rawQueryString(req.originalUrl)}`, {
      method: "GET",
      expressRes: res,
    });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const upstream = error as { statusCode?: unknown; message?: unknown } | null;
    if (typeof upstream?.statusCode === "number" && isHtmlPage(upstream.message)) {
      res.status(upstream.statusCode).type("html").send(upstream.message);
      return;
    }
    console.error("[api-service] Instagram auth public return error:", error);
    respondUpstreamError(res, error, "Instagram auth return error");
  }
});

const accountPath = (id: string) => `/orgs/instagram/accounts/${encodeURIComponent(id)}`;

// POST /v1/orgs/instagram/auth/start → social-service POST /orgs/instagram/auth/start
router.post("/orgs/instagram/auth/start", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/instagram/auth/start", "POST", "Instagram auth start"),
);

// POST /v1/orgs/instagram/auth/callback → social-service POST /orgs/instagram/auth/callback
router.post("/orgs/instagram/auth/callback", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/instagram/auth/callback", "POST", "Instagram auth callback"),
);

// GET /v1/orgs/instagram/accounts?brandId → social-service GET /orgs/instagram/accounts
router.get("/orgs/instagram/accounts", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/instagram/accounts", "GET", "List Instagram accounts"),
);

// PATCH /v1/orgs/instagram/accounts/:id → social-service PATCH /orgs/instagram/accounts/:id
router.patch("/orgs/instagram/accounts/:id", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, accountPath(req.params.id), "PATCH", "Update Instagram account"),
);

// DELETE /v1/orgs/instagram/accounts/:id → social-service DELETE /orgs/instagram/accounts/:id
router.delete("/orgs/instagram/accounts/:id", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, accountPath(req.params.id), "DELETE", "Disconnect Instagram account"),
);

export default router;
