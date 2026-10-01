import { Router, Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * Transparent proxy of google-service's org-scoped Google CRM surface
 * (`/orgs/google/*`): connecting a Gmail mailbox (OAuth start/callback), listing
 * and disconnecting connected mailboxes, the async sync job, and the mirror reads
 * (messages, contacts, conversation, correspondents, contact links).
 *
 * Removed in #808 while google-service ran nowhere; restored once it was deployed
 * to the box (2026-08-26). Connecting a mailbox is a self-serve feature for every
 * dashboard user, so these are org routes, not staff routes.
 *
 * Gateway path = google-service path prefixed with `/v1`. Nothing is renamed,
 * nothing in the body is transformed, the inbound query string is byte-copied off
 * `req.originalUrl` (CLAUDE.md rule #11), and the upstream STATUS and body are
 * relayed verbatim through `pipeExternalService` — `POST /orgs/google/sync`
 * answers 202, the message list can be large, and a 404 carrying a `reason`
 * (`no_google_account_connected`, `account_not_found`, …) reaches the caller
 * field-for-field via `respondUpstreamError`.
 *
 * Auth tier: google-service requires BOTH `x-org-id` and `x-user-id` on every
 * `/orgs/google/*` route (its `requireIdentityHeaders`), so every route here is
 * `authenticate + requireOrg + requireUser`. Identity reaches google-service only
 * through `buildInternalHeaders` (the authenticated org, never a caller-named one).
 * Nothing here talks to Google itself.
 *
 * google-service's `/internal/*` routes (the staff exchange read) are deliberately
 * NOT proxied (rule #3).
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
  method: "GET" | "POST" | "PUT" | "DELETE",
  label: string,
): Promise<void> {
  try {
    await pipeExternalService(externalServices.google, path, {
      method,
      body: method === "POST" || method === "PUT" ? req.body : undefined,
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

// POST /v1/orgs/google/auth/start → google-service POST /orgs/google/auth/start
router.post("/orgs/google/auth/start", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/google/auth/start", "POST", "Google auth start"),
);

// GET /v1/orgs/google/auth/callback?code&state → google-service GET /orgs/google/auth/callback
router.get("/orgs/google/auth/callback", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, `/orgs/google/auth/callback${rawQueryString(req.originalUrl)}`, "GET", "Google auth callback"),
);

// GET /v1/orgs/google/accounts → google-service GET /orgs/google/accounts
router.get("/orgs/google/accounts", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, `/orgs/google/accounts${rawQueryString(req.originalUrl)}`, "GET", "List Google accounts"),
);

// DELETE /v1/orgs/google/accounts/:email → google-service DELETE /orgs/google/accounts/:email
// Express decodes the param; it is re-encoded so `@` and friends reach google-service
// as one path segment.
router.delete("/orgs/google/accounts/:email", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(
    req,
    res,
    `/orgs/google/accounts/${encodeURIComponent(req.params.email)}`,
    "DELETE",
    "Disconnect Google account",
  ),
);

// POST /v1/orgs/google/sync → google-service POST /orgs/google/sync (202 relayed)
router.post("/orgs/google/sync", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/google/sync", "POST", "Google sync start"),
);

// GET /v1/orgs/google/sync/:jobId → google-service GET /orgs/google/sync/:jobId
router.get("/orgs/google/sync/:jobId", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, `/orgs/google/sync/${encodeURIComponent(req.params.jobId)}`, "GET", "Google sync status"),
);

// Mirror reads: query string forwarded byte-identical.
for (const [segment, label] of [
  ["messages", "List Gmail messages"],
  ["contacts", "List Google contacts"],
  ["conversation", "Google conversation"],
  ["correspondents", "Google correspondents"],
] as const) {
  router.get(`/orgs/google/${segment}`, ...orgUserChain, (req: AuthenticatedRequest, res) =>
    forward(req, res, `/orgs/google/${segment}${rawQueryString(req.originalUrl)}`, "GET", label),
  );
}

// PUT /v1/orgs/google/contact-links → google-service PUT /orgs/google/contact-links
router.put("/orgs/google/contact-links", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/google/contact-links", "PUT", "Update Google contact links"),
);

export default router;
