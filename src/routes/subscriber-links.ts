import { Router, Request, Response, NextFunction } from "express";
import { authenticatePlatform } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

// ---------------------------------------------------------------------------
// GET /v1/subscriber-links/:linkId → transactional-email-service
// GET /internal/subscriber-links/:linkId (NEWSLETTER-WHO-CLICKED-1024).
//
// Every distribute.you link in a mailing-list send carries `dy_sub=<linkId>`.
// Our landing and dashboard SERVERS ask this route who that id names, so the
// visit and the onboarding that follows are tied to the subscriber.
//
// The answer carries a subscriber's EMAIL, so it is a server-to-server read:
//
//  1. `authenticatePlatform`: the platform key (ADMIN_DISTRIBUTE_API_KEY) only.
//     A user key (Bearer) or no key is 401.
//  2. `refuseForwardedIdentity`: the platform key is ALSO held by the customer
//     dashboard's generic `/api/v1/*` proxy (and the anonymous `/api/anon/v1/*`
//     one, the admin one), which forward browser traffic. Every one of those
//     proxies stamps the session's identity on the request
//     (`x-external-org-id` + `x-external-user-id`; the anon proxy its anon org),
//     and none can drop it. A server asking this question has no visitor
//     identity to send. So any identity header on the request means it came
//     through a browser-facing proxy, and it is refused 403 before the
//     downstream call: a signed-in customer cannot read a subscriber's email by
//     calling `/api/v1/subscriber-links/<id>` from the dashboard.
//
// PASSTHROUGH: the producer answers valid 200 / tampered 400 / unknown 404 /
// revoked 410, each with its own body (`status` + subscriber when valid). The
// 2xx is piped byte-identical; a non-2xx is re-emitted field-for-field under
// its own status by `respondUpstreamError` (rule #7). No identity headers go
// downstream: the producer takes the service key only.
// ---------------------------------------------------------------------------

/** Headers a browser-facing proxy stamps; a server-to-server caller sends none. */
export const FORWARDED_IDENTITY_HEADERS = [
  "x-external-org-id",
  "x-external-user-id",
  "x-org-id",
  "x-user-id",
  "x-email",
  "authorization",
] as const;

export function refuseForwardedIdentity(req: Request, res: Response, next: NextFunction) {
  const carried = FORWARDED_IDENTITY_HEADERS.filter((h) => req.headers[h] !== undefined);
  if (carried.length > 0) {
    return res.status(403).json({
      error:
        "Subscriber links resolve server-to-server only: this request carries a user or org identity, " +
        "so it came through a browser-facing proxy.",
      code: "server_to_server_only",
      headers: carried,
    });
  }
  return next();
}

router.get(
  "/subscriber-links/:linkId",
  authenticatePlatform,
  refuseForwardedIdentity,
  async (req: Request, res: Response) => {
    try {
      await pipeExternalService(
        externalServices.transactionalEmail,
        `/internal/subscriber-links/${encodeURIComponent(req.params.linkId)}`,
        { expressRes: res },
      );
    } catch (error) {
      respondUpstreamError(res, error, "Failed to resolve subscriber link");
    }
  },
);

export default router;
