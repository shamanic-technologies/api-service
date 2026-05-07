import { Router, Request, Response } from "express";
import { callExternalService, externalServices } from "../lib/service-client.js";

const router = Router();

/**
 * GET /v1/costs/platform-prices
 * Public route, no auth. Pure pass-through to costs-service GET /v1/platform-prices.
 * Path matches the new proxy convention `/v1/{service-name}/{downstream-path}`.
 * Used by landing pages to render real-time refacturation unit costs.
 *
 * Fail-loud: any upstream failure returns 502 (never an empty array).
 */
router.get("/v1/costs/platform-prices", async (_req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.costs,
      "/v1/platform-prices",
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Costs platform-prices proxy error:", error.message);
    res.status(502).json({
      error: error.message || "Failed to fetch platform prices from costs-service",
    });
  }
});

export default router;
