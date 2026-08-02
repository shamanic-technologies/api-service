import { Router } from "express";
import {
  authenticate,
  requireOrg,
  requireStaff,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

// ---------------------------------------------------------------------------
// Staff mailing lists — transparent proxies to transactional-email-service
// /mailing-lists/:slug/{subscribers,updates} (its PR #114).
//
// A mailing list is a platform-level (org-less) list of bare email addresses —
// "investors" is the first one — that staff read, add to, prune, and mail a
// written update to from the staff console at admin.distribute.you. The browser
// only ever talks to this gateway, so without these routes the whole surface is
// unreachable.
//
// AUTH — `authenticate + requireOrg + requireStaff`, the same tier as the
// per-org usage-discount mutations (src/routes/usage-discount.ts) and the
// credit-grant routes (src/routes/credits.ts). Three reasons this exact chain,
// and not `authenticatePlatform + requireStaff`:
//
//   1. `authenticatePlatform` alone is NOT a staff gate — the platform key
//      (ADMIN_DISTRIBUTE_API_KEY) is shared with the CUSTOMER dashboard's
//      server-side proxy, so `authType === "admin"` is true for ordinary
//      customer traffic. `requireStaff` adds the signal the shared key cannot
//      carry: a forwarded `x-email` in the hardcoded STAFF_EMAILS allowlist.
//   2. The downstream routes need real identity on the wire. Probing the
//      DEPLOYED staging service (2026-08-02) shows they reject a call with no
//      `x-org-id` (400 "Missing required header: x-org-id") AND, once that is
//      supplied, a call with no `x-user-id` (400 "Missing required header:
//      x-user-id — mailing-list operations act as a staff user"). The
//      x-user-id requirement is NOT in the published OpenAPI parameter list, so
//      only the live probe surfaces it. `authenticatePlatform` resolves neither,
//      and would 400 on every request; `authenticate + requireOrg` resolves the
//      caller's real org AND user, which `buildInternalHeaders` then forwards.
//      The org is the CALLER's, never one the caller names — a caller-supplied
//      `x-org-id` / `?orgId` is ignored, because `authenticate` overwrites
//      `req.orgId` from the resolved identity.
//   3. The lists themselves are platform-level, so the org is identity, not
//      scope: it says WHO is asking, not WHICH list is readable. That is exactly
//      why the staff allowlist — not the org — is what actually gates access.
//
// A customer (Bearer user key → authType "user_key", or a non-allowlisted
// x-email) gets 403 and never reaches transactional-email-service.
//
// TRANSPARENT PASSTHROUGH (CLAUDE.md): no path rename (#1), no aggregation (#2),
// no body transform or field whitelist (#4) — `req.body` is forwarded as-is and
// the raw query string byte-for-byte, so a field or param added downstream later
// arrives at the caller with zero change here. Responses are owned by
// transactional-email-service (#8) and never reshaped. Upstream failures go back
// through `respondUpstreamError` (#7 + corollary), which re-emits the upstream
// JSON object field-for-field under the upstream status — so a downstream 404
// "no such list" or 502 "provider suppression state unavailable" reaches the
// staff console with its own `error` / `code` / `details` intact, instead of the
// whole body being stringified into one `error` message.
// ---------------------------------------------------------------------------

/**
 * Identity headers for the downstream call, plus the verified staff email.
 *
 * `buildInternalHeaders` supplies `x-org-id` (what the downstream's
 * `requireOrgIdOnly` checks), `x-user-id` and `x-run-id`. `x-email` is the
 * normalized address `requireStaff` matched against the allowlist — forwarded so
 * transactional-email-service can attribute who sent an update.
 */
function staffHeaders(req: AuthenticatedRequest): Record<string, string> {
  const headers = buildInternalHeaders(req);
  if (req.staffEmail) headers["x-email"] = req.staffEmail;
  return headers;
}

/**
 * The inbound query string, verbatim, including the leading `?` (empty when
 * there is none).
 *
 * Read off `req.originalUrl` rather than re-serialized from `req.query` on
 * purpose: re-serializing imposes this gateway's opinion on repeated keys,
 * ordering and encoding, and silently drops anything the gateway does not know
 * about. Byte-copying the raw string is what makes "a param added downstream
 * later needs no change here" true — `?email=` on the DELETE is simply the only
 * one that exists today.
 */
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

/** Downstream path for a list's subresource, with the slug percent-encoded. */
function downstreamPath(
  req: AuthenticatedRequest,
  subresource: "subscribers" | "updates",
): string {
  const slug = encodeURIComponent(req.params.slug);
  return `/mailing-lists/${slug}/${subresource}${rawQueryString(req.originalUrl)}`;
}

// GET /v1/mailing-lists/:slug/subscribers — read a list's members (staff only).
// Proxies transactional-email-service GET /mailing-lists/{slug}/subscribers. Each
// member states whether the provider is currently suppressing it; that opt-out
// state is read live from Postmark downstream and is not stored anywhere here.
router.get(
  "/mailing-lists/:slug/subscribers",
  authenticate,
  requireOrg,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.transactionalEmail,
        downstreamPath(req, "subscribers"),
        { headers: staffHeaders(req) },
      );
      res.json(result);
    } catch (error) {
      respondUpstreamError(res, error, "Failed to read mailing list subscribers");
    }
  },
);

// POST /v1/mailing-lists/:slug/subscribers — add addresses in bulk (staff only).
// Proxies transactional-email-service POST /mailing-lists/{slug}/subscribers. The
// body is forwarded as-is: downstream parses the pasted blob and owns what counts
// as added / skipped / rejected. The gateway validates nothing.
router.post(
  "/mailing-lists/:slug/subscribers",
  authenticate,
  requireOrg,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.transactionalEmail,
        downstreamPath(req, "subscribers"),
        { method: "POST", body: req.body, headers: staffHeaders(req) },
      );
      res.json(result);
    } catch (error) {
      respondUpstreamError(res, error, "Failed to add mailing list subscribers");
    }
  },
);

// DELETE /v1/mailing-lists/:slug/subscribers?email=... — remove one address (staff only).
// Proxies transactional-email-service DELETE /mailing-lists/{slug}/subscribers. The
// query string is forwarded byte-for-byte, so `email` reaches downstream exactly as
// the caller sent it and downstream owns whether it is well-formed.
router.delete(
  "/mailing-lists/:slug/subscribers",
  authenticate,
  requireOrg,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.transactionalEmail,
        downstreamPath(req, "subscribers"),
        { method: "DELETE", headers: staffHeaders(req) },
      );
      res.json(result);
    } catch (error) {
      respondUpstreamError(res, error, "Failed to remove mailing list subscriber");
    }
  },
);

// POST /v1/mailing-lists/updates/preview — render a draft as a recipient will
// see it, without sending it (staff only). Proxies transactional-email-service
// POST /mailing-lists/updates/preview.
//
// Deliberately carries NO slug: downstream takes none, because a body renders
// identically whoever receives it. That is also why this cannot collide with
// `/mailing-lists/:slug/updates` above — both are three segments, and the third
// is a different literal, so neither pattern can swallow the other.
router.post(
  "/mailing-lists/updates/preview",
  authenticate,
  requireOrg,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.transactionalEmail,
        `/mailing-lists/updates/preview${rawQueryString(req.originalUrl)}`,
        { method: "POST", body: req.body, headers: staffHeaders(req) },
      );
      res.json(result);
    } catch (error) {
      respondUpstreamError(res, error, "Failed to render the mailing list update preview");
    }
  },
);

// POST /v1/mailing-lists/:slug/updates — send a written update to a list (staff only).
// Proxies transactional-email-service POST /mailing-lists/{slug}/updates. Body
// forwarded as-is; downstream renders the markdown, sends one message per recipient,
// skips members the provider is suppressing, and reports a partial failure as
// `partial` rather than a clean success.
router.post(
  "/mailing-lists/:slug/updates",
  authenticate,
  requireOrg,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.transactionalEmail,
        downstreamPath(req, "updates"),
        { method: "POST", body: req.body, headers: staffHeaders(req) },
      );
      res.json(result);
    } catch (error) {
      respondUpstreamError(res, error, "Failed to send mailing list update");
    }
  },
);

// GET /v1/mailing-lists/:slug/updates — read the updates already sent (staff only).
// Proxies transactional-email-service GET /mailing-lists/{slug}/updates.
router.get(
  "/mailing-lists/:slug/updates",
  authenticate,
  requireOrg,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.transactionalEmail,
        downstreamPath(req, "updates"),
        { headers: staffHeaders(req) },
      );
      res.json(result);
    } catch (error) {
      respondUpstreamError(res, error, "Failed to read mailing list updates");
    }
  },
);

export default router;
