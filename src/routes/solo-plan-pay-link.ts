import { Router, type Request, type Response } from "express";
import { relayExternalPage, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// The solo-founder plan's PAY LINK (SOLO-PLAN-1125, billing-service #907): one signed token
// per org, opened from WhatsApp, an email or an AI chat with no login. billing-service serves
// the page at `GET /public/solo-plan/pay/:token` and its one button posts a form to
// `POST /public/solo-plan/pay/:token`, answered by a 303 with a RELATIVE Location (`<token>`
// or `<token>?done=...`, or Stripe's absolute checkout URL).
//
// Public URL: https://api.distribute.you/v1/billing/public/solo-plan/pay/<token>
// (billing's SOLO_PLAN_PUBLIC_BASE_URL = https://api.distribute.you/v1/billing).
//
// NO middleware: the token is the auth (rule #3, public tier). No identity header is sent.
// Relayed byte for byte with `relayExternalPage`: HTML out, the form body in under its own
// Content-Type, every status (billing's 404 "link expired" page included) and the 303 +
// Location untouched. The global express.json reads only application/json, so the form body
// reaches here unread; never add express.urlencoded to these routes.
const router = Router();

const PAY_PREFIX = "/v1/billing/public/solo-plan/pay";

function relay(method: "GET" | "POST") {
  return async (req: Request, res: Response) => {
    const token = encodeURIComponent(req.params.token);
    const q = req.originalUrl.indexOf("?");
    const query = q === -1 ? "" : req.originalUrl.slice(q);
    try {
      await relayExternalPage(externalServices.billing, `/public/solo-plan/pay/${token}${query}`, {
        method,
        expressReq: req,
        expressRes: res,
      });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      respondUpstreamError(res, error, "Failed to open the pay page");
    }
  };
}

router.get(`${PAY_PREFIX}/:token`, relay("GET"));
router.post(`${PAY_PREFIX}/:token`, relay("POST"));

export default router;
