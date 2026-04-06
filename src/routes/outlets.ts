import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// ── GET /v1/outlets — list outlets with filters ─────────────────────────────
router.get("/outlets", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["campaignId", "brandId", "status", "runId", "limit", "offset", "featureSlugs", "featureDynastySlug"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.outlet,
      `/org/outlets${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list outlets" });
  }
});

// ── GET /v1/outlets/stats — aggregated outlet discovery metrics ─────────────
router.get("/outlets/stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["brandId", "campaignId", "workflowSlug", "workflowSlugs", "featureSlug", "featureSlugs", "workflowDynastySlug", "featureDynastySlug", "groupBy"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.outlet,
      `/org/outlets/stats${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get outlet stats" });
  }
});

// ── POST /v1/outlets — create outlet (upsert by outlet_url) ────────────────
router.post("/outlets", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.outlet,
      "/org/outlets",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.status(201).json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create outlet" });
  }
});

// ── POST /v1/outlets/bulk — bulk upsert outlets ─────────────────────────────
router.post("/outlets/bulk", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.outlet,
      "/org/outlets/bulk",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.status(201).json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to bulk create outlets" });
  }
});

// ── POST /v1/outlets/search — search outlets by name/url ────────────────────
router.post("/outlets/search", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.outlet,
      "/org/outlets/search",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to search outlets" });
  }
});

// ── POST /v1/outlets/discover — discover relevant outlets via Google + LLM ──
router.post("/outlets/discover", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.outlet,
      "/org/outlets/discover",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.status(201).json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to discover outlets" });
  }
});

// ── POST /v1/outlets/buffer/next — get next buffered outlet ──────────────────
router.post("/outlets/buffer/next", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.outlet,
      "/org/buffer/next",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get next buffered outlet" });
  }
});

// ── GET /v1/outlets/stats/costs — outlet discovery cost stats ────────────────
router.get("/outlets/stats/costs", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["brandId", "campaignId", "groupBy", "featureDynastySlug"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.outlet,
      `/org/outlets/stats/costs${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get outlet cost stats" });
  }
});

// ── GET /v1/outlets/:id — get outlet by ID ──────────────────────────────────
router.get("/outlets/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.outlet,
      `/org/outlets/${encodeURIComponent(req.params.id)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get outlet" });
  }
});

// ── PATCH /v1/outlets/:id — update outlet ───────────────────────────────────
router.patch("/outlets/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.outlet,
      `/org/outlets/${encodeURIComponent(req.params.id)}`,
      { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to update outlet" });
  }
});

// ── PATCH /v1/outlets/:id/status — update outlet status ─────────────────────
router.patch("/outlets/:id/status", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.campaignId) params.set("campaignId", req.query.campaignId as string);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.outlet,
      `/org/outlets/${encodeURIComponent(req.params.id)}/status${qs}`,
      { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to update outlet status" });
  }
});

export default router;
