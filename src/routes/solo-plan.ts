import { Router, type Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// The SOLO-FOUNDER plan (SOLO-PLAN-1125): a founder drives distribute.you from their own AI through
// the MCP, with their own user key. billing-service owns the plan, its amounts and its refusals; this
// router is five byte pipes to its customer routes `/v1/accounts/solo_plan*`, mounted under the
// gateway's billing namespace (`/v1/billing/accounts/solo_plan*`, like prepaid_checkout).
//
// Gate: `authenticate + requireOrg + requireUser` (billing's `requireOrgHeaders` needs org + user);
// org + user come from the authenticated identity (`buildInternalHeaders`), never from the body.
// No body transform, no default (billing 400s a hosted start with no `return_url`), status + body
// verbatim both ways (200/400/404 `not_enrolled`/409/502 included). Billing's `/internal/accounts/
// by-org/:orgId/solo-plan*` routes stay unproxied (rule #3).
const router = Router();

async function pipe(req: AuthenticatedRequest, res: Response, method: "GET" | "POST", downstream: string, fallback: string) {
  try {
    await pipeExternalService(externalServices.billing, downstream, {
      method,
      body: method === "GET" ? undefined : (req.body ?? {}),
      headers: buildInternalHeaders(req),
      expressRes: res,
    });
  } catch (error: any) {
    console.error(`[api-service] ${fallback}: status ${error?.statusCode ?? "none"}`);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, fallback);
  }
}

const gate = [authenticate, requireOrg, requireUser] as const;

/** GET → billing GET /v1/accounts/solo_plan: the plan state (settles first). */
router.get("/v1/billing/accounts/solo_plan", ...gate, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "GET", "/v1/accounts/solo_plan", "Failed to read the solo-founder plan"),
);

/** POST → billing POST /v1/accounts/solo_plan/enroll: put the account on the plan (free state). */
router.post("/v1/billing/accounts/solo_plan/enroll", ...gate, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", "/v1/accounts/solo_plan/enroll", "Failed to enrol the account on the solo-founder plan"),
);

/** POST → billing POST /v1/accounts/solo_plan/start: the checkout link, or the trial at once. */
router.post("/v1/billing/accounts/solo_plan/start", ...gate, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", "/v1/accounts/solo_plan/start", "Failed to start the solo-founder plan"),
);

/** POST → billing POST /v1/accounts/solo_plan/start_now: end the trial, pay the first month today. */
router.post("/v1/billing/accounts/solo_plan/start_now", ...gate, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", "/v1/accounts/solo_plan/start_now", "Failed to start the paid plan now"),
);

/** POST → billing POST /v1/accounts/solo_plan/layers: +$100/month, charged now. */
router.post("/v1/billing/accounts/solo_plan/layers", ...gate, (req: AuthenticatedRequest, res) =>
  pipe(req, res, "POST", "/v1/accounts/solo_plan/layers", "Failed to add budget to the plan"),
);

export default router;
