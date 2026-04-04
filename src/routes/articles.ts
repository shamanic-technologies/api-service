import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// ── Articles ────────────────────────────────────────────────────────────────

// GET /v1/articles/authors — articles with computed authors view
// (must be before /articles/:id to avoid matching "authors" as an :id)
router.get("/articles/authors", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.limit) params.set("limit", req.query.limit as string);
    if (req.query.offset) params.set("offset", req.query.offset as string);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.articles,
      `/v1/articles/authors${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list article authors" });
  }
});

// GET /v1/articles — list articles with pagination
router.get("/articles", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.limit) params.set("limit", req.query.limit as string);
    if (req.query.offset) params.set("offset", req.query.offset as string);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.articles,
      `/v1/articles${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list articles" });
  }
});

// POST /v1/articles — create or upsert an article by URL
router.post("/articles", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      "/v1/articles",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create article" });
  }
});

// POST /v1/articles/bulk — bulk upsert articles
router.post("/articles/bulk", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      "/v1/articles/bulk",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to bulk create articles" });
  }
});

// POST /v1/articles/search — full-text search across article fields
router.post("/articles/search", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      "/v1/articles/search",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to search articles" });
  }
});

// GET /v1/articles/stats — aggregated article discovery stats
// (must be before /articles/:id to avoid matching "stats" as an :id)
router.get("/articles/stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["orgId", "brandId", "campaignId", "workflowSlug", "featureSlug", "workflowDynastySlug", "featureDynastySlug", "groupBy"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const result = await callExternalService(
      externalServices.articles,
      `/v1/stats${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get article stats" });
  }
});

// GET /v1/articles/:id — get a single article by ID
router.get("/articles/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      `/v1/articles/${encodeURIComponent(req.params.id)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get article" });
  }
});

// ── Topics ──────────────────────────────────────────────────────────────────

// GET /v1/topics — list all topics
router.get("/topics", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      "/v1/topics",
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list topics" });
  }
});

// POST /v1/topics — create or upsert a topic by name
router.post("/topics", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      "/v1/topics",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create topic" });
  }
});

// POST /v1/topics/bulk — bulk upsert topics
router.post("/topics/bulk", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      "/v1/topics/bulk",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to bulk create topics" });
  }
});

// ── Discoveries ─────────────────────────────────────────────────────────────

// GET /v1/discoveries — list article discoveries with filters
router.get("/discoveries", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["brandId", "campaignId", "outletId", "journalistId", "topicId", "featureSlugs", "featureDynastySlug", "workflowSlugs", "workflowDynastySlug", "limit", "offset"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.articles,
      `/v1/discoveries${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list discoveries" });
  }
});

// POST /v1/discoveries — link an article to a campaign context
router.post("/discoveries", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      "/v1/discoveries",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to create discovery" });
  }
});

// POST /v1/discoveries/bulk — bulk link articles to campaign contexts
router.post("/discoveries/bulk", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      "/v1/discoveries/bulk",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to bulk create discoveries" });
  }
});

// ── Discovery workflows ─────────────────────────────────────────────────────

// POST /v1/discover/outlet-articles — discover articles from an outlet via Google News + scraping
router.post("/discover/outlet-articles", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      "/v1/discover/outlet-articles",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to discover outlet articles" });
  }
});

// POST /v1/discover/journalist-publications — discover publications by a journalist
router.post("/discover/journalist-publications", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.articles,
      "/v1/discover/journalist-publications",
      { method: "POST", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to discover journalist publications" });
  }
});

export default router;
