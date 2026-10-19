import { Router } from "express";
import { authenticate, authenticatePlatform, requireOrg, requireStaff, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { requireStaffKeyOrPlatform } from "../middleware/staff-gate.js";
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

// ---------------------------------------------------------------------------
// Staff catalogue status of templates and writer models + a template's last outputs
// (TEMPLATE-MODEL-STATUS-1019) → content-generation-service `/internal/{models,templates}*`.
// Fleet-wide, no org: the producer takes the API key only and leaves "who is staff" to this
// gateway. Gate: a staff member's own key or the platform key + a staff x-email
// (`requireStaffKeyOrPlatform`, `STAFF_KEY_OPERATIONS`). A deprecation here changes the status
// only; stopping the workflows that use it is POST /v1/workflows/retire-by-content.
// Status + body piped byte-for-byte (#10), errors field-for-field (#7), query verbatim (#11).
// ---------------------------------------------------------------------------

function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
}

async function pipeContentStaff(req: AuthenticatedRequest, res: import("express").Response, path: string, fallback: string) {
  try {
    await pipeExternalService(externalServices.emailgen, path, {
      method: req.method === "PUT" ? "PUT" : "GET",
      body: req.method === "PUT" ? req.body : undefined,
      expressRes: res,
    });
  } catch (error: any) {
    console.error(`[api-service] ${fallback}:`, error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, fallback);
  }
}

/** GET /v1/content/models → GET /internal/models (every writer model alias + its status). */
router.get("/content/models", requireStaffKeyOrPlatform, (req: AuthenticatedRequest, res) =>
  pipeContentStaff(req, res, "/internal/models", "Failed to list models"));

/** PUT /v1/content/models/:model/status → PUT /internal/models/{model}/status `{status}`. */
router.put("/content/models/:model/status", requireStaffKeyOrPlatform, (req: AuthenticatedRequest, res) =>
  pipeContentStaff(req, res, `/internal/models/${encodeURIComponent(req.params.model)}/status`, "Failed to set model status"));

/** GET /v1/content/templates → GET /internal/templates (every template type + its status). */
router.get("/content/templates", requireStaffKeyOrPlatform, (req: AuthenticatedRequest, res) =>
  pipeContentStaff(req, res, "/internal/templates", "Failed to list templates"));

/** PUT /v1/content/templates/:type/status → PUT /internal/templates/{type}/status `{status}`. */
router.put("/content/templates/:type/status", requireStaffKeyOrPlatform, (req: AuthenticatedRequest, res) =>
  pipeContentStaff(req, res, `/internal/templates/${encodeURIComponent(req.params.type)}/status`, "Failed to set template status"));

/** GET /v1/content/templates/:type/outputs?limit= → GET /internal/templates/{type}/outputs (newest first, every org). */
router.get("/content/templates/:type/outputs", requireStaffKeyOrPlatform, (req: AuthenticatedRequest, res) =>
  pipeContentStaff(
    req,
    res,
    `/internal/templates/${encodeURIComponent(req.params.type)}/outputs${rawQueryString(req.originalUrl)}`,
    "Failed to read template outputs",
  ));

export default router;
