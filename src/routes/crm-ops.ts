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
// Staff-only proxies to crm-service's fleet-wide ops reads (WA-LINE-HEALTH-1023).
//
// The dashboard v2 Monitoring hub charts every linked WhatsApp line's
// connection state per day. That is cross-org ops data, NOT customer data, so
// these routes use the same gate as `/v1/instantly/ops/*`: the platform API key
// AND a STAFF_EMAILS x-email (`authenticatePlatform` + `requireStaff`). No org
// context, never mounted on an org-scoped path.
//
// Byte passthrough (`pipeExternalService`): crm-service's status, content-type
// and body reach the caller unchanged, and the inbound query string is copied
// verbatim (a bad `days` is crm-service's own 400). x-api-key for crm-service is
// injected by the service client; x-email is forwarded for staff attribution.
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

function registerCrmOps(method: "GET" | "POST", suffix: string, label: string): void {
  const handler = async (req: AuthenticatedRequest, res: import("express").Response) => {
    try {
      await pipeExternalService(
        externalServices.crm,
        `/internal/ops/${suffix}${rawQueryString(req.originalUrl)}`,
        {
          method,
          body: method === "POST" ? req.body : undefined,
          headers: staffHeaders(req),
          expressRes: res,
        },
      );
    } catch (error: any) {
      console.error(`[api-service] Staff crm ops ${suffix} error:`, error.message);
      if (res.headersSent) {
        res.end();
        return;
      }
      respondUpstreamError(res, error, `Failed to ${label}`);
    }
  };
  const path = `/crm/ops/${suffix}`;
  if (method === "GET") router.get(path, authenticatePlatform, requireStaff, handler);
  else router.post(path, authenticatePlatform, requireStaff, handler);
}

// GET /v1/crm/ops/whatsapp-lines?days=30 — every linked WhatsApp line, its state now + daily series (staff only).
registerCrmOps("GET", "whatsapp-lines", "read the WhatsApp line health");
// POST /v1/crm/ops/whatsapp-lines/check — run one WhatsApp line watch pass now (staff only).
registerCrmOps("POST", "whatsapp-lines/check", "run the WhatsApp line check");
// GET /v1/crm/ops/trigger-reports?days=30 — per trigger: did the people it reported reach their campaign? (staff only,
// TRIGGER-REPORTS-MONITORING-1027). Status ok|red, stuck counts by reason, stuck reports, daily sent/skipped/notSent.
registerCrmOps("GET", "trigger-reports", "read the trigger report health");
// GET /v1/crm/ops/connector-intake?days=30 — per connected tool (GoHighLevel, PostHog, Stripe, Clerk): records taken in
// per day, quiet days vs usual, status ok|red|paused (staff only, CONNECTOR-INTAKE-MONITORING-1028).
registerCrmOps("GET", "connector-intake", "read the connector intake health");

export default router;
