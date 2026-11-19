import { Router } from "express";
import {
  authenticatePlatform,
  requireStaff,
  AuthenticatedRequest,
} from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

// ---------------------------------------------------------------------------
// Staff-only proxy to apollo-service's daily email-sources series
// (APOLLO-ZERO-COST-1119).
//
// Owner rule 2026-11-19: Apollo's PAID reveal is the last resort. apollo-service
// counts, per UTC day, where each served email came from (our stock, a format
// guess, treg, an Apollo reveal) plus the free people found, and serves it at
// GET /internal/stats/email-sources/daily?days=N. Cross-org ops data, NOT customer data,
// so the gate is the same as `/v1/crm/ops/*` and `/v1/instantly/ops/*`: the
// platform API key AND a STAFF_EMAILS x-email (`authenticatePlatform` +
// `requireStaff`). No org context.
//
// Byte passthrough (`pipeExternalService`): the producer's status, content-type
// and body reach the caller unchanged, and the inbound query string is copied
// verbatim (a bad `days` is the producer's own 400). x-api-key for
// apollo-service is injected by the service client; x-email is
// forwarded for staff attribution.
// ---------------------------------------------------------------------------

function staffHeaders(req: AuthenticatedRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  if (req.staffEmail) headers["x-email"] = req.staffEmail;
  return headers;
}

function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

// GET /v1/apollo/ops/email-sources/daily?days=30 — emails found per day by path,
// for dashboard v2 Monitoring > Email sources (staff only).
router.get(
  "/apollo/ops/email-sources/daily",
  authenticatePlatform,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(
        externalServices.apollo,
        `/internal/stats/email-sources/daily${rawQueryString(req.originalUrl)}`,
        { method: "GET", headers: staffHeaders(req), expressRes: res },
      );
    } catch (error: any) {
      console.error("[api-service] Staff apollo email-sources error:", error.message);
      if (res.headersSent) {
        res.end();
        return;
      }
      respondUpstreamError(res, error, "Failed to read the email sources");
    }
  },
);

export default router;
