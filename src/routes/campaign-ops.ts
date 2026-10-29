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
// Staff-only proxies to campaign-service's fleet-wide ops reads
// (REACTIVE-THROUGHPUT-1028).
//
// The dashboard v2 Monitoring hub shows whether any prospect waits on a blocked
// reactive campaign answer. Cross-org ops data, NOT customer data: same gate as
// `/v1/crm/ops/*` (platform API key AND a STAFF_EMAILS x-email). No org context.
//
// Byte passthrough (`pipeExternalService`): campaign-service's status,
// content-type and body reach the caller unchanged, and the inbound query string
// is copied verbatim (a bad `days` is campaign-service's own 400).
//
// Mounted BEFORE the campaigns router so `/campaigns/ops/...` never reaches a
// `/campaigns/:id/...` handler.
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

function registerCampaignOps(suffix: string, label: string): void {
  router.get(`/campaigns/ops/${suffix}`, authenticatePlatform, requireStaff, async (req: AuthenticatedRequest, res) => {
    try {
      await pipeExternalService(
        externalServices.campaign,
        `/internal/ops/${suffix}${rawQueryString(req.originalUrl)}`,
        { method: "GET", headers: staffHeaders(req), expressRes: res },
      );
    } catch (error: any) {
      console.error(`[api-service] Staff campaign ops ${suffix} error:`, error.message);
      if (res.headersSent) {
        res.end();
        return;
      }
      respondUpstreamError(res, error, `Failed to ${label}`);
    }
  });
}

// GET /v1/campaigns/ops/stuck-occurrences?days=14 — prospects waiting on a blocked campaign answer: status ok|red,
// stuck counts by reason, the stuck occurrences, daily answered/answeredLate/skipped/failed/waiting (staff only).
registerCampaignOps("stuck-occurrences", "read the stuck campaign occurrences");

// GET /v1/campaigns/ops/trigger-health?days=14 — per watched trigger: verdict ok|red|unknown, reason, sentence,
// daily events + stored verdict; hub status red when any watched trigger is red (staff only,
// TRIGGER-SILENCE-NO-EMAIL-1028: replaces the trigger_silent staff email).
registerCampaignOps("trigger-health", "read the trigger health");

// GET /v1/campaigns/ops/plan-following?days=14 — funnel campaigns following their plan: status ok|red, staleReason,
// following count, the red list (a plan refused: no_plan, plan_unreadable, plan_outside_caps, apply_failed...),
// daily following/red/changesApplied (staff only, FACTORY-P1-PLAN-FOLLOWING-RELAY).
registerCampaignOps("plan-following", "read the plan following");

// GET /v1/campaigns/ops/unsent-answers?days=14 — answers owed to a person who acted that never left: status ok|red,
// the unsent list with refusal codes, daily answered/answeredByTeam/replaying/refused/failed (staff only,
// ONE-AI-REFUSED-ANSWERS-1029).
registerCampaignOps("unsent-answers", "read the unsent answers");

export default router;
