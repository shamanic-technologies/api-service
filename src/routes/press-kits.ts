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

// GET /press-kits/public-media-kit/:token — public media kit (legacy)
router.get("/press-kits/public-media-kit/:token", async (req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/public-media-kit/${encodeURIComponent(req.params.token)}`
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get public media kit" });
  }
});

// GET /press-kits/email-data/press-kit/:orgId — email template data
router.get("/press-kits/email-data/press-kit/:orgId", async (req: Request, res: Response) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/email-data/press-kit/${encodeURIComponent(req.params.orgId)}`
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get email data" });
  }
});

// ── Authenticated routes (mounted at /v1) ────────────────────────────────────

// POST /v1/press-kits/organizations — upsert organization
router.post("/press-kits/organizations", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/organizations",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to upsert organization" });
  }
});

// GET /v1/press-kits/organizations/share-token/:orgId — get share token
router.get("/press-kits/organizations/share-token/:orgId", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/organizations/share-token/${encodeURIComponent(req.params.orgId)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get share token" });
  }
});

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

// GET /v1/press-kits/media-kit — list media kits
router.get("/press-kits/media-kit", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.org_id) params.set("org_id", req.query.org_id as string);
    if (req.query.organization_id) params.set("organization_id", req.query.organization_id as string);
    if (req.query.title) params.set("title", req.query.title as string);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.pressKits,
      `/media-kit${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list media kits" });
  }
});

// GET /v1/press-kits/media-kit/:id — get media kit by ID
router.get("/press-kits/media-kit/:id", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/media-kit/${encodeURIComponent(req.params.id)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get media kit" });
  }
});

// POST /v1/press-kits/edit-media-kit — initiate media kit generation
router.post("/press-kits/edit-media-kit", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/edit-media-kit",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to edit media kit" });
  }
});

// POST /v1/press-kits/update-mdx — update MDX content
router.post("/press-kits/update-mdx", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/update-mdx",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to update MDX" });
  }
});

// POST /v1/press-kits/update-status — update media kit status
router.post("/press-kits/update-status", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/update-status",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to update status" });
  }
});

// POST /v1/press-kits/validate — validate media kit
router.post("/press-kits/validate", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/validate",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to validate media kit" });
  }
});

// POST /v1/press-kits/cancel-draft — cancel draft media kit
router.post("/press-kits/cancel-draft", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/cancel-draft",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
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

// GET /v1/press-kits/internal/media-kit/by-org/:orgId — latest kit by org
router.get("/press-kits/internal/media-kit/by-org/:orgId", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      `/internal/media-kit/by-org/${encodeURIComponent(req.params.orgId)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get media kit by org" });
  }
});

// GET /v1/press-kits/internal/generation-data — generation workflow data
router.get("/press-kits/internal/generation-data", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const qs = req.query.orgId ? `?orgId=${encodeURIComponent(req.query.orgId as string)}` : "";
    const result = await callExternalService(
      externalServices.pressKits,
      `/internal/generation-data${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get generation data" });
  }
});

// POST /v1/press-kits/internal/upsert-generation-result — workflow callback
router.post("/press-kits/internal/upsert-generation-result", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/internal/upsert-generation-result",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to upsert generation result" });
  }
});

// GET /v1/press-kits/clients-media-kits-need-update — stale kits
router.get("/press-kits/clients-media-kits-need-update", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/clients-media-kits-need-update",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get stale kits" });
  }
});

// GET /v1/press-kits/media-kit-setup — setup status for all orgs
router.get("/press-kits/media-kit-setup", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/media-kit-setup",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get setup status" });
  }
});

// GET /v1/press-kits/health/bulk — bulk health per org
router.get("/press-kits/health/bulk", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.pressKits,
      "/health/bulk",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get bulk health" });
  }
});

export default router;
