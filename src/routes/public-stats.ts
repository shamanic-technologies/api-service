import { Router, Request, Response } from "express";
import { callExternalService, externalServices } from "../lib/service-client.js";

const router = Router();

/**
 * GET /public/stats/users
 * Public user/org stats. Proxied to client-service GET /public/stats/users.
 */
router.get("/public/stats/users", async (_req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.client,
      "/public/stats/users",
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public stats users error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public user stats" });
  }
});

/**
 * GET /public/stats/billing
 * Public billing stats. Proxied to billing-service GET /public/stats/billing.
 */
router.get("/public/stats/billing", async (_req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.billing,
      "/public/stats/billing",
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public stats billing error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public billing stats" });
  }
});

/**
 * GET /public/stats/runs
 * Public run stats. Proxied to runs-service GET /public/stats/runs.
 */
router.get("/public/stats/runs", async (_req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.runs,
      "/public/stats/runs",
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Public stats runs error:", error.message);
    res.status(error.statusCode || 502).json({ error: error.message || "Failed to get public run stats" });
  }
});

export default router;
