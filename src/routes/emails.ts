import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { SendEmailRequestSchema, DeployEmailTemplatesRequestSchema } from "../schemas.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { getRunsBatch, type RunWithCosts } from "@distribute/runs-client";

const router = Router();

/**
 * GET /v1/emails — list generated emails with filters (brand-level)
 * Proxies to content-generation-service GET /generations with brandId query param.
 * Returns the same enriched shape as GET /campaigns/:id/emails.
 */
router.get("/emails", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { brandId, campaignId, limit, offset } = req.query as {
      brandId?: string;
      campaignId?: string;
      limit?: string;
      offset?: string;
    };
    if (!brandId) {
      return res.status(400).json({ error: "Missing required query parameter: brandId" });
    }

    const headers = buildInternalHeaders(req);

    const params = new URLSearchParams();
    params.set("brandId", brandId);
    if (campaignId) params.set("campaignId", campaignId);
    if (limit) params.set("limit", limit);
    if (offset) params.set("offset", offset);

    const emailsResult = await callExternalService(
      externalServices.emailgen,
      `/generations?${params}`,
      { headers }
    ) as { generations: Array<Record<string, unknown>> };

    const allEmails = emailsResult.generations || [];

    if (allEmails.length === 0) {
      return res.json({ emails: [] });
    }

    // Batch-fetch generation run costs from runs-service
    const generationRunIds = allEmails
      .map((e) => e.generationRunId as string | undefined)
      .filter((id): id is string => !!id);

    let runMap = new Map<string, RunWithCosts>();
    if (generationRunIds.length > 0) {
      try {
        runMap = await getRunsBatch(generationRunIds, req.orgId, buildInternalHeaders(req));
      } catch (err) {
        console.warn("[api-service] Failed to fetch email generation run costs:", err);
      }
    }

    // Attach run data to each email
    const emailsWithRuns = allEmails.map((email) => {
      const run = email.generationRunId ? runMap.get(email.generationRunId as string) : undefined;
      return {
        ...email,
        generationRun: run
          ? {
              status: run.status,
              startedAt: run.startedAt,
              completedAt: run.completedAt,
              totalCostInUsdCents: run.totalCostInUsdCents,
              costs: run.costs,
              serviceName: run.serviceName,
              taskName: run.taskName,
              descendantRuns: run.descendantRuns ?? [],
            }
          : null,
      };
    });

    res.json({ emails: emailsWithRuns });
  } catch (error: any) {
    console.error("[api-service] Get brand emails error:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get emails" });
  }
});

/**
 * GET /v1/emails/by-lead/:leadId — the generated email for ONE lead.
 * Transparent proxy to content-generation-service GET /generations/by-lead/:leadId
 * (org-scoped via identity headers). Body forwarded verbatim (CLAUDE.md #8 — downstream
 * owns the generation shape; no field re-declaration / stripping).
 *
 * Upstream 404 ("Generation not found") is a NORMAL empty state ("no email yet for this
 * lead"), so it maps to 200 { generation: null } — NOT a client-facing error. Any other
 * upstream error propagates verbatim (fail loud).
 */
router.get(
  "/emails/by-lead/:leadId",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.emailgen,
        `/generations/by-lead/${encodeURIComponent(req.params.leadId)}`,
        { headers: buildInternalHeaders(req) },
      ) as { generation: Record<string, unknown> };
      res.json({ generation: result.generation });
    } catch (error: any) {
      // No generation yet for this lead → normal empty state, not an error.
      if (error.statusCode === 404) {
        return res.json({ generation: null });
      }
      console.error("[api-service] Get email by lead error:", error.message);
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to get email for lead" });
    }
  },
);

/**
 * POST /v1/emails/send
 * Send a transactional email via the transactional-email service
 */
router.post("/emails/send", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = SendEmailRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.transactionalEmail,
      "/send",
      {
        method: "POST",
        headers: buildInternalHeaders(req),
        body: {
          orgId: req.orgId,
          userId: req.userId,
          ...parsed.data,
        },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Send email error:", error);
    res.status(500).json({ error: error.message || "Failed to send email" });
  }
});

/**
 * GET /v1/emails/stats
 * Get email sending stats from the transactional-email service
 */
router.get("/emails/stats", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const params = new URLSearchParams({ orgId: req.orgId! });
    for (const key of ["eventType", "workflowSlug", "featureSlug", "workflowDynastySlug", "featureDynastySlug"]) {
      if (req.query[key]) params.set(key, req.query[key] as string);
    }

    const result = await callExternalService(
      externalServices.transactionalEmail,
      `/stats?${params}`,
      {
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Email stats error:", error);
    res.status(500).json({ error: error.message || "Failed to get email stats" });
  }
});

/**
 * POST /v1/emails/manual-qualifications
 * Record a manual reply qualification for a (campaign, lead) pair.
 * Transparent proxy to email-gateway → instantly-service. Body forwarded byte-identical.
 */
router.post(
  "/emails/manual-qualifications",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.emailGateway,
        "/orgs/manual-qualifications",
        {
          method: "POST",
          headers: buildInternalHeaders(req),
          body: req.body,
        },
      );
      res.json(result);
    } catch (error: any) {
      console.error("[api-service] Manual qualification create error:", error.message);
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to record manual qualification" });
    }
  },
);

/**
 * GET /v1/emails/manual-qualifications
 * List manual reply qualifications for the caller's org.
 * Transparent proxy to email-gateway → instantly-service.
 */
router.get(
  "/emails/manual-qualifications",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const params = new URLSearchParams();
      for (const key of ["campaign_id", "email", "limit"]) {
        const v = req.query[key];
        if (typeof v === "string" && v.length > 0) params.set(key, v);
      }
      const qs = params.toString();
      const path = qs ? `/orgs/manual-qualifications?${qs}` : "/orgs/manual-qualifications";

      const result = await callExternalService(
        externalServices.emailGateway,
        path,
        { headers: buildInternalHeaders(req) },
      );
      res.json(result);
    } catch (error: any) {
      console.error("[api-service] Manual qualification list error:", error.message);
      res.status(error.statusCode || 500).json({ error: error.message || "Failed to list manual qualifications" });
    }
  },
);

/**
 * PUT /v1/emails/templates
 * Deploy (upsert) email templates — idempotent, safe to call on every cold start
 */
router.put("/emails/templates", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = DeployEmailTemplatesRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await callExternalService(
      externalServices.transactionalEmail,
      "/templates",
      {
        method: "PUT",
        headers: buildInternalHeaders(req),
        body: {
          ...parsed.data,
        },
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Deploy templates error:", error);
    res.status(500).json({ error: error.message || "Failed to deploy templates" });
  }
});

/**
 * GET /v1/workflow-examples — example emails per workflow for the workflow picker.
 * Transparent proxy to content-generation-service GET /generations/examples (a brand→org→global
 * cascade of past generations). Returns content-gen's body verbatim:
 * { examples: Array<ExampleEmail> } where each carries the email fields + scope
 * ("brand"|"org"|"global") + brandName. No enrichment / no field re-declaration (CLAUDE.md #8).
 */
router.get("/workflow-examples", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const { workflowSlug, brandId, limit } = req.query as {
      workflowSlug?: string;
      brandId?: string;
      limit?: string;
    };
    if (!workflowSlug) {
      return res.status(400).json({ error: "Missing required query parameter: workflowSlug" });
    }

    const params = new URLSearchParams();
    params.set("workflowSlug", workflowSlug);
    if (brandId) params.set("brandId", brandId);
    if (limit) params.set("limit", limit);

    const result = await callExternalService(
      externalServices.emailgen,
      `/generations/examples?${params}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("[api-service] Get workflow examples error:", error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Failed to get workflow examples" });
  }
});

export default router;
