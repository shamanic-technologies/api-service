import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// POST /v1/orgs/google/auth/start — start Google CRM OAuth (Gmail + People readonly)
router.post("/orgs/google/auth/start", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.google,
      "/orgs/google/auth/start",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to start Google OAuth" });
  }
});

// GET /v1/orgs/google/auth/callback — Google CRM OAuth callback
router.get("/orgs/google/auth/callback", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.code) params.set("code", req.query.code as string);
    if (req.query.state) params.set("state", req.query.state as string);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.google,
      `/orgs/google/auth/callback${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to complete Google OAuth callback" });
  }
});

// POST /v1/orgs/google/sync — sync Gmail messages + People contacts for the org
router.post("/orgs/google/sync", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.google,
      "/orgs/google/sync",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to sync Google CRM data" });
  }
});

// GET /v1/orgs/google/sync/:jobId — poll status of an async Google sync job
router.get("/orgs/google/sync/:jobId", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const jobId = req.params.jobId;
    const result = await callExternalService(
      externalServices.google,
      `/orgs/google/sync/${encodeURIComponent(jobId)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch Google sync job status" });
  }
});

// GET /v1/orgs/google/messages — list raw Gmail messages (bronze)
router.get("/orgs/google/messages", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["limit", "cursor", "account_id", "thread_id", "participant"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.google,
      `/orgs/google/messages${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list Gmail messages" });
  }
});

// GET /v1/orgs/google/accounts — list connected Google accounts for the org
router.get("/orgs/google/accounts", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.google,
      "/orgs/google/accounts",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list Google accounts" });
  }
});

// GET /v1/orgs/google/contacts — list raw Google contacts (bronze)
router.get("/orgs/google/contacts", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["limit", "cursor", "account_id", "query"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.google,
      `/orgs/google/contacts${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list Google contacts" });
  }
});

// PUT /v1/orgs/google/contact-links — set link targets (orgs/brands/features) for a contact
router.put("/orgs/google/contact-links", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.google,
      "/orgs/google/contact-links",
      { method: "PUT", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to update Google contact links" });
  }
});

export default router;
