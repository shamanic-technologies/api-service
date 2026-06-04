import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// GET /v1/orgs/domains/traffic-history — Ahrefs traffic (latest snapshot + monthly organic series) for domains
router.get("/orgs/domains/traffic-history", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["domains"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.ahref,
      `/orgs/domains/traffic-history${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch traffic history" });
  }
});

// GET /v1/orgs/domains/dr-status — Ahrefs Domain Rating status for domains
router.get("/orgs/domains/dr-status", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["domains"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.ahref,
      `/orgs/domains/dr-status${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch DR status" });
  }
});

export default router;
