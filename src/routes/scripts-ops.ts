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
// Staff-only proxy to workflow-service's Engines scripts monitoring series
// (FACTORY-P3).
//
// The dashboard v2 Monitoring hub charts the stored daily series of every
// outcome a stored "Engines" script makes (script path vs service path) plus the
// roll-back guard block. Cross-org ops data, NOT customer data: same gate as
// `/v1/campaigns/ops/*` (platform API key AND a STAFF_EMAILS x-email). No org
// context.
//
// Byte passthrough (`pipeExternalService`): workflow-service's status,
// content-type and body reach the caller unchanged, and the inbound query string
// is copied verbatim (a bad `days` is workflow-service's own 400).
//
// Mounted BEFORE the scripts router so `/scripts/ops/...` never reaches a
// `/scripts/...` customer handler.
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

// GET /v1/scripts/ops/monitoring?days=14 — per Engines script outcome: daily script path vs service path series,
// plus the roll-back guard block (staff only, FACTORY-P3).
router.get("/scripts/ops/monitoring", authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.workflow,
      `/internal/scripts/monitoring${rawQueryString(req.originalUrl)}`,
      { method: "GET", headers: staffHeaders(req), expressRes: res },
    );
  } catch (error: any) {
    console.error("[api-service] Staff scripts ops monitoring error:", error.message);
    if (res.headersSent) {
      res.end();
      return;
    }
    respondUpstreamError(res, error, "Failed to read the scripts monitoring");
  }
});

export default router;
