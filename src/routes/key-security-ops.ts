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
// Staff-only proxy to key-service's security series
// (SECURITY-ALERTS-1128-CHART).
//
// key-service writes an append-only audit row for every secret read/write and
// every wrong-service-key request, and opens a security incident (mailed to
// staff once) on an unusual one. It serves the daily series + the recent
// incidents at GET /internal/security/daily?days=N (service key, no identity).
// Cross-org ops data: the gate is the platform API key AND a STAFF_EMAILS
// x-email (`authenticatePlatform` + `requireStaff`), like every `/ops/` read.
//
// Byte passthrough (`pipeExternalService`): the producer's status, content-type
// and body reach the caller unchanged, and the inbound query string is copied
// verbatim (a bad `days` is the producer's own 400). x-api-key for
// key-service is injected by the service client; x-email is forwarded for
// staff attribution. The series holds no key value or prefix.
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

// GET /v1/keys/ops/security-daily?days=30 — secret reads/writes, wrong-key requests
// and security incidents per UTC day, for dashboard v2 Monitoring (staff only).
router.get(
  "/keys/ops/security-daily",
  authenticatePlatform,
  requireStaff,
  async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(
        externalServices.key,
        `/internal/security/daily${rawQueryString(req.originalUrl)}`,
        { method: "GET", headers: staffHeaders(req), expressRes: res },
      );
    } catch (error: any) {
      console.error("[api-service] Staff key-service security-daily error:", error.message);
      if (res.headersSent) {
        res.end();
        return;
      }
      respondUpstreamError(res, error, "Failed to read the security series");
    }
  },
);

export default router;
