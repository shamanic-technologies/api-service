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

// GET /v1/orgs/domains/ai-visibility — read-only cached Brand-Radar AI-visibility snapshot for domains (no scrape, no cost)
router.get("/orgs/domains/ai-visibility", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["domains"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.ahref,
      `/orgs/domains/ai-visibility${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch AI-visibility cache" });
  }
});

// POST /v1/orgs/domains/traffic-compute — on-demand Ahrefs traffic scrape (ahref-service declares cost + authorizes)
router.post("/orgs/domains/traffic-compute", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.ahref,
      `/orgs/domains/traffic-compute`,
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to compute traffic" });
  }
});

// POST /v1/orgs/domains/dr-compute — on-demand Ahrefs DR scrape (ahref-service declares cost + authorizes)
router.post("/orgs/domains/dr-compute", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.ahref,
      `/orgs/domains/dr-compute`,
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to compute DR" });
  }
});

// POST /v1/orgs/domains/ai-visibility — get-or-refresh Ahrefs Brand-Radar AI-visibility stats for a domain (ahref-service declares cost + authorizes on scrape)
router.post("/orgs/domains/ai-visibility", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.ahref,
      `/orgs/domains/ai-visibility`,
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch AI-visibility stats" });
  }
});

export default router;
