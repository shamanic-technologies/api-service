import { Router, Request, Response } from "express";
import { callExternalService, externalServices } from "../lib/service-client.js";

const router = Router();

/**
 * GET /v1/pricing/unit-costs
 * Public route, no auth. Proxied as-is to costs-service GET /v1/platform-prices.
 * Used by landing pages to render real-time refacturation unit costs.
 *
 * Fail-loud: any upstream failure returns 502 (never an empty array).
 */
router.get("/v1/pricing/unit-costs", async (_req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.costs,
      "/v1/platform-prices",
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Pricing unit-costs proxy error:", error.message);
    res.status(502).json({
      error: error.message || "Failed to fetch unit costs from costs-service",
    });
  }
});

export default router;
