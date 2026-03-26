import { Router, Request, Response } from "express";
import { authenticate, requireOrg, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// ── Public routes (no auth) ─────────────────────────────────────────────────

// GET /press-kits/public/:token — public press kit by share token
router.get("/press-kits/public/:token", async (req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/public/${encodeURIComponent(req.params.token)}`
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get public press kit" });
  }
});

// ── Authenticated routes (mounted at /v1) ────────────────────────────────────

// GET /v1/press-kits/organizations/exists — batch check existence
router.get("/press-kits/organizations/exists", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const qs = req.query.orgIds ? `?orgIds=${encodeURIComponent(req.query.orgIds as string)}` : "";
    const result = await callExternalService(
      externalServices.pressKits,
      `/organizations/exists${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to check organizations" });
  }
});

// GET /v1/press-kits/media-kits — list media kits
router.get("/press-kits/media-kits", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.org_id) params.set("org_id", req.query.org_id as string);
    if (req.query.organization_id) params.set("organization_id", req.query.organization_id as string);
    if (req.query.campaign_id) params.set("campaign_id", req.query.campaign_id as string);
    if (req.query.title) params.set("title", req.query.title as string);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.pressKits,
      `/media-kits${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list media kits" });
  }
});

// GET /v1/press-kits/media-kits/:id — get media kit by ID
router.get("/press-kits/media-kits/:id", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/media-kits/${encodeURIComponent(req.params.id)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get media kit" });
  }
});

// POST /v1/press-kits/media-kits — create or edit media kit (idempotent)
router.post("/press-kits/media-kits", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/media-kits",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create/edit media kit" });
  }
});

// PATCH /v1/press-kits/media-kits/:id/mdx — update MDX content
router.patch("/press-kits/media-kits/:id/mdx", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/media-kits/${encodeURIComponent(req.params.id)}/mdx`,
      { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to update MDX" });
  }
});

// PATCH /v1/press-kits/media-kits/:id/status — update media kit status
router.patch("/press-kits/media-kits/:id/status", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/media-kits/${encodeURIComponent(req.params.id)}/status`,
      { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to update status" });
  }
});

// POST /v1/press-kits/media-kits/:id/validate — validate media kit
router.post("/press-kits/media-kits/:id/validate", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/media-kits/${encodeURIComponent(req.params.id)}/validate`,
      { method: "POST", headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to validate media kit" });
  }
});

// POST /v1/press-kits/media-kits/:id/cancel — cancel draft media kit
router.post("/press-kits/media-kits/:id/cancel", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/media-kits/${encodeURIComponent(req.params.id)}/cancel`,
      { method: "POST", headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to cancel draft" });
  }
});

// ── Admin routes (authenticated) ─────────────────────────────────────────────

// GET /v1/press-kits/admin/organizations — list orgs with kit counts
router.get("/press-kits/admin/organizations", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const qs = req.query.search ? `?search=${encodeURIComponent(req.query.search as string)}` : "";
    const result = await callExternalService(
      externalServices.pressKits,
      `/admin/organizations${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list admin organizations" });
  }
});

// DELETE /v1/press-kits/admin/organizations/:id — delete organization
router.delete("/press-kits/admin/organizations/:id", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const qs = req.query.confirmName ? `?confirmName=${encodeURIComponent(req.query.confirmName as string)}` : "";
    const result = await callExternalService(
      externalServices.pressKits,
      `/admin/organizations/${encodeURIComponent(req.params.id)}${qs}`,
      { method: "DELETE", headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to delete organization" });
  }
});

// ── Internal routes (authenticated, service-to-service) ──────────────────────

// GET /v1/press-kits/internal/media-kits/current — latest kit for org (uses x-org-id header)
router.get("/press-kits/internal/media-kits/current", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/internal/media-kits/current",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get current media kit" });
  }
});

// GET /v1/press-kits/internal/media-kits/generation-data — generation workflow data (uses x-org-id header)
router.get("/press-kits/internal/media-kits/generation-data", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/internal/media-kits/generation-data",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get generation data" });
  }
});

// POST /v1/press-kits/internal/media-kits/generation-result — workflow callback
router.post("/press-kits/internal/media-kits/generation-result", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/internal/media-kits/generation-result",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to upsert generation result" });
  }
});

// GET /v1/press-kits/internal/media-kits/stale — orgs with stale kits
router.get("/press-kits/internal/media-kits/stale", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/internal/media-kits/stale",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get stale kits" });
  }
});

// GET /v1/press-kits/internal/media-kits/setup — setup status for all orgs
router.get("/press-kits/internal/media-kits/setup", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/internal/media-kits/setup",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get setup status" });
  }
});

// GET /v1/press-kits/internal/health/bulk — bulk health per org
router.get("/press-kits/internal/health/bulk", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/internal/health/bulk",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get bulk health" });
  }
});

// GET /v1/press-kits/internal/email-data/:orgId — email template data
router.get("/press-kits/internal/email-data/:orgId", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/internal/email-data/${encodeURIComponent(req.params.orgId)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get email data" });
  }
});

export default router;
