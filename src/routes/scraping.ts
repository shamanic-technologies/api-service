import { Router } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * POST /v1/scraping/scrape
 * Transparent proxy to scraping-service POST /scrape
 */
router.post("/scraping/scrape", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.scraping,
      "/scrape",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: req.body,
      }
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Scrape error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to scrape" });
  }
});

/**
 * GET /v1/scraping/scrape/by-url
 * Transparent proxy to scraping-service GET /scrape/by-url
 */
router.get("/scraping/scrape/by-url", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const url = req.query.url as string;

    if (!url) {
      return res.status(400).json({ error: "url query param is required" });
    }

    const params = new URLSearchParams({ url });

    const result = await callExternalService(
      externalServices.scraping,
      `/scrape/by-url?${params}`,
      { headers: buildInternalHeaders(req) },
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Scrape by-url error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get scrape result" });
  }
});

/**
 * GET /v1/scraping/scrape/:id
 * Transparent proxy to scraping-service GET /scrape/:id
 */
router.get("/scraping/scrape/:id", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.scraping,
      `/scrape/${req.params.id}`,
      { headers: buildInternalHeaders(req) },
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get scrape result error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get scrape result" });
  }
});

export default router;
