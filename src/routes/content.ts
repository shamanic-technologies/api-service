import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { ContentComposeRequestSchema } from "../schemas.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

/**
 * POST /v1/content/compose
 * Proxy to content-generation-service POST /compose
 */
router.post("/content/compose", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = ContentComposeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService<{ composedVideoUrl: string }>(
      externalServices.emailgen,
      "/compose",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: parsed.data,
      },
    );

    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Content compose error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to compose content" });
  }
});

/**
 * POST /v1/content/generate-expert-quote-pitch
 * Proxy to content-generation-service POST /generate-expert-quote-pitch.
 * Body + response shapes are owned by the downstream service — passthrough only.
 */
router.post("/content/generate-expert-quote-pitch", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.emailgen,
      "/generate-expert-quote-pitch",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: req.body,
      },
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to generate expert quote pitch" });
  }
});

/**
 * GET /v1/content/platform-prompts?type=<string>
 * Proxy to content-generation-service GET /platform-prompts?type=<string>.
 * Returns the stored prompt template + its variable metadata so callers can
 * collect inputs before invoking POST /v1/content/generate-expert-quote-pitch.
 * Response shape is owned by the downstream service — passthrough only.
 */
router.get("/content/platform-prompts", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query["type"]) params.set("type", req.query["type"] as string);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.emailgen,
      `/platform-prompts${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch platform prompt" });
  }
});

/**
 * GET /v1/content/prompt-assignments?featureSlug=<slug>
 * Proxy to content-generation-service GET /prompt-assignments?featureSlug=<slug>.
 * Returns the prompt currently assigned to a feature + its variable metadata so the
 * dashboard prompt editor can read the prompt the feature's GENERATE step uses.
 * Response shape is owned by the downstream service — passthrough only.
 */
router.get("/content/prompt-assignments", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query["featureSlug"]) params.set("featureSlug", req.query["featureSlug"] as string);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const result = await callExternalService(
      externalServices.emailgen,
      `/prompt-assignments${qs}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to fetch prompt assignment" });
  }
});

/**
 * PUT /v1/content/prompt-assignments
 * Proxy to content-generation-service PUT /prompt-assignments.
 * Saves the feature's generation prompt (forks + reassigns downstream).
 * Body + response shapes are owned by the downstream service — passthrough only.
 * Downstream owns validation: its 400 variable-integrity errors propagate verbatim.
 */
router.put("/content/prompt-assignments", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.emailgen,
      "/prompt-assignments",
      {
        method: "PUT",
        headers: buildInternalHeaders(req),
        body: req.body,
      },
    );
    res.json(result);
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to save prompt assignment" });
  }
});

export default router;
