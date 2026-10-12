import { Router } from "express";
import { authenticate, authenticatePlatform, requireOrg, requireStaff, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, pipeExternalService, externalServices } from "../lib/service-client.js";
import { ContentComposeRequestSchema } from "../schemas.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

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
 * POST /v1/content/preview-email
 * Proxy to content-generation-service POST /preview-email: one cold email written for
 * a brand of the calling org and a sample recipient, before any campaign exists.
 * Body + response shapes are owned by the downstream service — passthrough only.
 * A 402 (org cannot afford the completion) reaches the caller with its status and
 * body field-for-field: the dashboard branches on it.
 */
router.post("/content/preview-email", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.emailgen,
      "/preview-email",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: req.body,
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Preview email error:", error?.message);
    respondUpstreamError(res, error, "Failed to preview email");
  }
});

/**
 * POST /v1/content/preview-email/prepare
 * Proxy to content-generation-service POST /preview-email/prepare: warms the brand-intel
 * read POST /preview-email will need, so the first preview only waits for the model.
 * Same auth, identity headers and run as POST /v1/content/preview-email. The downstream
 * answers 202 at once; piped so that status (and the body bytes) reach the caller as-is.
 */
router.post("/content/preview-email/prepare", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    await pipeExternalService(
      externalServices.emailgen,
      "/preview-email/prepare",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: req.body,
        expressRes: res,
      },
    );
  } catch (error: any) {
    console.error("[api-service] Preview email prepare error:", error?.message);
    respondUpstreamError(res, error, "Failed to prepare preview email");
  }
});

/**
 * GET /v1/content/platform-prompts?type=<string>
 * Proxy to content-generation-service GET /platform-prompts?type=<string>.
 * Returns the stored prompt template + its variable metadata so callers can
 * collect inputs before invoking POST /v1/content/generate-expert-quote-pitch.
 *
 * STAFF ONLY (security hotfix 2026-10-12): content-generation-service's prompts table and
 * feature→prompt assignments are PLATFORM-wide (no org scope), so this read hands out our
 * shared prompt templates and the write re-points a feature's prompt for every org.
 * Response shape is owned by the downstream service — passthrough only.
 */
router.get("/content/platform-prompts", authenticatePlatform, requireStaff, authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
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
 *
 * STAFF ONLY (security hotfix 2026-10-12): content-generation-service's prompts table and
 * feature→prompt assignments are PLATFORM-wide (no org scope), so this read hands out our
 * shared prompt templates and the write re-points a feature's prompt for every org.
 * Response shape is owned by the downstream service — passthrough only.
 */
router.get("/content/prompt-assignments", authenticatePlatform, requireStaff, authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
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
 *
 * STAFF ONLY (security hotfix 2026-10-12): content-generation-service's prompts table and
 * feature→prompt assignments are PLATFORM-wide (no org scope), so this read hands out our
 * shared prompt templates and the write re-points a feature's prompt for every org.
 * Body + response shapes are owned by the downstream service — passthrough only.
 * Downstream owns validation: its 400 variable-integrity errors propagate verbatim.
 */
router.put("/content/prompt-assignments", authenticatePlatform, requireStaff, authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
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
