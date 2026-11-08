import { Router, Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * Transparent proxy of social-service's org-scoped brand surface (`/orgs/social/*`), the X/LinkedIn twin of the Threads
 * publish (`routes/threads.ts`): a brand's connected X / LinkedIn accounts, what was published on them, ONE post on one
 * of them (with its X reply / LinkedIn first comment), and the industry news items kept for the brand (its « Industry
 * news found » Units). Callers: the dashboard, an agent with the org's key, and our own morning brief / hand posts with
 * the staff key (INDUSTRY-NEWS-ENGINE-1108).
 *
 * Gateway path = social-service path prefixed with `/v1`. Nothing renamed, no body transform, the inbound query string
 * byte-copied off `req.originalUrl` (rule #11; `brandId` / `campaignId` also ride it and `buildInternalHeaders` promotes
 * them to `x-brand-id` / `x-campaign-id`: a hand post names its campaign so its Unit and its fee land on it), upstream
 * STATUS and body relayed (`pipeExternalService`): 400 `validation` / `outcome_mismatch`, 402 `insufficient_balance`
 * (the campaign's max budget), 409 `account_not_pro_ai` / `needs_reconnect` / `idempotency_conflict`, 502 network refusals.
 *
 * Auth tier: `authenticate + requireOrg + requireUser`; identity reaches social-service only through
 * `buildInternalHeaders`. NOT proxied: the scan door `POST /orgs/social/industry-news/scans` (a campaign script's run calls
 * it through workflow-service) and every `/internal/*` route.
 */
const router = Router();

const orgUserChain = [authenticate, requireOrg, requireUser] as const;

function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

async function forward(req: AuthenticatedRequest, res: Response, path: string, method: "GET" | "POST", label: string): Promise<void> {
  try {
    await pipeExternalService(externalServices.social, `${path}${rawQueryString(req.originalUrl)}`, {
      method,
      body: method === "POST" ? req.body : undefined,
      headers: buildInternalHeaders(req),
      expressRes: res,
    });
  } catch (error) {
    console.error(`[api-service] ${label} error:`, error);
    if (res.headersSent) {
      res.end();
      return;
    }
    respondUpstreamError(res, error, `${label} error`);
  }
}

// GET /v1/orgs/social/accounts?brandId&network → social-service GET /orgs/social/accounts
router.get("/orgs/social/accounts", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/social/accounts", "GET", "List brand social accounts"),
);

// GET /v1/orgs/social/publications?brandId&network&since → social-service GET /orgs/social/publications
router.get("/orgs/social/publications", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/social/publications", "GET", "List brand social publications"),
);

// POST /v1/orgs/social/accounts/:id/posts → social-service POST /orgs/social/accounts/:id/posts
router.post("/orgs/social/accounts/:id/posts", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, `/orgs/social/accounts/${encodeURIComponent(req.params.id)}/posts`, "POST", "Publish on a brand social account"),
);

// GET /v1/orgs/social/industry-news?brandId&since&limit → social-service GET /orgs/social/industry-news
router.get("/orgs/social/industry-news", ...orgUserChain, (req: AuthenticatedRequest, res) =>
  forward(req, res, "/orgs/social/industry-news", "GET", "List industry news items"),
);

export default router;
