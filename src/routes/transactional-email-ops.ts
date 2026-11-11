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
// Staff-only proxy to transactional-email-service's monitoring alerts
// (SIGNUP-EMAILS-1111-MONITORING).
//
// Owner rule: a monitoring alert is red on dashboard v2 Monitoring, never an
// email. transactional-email-service records the staff alerts it used to email
// (provider out of credits, campaign failing, trigger silent, domain
// blocklisted, newsletter halted...) and serves them at
// GET /internal/monitoring-alerts?days=N. Cross-org ops data, NOT customer data,
// so the gate is the same as `/v1/crm/ops/*` and `/v1/instantly/ops/*`: the
// platform API key AND a STAFF_EMAILS x-email (`authenticatePlatform` +
// `requireStaff`). No org context.
//
// Byte passthrough (`pipeExternalService`): the producer's status, content-type
// and body reach the caller unchanged, and the inbound query string is copied
// verbatim (a bad `days` is the producer's own 400). x-api-key for
// transactional-email-service is injected by the service client; x-email is
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

// GET /v1/transactional-email/ops/monitoring-alerts?days=30 — staff alerts recorded by
// transactional-email-service, for dashboard v2 Monitoring (staff only).
router.get(
  "/transactional-email/ops/monitoring-alerts",
  authenticatePlatform,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(
        externalServices.transactionalEmail,
        `/internal/monitoring-alerts${rawQueryString(req.originalUrl)}`,
        { method: "GET", headers: staffHeaders(req), expressRes: res },
      );
    } catch (error: any) {
      console.error("[api-service] Staff transactional-email monitoring-alerts error:", error.message);
      if (res.headersSent) {
        res.end();
        return;
      }
      respondUpstreamError(res, error, "Failed to read the monitoring alerts");
    }
  },
);

export default router;
