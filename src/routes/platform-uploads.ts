import { Router } from "express";
import {
  authenticatePlatform,
  requireStaff,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { callExternalServiceWithStatus, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

// ---------------------------------------------------------------------------
// Platform uploads — transparent proxy to cloudflare-service
// POST /internal/upload/base64.
//
// A platform upload is OURS, not a customer org's: the first caller is the
// investor-update composer at admin.distribute.you, where staff pick an image
// off their machine and the composer needs a publicly-reachable https URL to
// put in the email it sends. The browser holds the bytes and only ever talks to
// this gateway, so without this route the bytes have nowhere to go.
//
// WHY THE INTERNAL DOWNSTREAM ROUTE — cloudflare-service exposes three uploads:
// `/upload` (downloads from a sourceUrl, org-scoped), `/upload/base64`
// (org-scoped, billed to the org, requires x-org-id / x-user-id / x-run-id) and
// `/internal/upload/base64` (service auth + `x-service-name` only, NO org, user
// or run — it opens a PLATFORM run and stores the file with a null org owner).
// The asset here belongs to the platform, so the internal route is the only one
// with the right ownership and the right cost home. Per CLAUDE.md rule #3 that
// downstream `/internal/*` path is NOT mounted as a client-facing path — the
// gateway calls it server-side and exposes its own `/v1/platform-uploads`.
//
// AUTH — `authenticatePlatform + requireStaff`, the tier CLAUDE.md prescribes
// for a pure platform op that must not be reachable by a customer. There is no
// org anywhere in this flow, so `requireOrg` would be gate theatre: the
// downstream route takes no org, and adding one would neither scope nor bill
// anything. `authenticatePlatform` alone is NOT enough — the platform key
// (ADMIN_DISTRIBUTE_API_KEY) is shared with the CUSTOMER dashboard's
// server-side proxy, so `authType === "admin"` is also true of ordinary
// customer traffic; `requireStaff` adds the signal that key cannot carry, a
// forwarded `x-email` in the hardcoded STAFF_EMAILS allowlist. A customer
// (Bearer user key → authType "user_key", or a non-allowlisted x-email) gets
// 403 and never reaches cloudflare-service.
//
// TRANSPARENT PASSTHROUGH (CLAUDE.md): no path rename beyond the mandated
// internal-tier hop (#1), no aggregation (#2), no body transform or field
// whitelist (#4) — `req.body` is forwarded as-is, so `contentBase64`, and the
// optional `folder` / `filename` / `contentType` cloudflare-service documents,
// arrive exactly as sent and a field added downstream later needs no change
// here. The response (`{ id, url, size, contentType }`) is owned by
// cloudflare-service (#8) and is returned untouched under its own status; `url`
// is the permanent public URL that renders in an `<img>` with no auth. Upstream
// failures go back through `respondUpstreamError` (#7 + corollary), so a 400
// "contentBase64 must be valid non-empty base64" or a 502 "Upload failed"
// reaches the composer with its `error` / `reason` fields intact.
//
// BODY SIZE — a ~5MB image is ~6.7MB once base64-encoded, which fits the
// gateway's global `express.json({ limit: "10mb" })`; cloudflare-service allows
// 100mb, so this gateway is the binding limit. Nothing is stored here.
// ---------------------------------------------------------------------------

/**
 * POST /v1/platform-uploads → cloudflare-service POST /internal/upload/base64
 *
 * `x-service-name` is the caller identity that route's `platformAuth` requires
 * (it 400s without one); it names the calling SERVICE, not a user, and is what
 * cloudflare-service logs and attributes its platform run to.
 */
router.post(
  "/platform-uploads",
  authenticatePlatform,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { status, data } = await callExternalServiceWithStatus(
        externalServices.cloudflare,
        "/internal/upload/base64",
        {
          method: "POST",
          body: req.body,
          headers: { "x-service-name": "api-service" },
        },
      );
      res.status(status).json(data);
    } catch (error: any) {
      console.error("[api-service] Platform upload error:", error);
      respondUpstreamError(res, error, "Failed to upload platform file");
    }
  },
);

export default router;
