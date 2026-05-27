import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

// GET /v1/orgs/quote-requests — list quote requests for the org
router.get("/orgs/quote-requests", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["campaign_id", "source", "limit", "offset"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.journalistsQuotes,
      `/orgs/quote-requests${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list quote requests" });
  }
});

// GET /v1/orgs/quote-requests/stats — aggregate stats for quote requests + pitches
// MUST be declared BEFORE /orgs/quote-requests/:id so Express does not match "stats" as :id.
router.get("/orgs/quote-requests/stats", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query["campaign_id"]) params.set("campaign_id", req.query["campaign_id"] as string);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.journalistsQuotes,
      `/orgs/quote-requests/stats${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch quote request stats" });
  }
});

// GET /v1/orgs/quote-requests/:id — get a single quote request
router.get("/orgs/quote-requests/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id;
    const result = await callExternalService(
      externalServices.journalistsQuotes,
      `/orgs/quote-requests/${encodeURIComponent(id)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch quote request" });
  }
});

// GET /v1/orgs/quote-pitches — list quote pitches for the org
router.get("/orgs/quote-pitches", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ["campaign_id", "status", "limit", "offset"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.journalistsQuotes,
      `/orgs/quote-pitches${qs}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to list quote pitches" });
  }
});

// GET /v1/orgs/quote-pitches/:id — get a single quote pitch
router.get("/orgs/quote-pitches/:id", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id;
    const result = await callExternalService(
      externalServices.journalistsQuotes,
      `/orgs/quote-pitches/${encodeURIComponent(id)}`,
      { headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch quote pitch" });
  }
});

// POST /v1/orgs/opportunities/ranked — RAG-ranked opportunities for (campaign, brand)
router.post("/orgs/opportunities/ranked", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.journalistsQuotes,
      "/orgs/opportunities/ranked",
      {
        method: "POST",
        body: req.body,
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch ranked opportunities" });
  }
});

// POST /v1/orgs/quote-requests/:id/draft — generate a pitch draft for the given quote request
router.post("/orgs/quote-requests/:id/draft", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id;
    const result = await callExternalService(
      externalServices.journalistsQuotes,
      `/orgs/quote-requests/${encodeURIComponent(id)}/draft`,
      {
        method: "POST",
        body: req.body,
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to generate quote draft" });
  }
});

// POST /v1/orgs/opportunities/:id/reply — submit a HITL pitch reply for the given opportunity
router.post("/orgs/opportunities/:id/reply", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id;
    const result = await callExternalService(
      externalServices.journalistsQuotes,
      `/orgs/opportunities/${encodeURIComponent(id)}/reply`,
      {
        method: "POST",
        body: req.body,
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to submit opportunity reply" });
  }
});

export default router;
