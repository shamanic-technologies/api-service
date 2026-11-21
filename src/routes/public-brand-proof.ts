import { Router, Request, Response } from "express";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

/**
 * GET /v1/public/brand-proof?domain=<brand domain>|brandId=<uuid>
 * A brand's proof logos (BRAND-PROOF-LOGOS-1121): the companies where its paying
 * clients worked and the outlets that quoted it, ranked by notoriety, read by the
 * anonymous landing. Proxied to brand-service GET /public/brand-proof.
 *
 * Public at the producer, so public here: no identity of any kind. Status + body
 * piped byte-for-byte, query string verbatim (minScore, limit, minMonthlyTraffic
 * pass through untouched).
 */
router.get("/public/brand-proof", async (req: Request, res: Response) => {
  try {
    await pipeExternalService(externalServices.brand, `/public/brand-proof${rawQueryString(req.originalUrl)}`, { expressRes: res });
  } catch (error: any) {
    console.error("[api-service] Public brand proof error:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to get the brand proof logos");
  }
});

export default router;
