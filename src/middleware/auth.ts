import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { createRun, updateRun } from "@distribute/runs-client";

/**
 * Timing-safe comparison of two strings.
 * Returns false for length mismatch without leaking timing info.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to consume constant time, then return false
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  orgId?: string;
  runId?: string;
  authType?: "user_key" | "admin";
  /** Workflow tracking headers — injected by workflow-service, optional */
  campaignId?: string;
  /** Brand ID(s) — may be a comma-separated list of UUIDs for multi-brand campaigns */
  brandId?: string;
  workflowSlug?: string;
  featureSlug?: string;
  /** Normalized staff email, set by requireStaff after allowlist match */
  staffEmail?: string;
}

/**
 * Authenticate requests. Two paths:
 *
 * 1. Admin (dashboard) → X-API-Key header matches ADMIN_DISTRIBUTE_API_KEY env var.
 *    External IDs from x-external-org-id / x-external-user-id are resolved via client-service POST /resolve.
 *    Optional profile headers (x-email, x-first-name, x-last-name) are forwarded.
 *
 * 2. User key (distrib.usr_*) → Authorization: Bearer validated via key-service.
 *    Identity comes from the key itself.
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const apiKey = req.headers["x-api-key"] as string | undefined;
    const authHeader = req.headers.authorization;

    if (apiKey) {
      // ── Path 1: Admin auth via X-API-Key ──
      const expectedKey = process.env.ADMIN_DISTRIBUTE_API_KEY;
      if (!expectedKey || !safeCompare(apiKey, expectedKey)) {
        return res.status(401).json({ error: "Invalid admin key" });
      }
      req.authType = "admin";

      // Internal service-to-service calls pass internal UUIDs directly
      const directOrgId = req.headers["x-org-id"] as string | undefined;
      const directUserId = req.headers["x-user-id"] as string | undefined;

      if (directOrgId && directUserId) {
        req.orgId = directOrgId;
        req.userId = directUserId;
      } else {
        // Dashboard calls pass external IDs that need resolution via client-service
        const externalOrgId = req.headers["x-external-org-id"] as string | undefined;
        const externalUserId = req.headers["x-external-user-id"] as string | undefined;

        if (!externalOrgId || !externalUserId) {
          return res.status(400).json({ error: "Admin auth requires identity headers: x-org-id/x-user-id or x-external-org-id/x-external-user-id" });
        }

        const resolved = await resolveExternalIds(externalOrgId, externalUserId, req);

        if (!resolved) {
          console.error("[auth] Admin identity resolution returned null", {
            externalOrgId,
            externalUserId,
          });
          return res.status(502).json({ error: "Identity resolution failed" });
        }

        if (!resolved.orgId || !resolved.userId) {
          console.error("[auth] Admin identity resolution returned empty IDs", {
            resolved,
            externalOrgId,
            externalUserId,
          });
          return res.status(502).json({ error: "Identity resolution returned incomplete data" });
        }

        req.orgId = resolved.orgId;
        req.userId = resolved.userId;
      }

    } else if (authHeader?.startsWith("Bearer ")) {
      // ── Path 2: User key auth via Bearer ──
      const key = authHeader.slice(7);
      const validation = await validateKey(key);
      if (!validation) {
        return res.status(401).json({ error: "Invalid API key" });
      }

      req.orgId = validation.orgId;
      req.userId = validation.userId;
      req.authType = "user_key";

    } else {
      return res.status(401).json({ error: "Missing authentication" });
    }

    // Extract optional workflow tracking headers (injected by workflow-service)
    const campaignId = req.headers["x-campaign-id"] as string | undefined;
    const brandId = req.headers["x-brand-id"] as string | undefined;
    const workflowSlug = req.headers["x-workflow-slug"] as string | undefined;
    const featureSlug = req.headers["x-feature-slug"] as string | undefined;
    if (campaignId) req.campaignId = campaignId;
    if (brandId) req.brandId = brandId;
    if (workflowSlug) req.workflowSlug = workflowSlug;
    if (featureSlug) req.featureSlug = featureSlug;

    // Create a request run for tracking — mandatory, fail the request if runs-service is down
    if (req.orgId) {
      try {
        const runHeaders: Record<string, string> = {};
        if (req.brandId) runHeaders["x-brand-id"] = req.brandId;
        if (req.campaignId) runHeaders["x-campaign-id"] = req.campaignId;
        if (req.workflowSlug) runHeaders["x-workflow-slug"] = req.workflowSlug;
        if (req.featureSlug) runHeaders["x-feature-slug"] = req.featureSlug;

        const run = await createRun({
          orgId: req.orgId,
          userId: req.userId,
          serviceName: "api-service",
          taskName: `${req.method} ${req.baseUrl}${req.path}`,
        }, runHeaders);
        req.runId = run.id;

        // Auto-close the run when the response finishes
        res.on("finish", () => {
          const status = res.statusCode < 400 ? "completed" : "failed";
          const headers: Record<string, string> = {};
          if (req.userId) headers["x-user-id"] = req.userId;
          updateRun(run.id, status, req.orgId, headers).catch((e: unknown) =>
            console.error("[auth] Failed to close run:", (e as Error).message)
          );
        });
      } catch (err) {
        console.error("[auth] Failed to create request run:", (err as Error).message);
        return res.status(502).json({ error: "Run tracking unavailable" });
      }
    }

    return next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({ error: "Invalid authentication" });
  }
}

/**
 * Validate user API key against key-service /validate
 */
async function validateKey(apiKey: string): Promise<{
  orgId?: string;
  userId?: string;
} | null> {
  try {
    const result = await callExternalService<{
      valid: boolean;
      orgId?: string;
      userId?: string;
    }>(
      externalServices.key,
      `/validate?key=${encodeURIComponent(apiKey)}`,
    );

    if (!result.valid) return null;
    return result;
  } catch (error) {
    console.error("[auth] key-service /validate error:", (error as Error).message);
    return null;
  }
}

/**
 * Resolve external org/user IDs to internal UUIDs via client-service POST /resolve.
 * Forwards optional profile headers (x-email, x-first-name, x-last-name) for non-destructive upsert.
 */
async function resolveExternalIds(
  externalOrgId: string,
  externalUserId: string,
  req: Request,
): Promise<{ orgId: string; userId: string } | null> {
  try {
    const body: Record<string, string> = { externalOrgId, externalUserId };

    const email = req.headers["x-email"] as string | undefined;
    const firstName = req.headers["x-first-name"] as string | undefined;
    const lastName = req.headers["x-last-name"] as string | undefined;

    if (email) body.email = email;
    if (firstName) body.firstName = firstName;
    if (lastName) body.lastName = lastName;

    const result = await callExternalService<{
      orgId: string;
      userId: string;
    }>(
      externalServices.client,
      "/internal/resolve",
      {
        method: "POST",
        body,
      }
    );
    return result;
  } catch (error) {
    console.error("[auth] Failed to resolve external IDs:", (error as Error).message);
    return null;
  }
}

/**
 * Platform-level auth — validates X-API-Key only.
 * No identity resolution, no run tracking.
 * Used for platform operations at cold start (e.g. template deployment).
 */
export async function authenticatePlatform(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const apiKey = req.headers["x-api-key"] as string | undefined;
  const expectedKey = process.env.ADMIN_DISTRIBUTE_API_KEY;
  if (!apiKey || !expectedKey || !safeCompare(apiKey, expectedKey)) {
    return res.status(401).json({ error: "Invalid or missing platform API key" });
  }
  req.authType = "admin";
  return next();
}

/**
 * Canonical staff allowlist — hardcoded in source (NOT an env var), so the
 * staff set lives in the repo and cannot drift / be forgotten on Railway.
 * These are the only emails that pass `requireStaff`.
 */
const STAFF_EMAILS = [
  "kevin.lourd@gmail.com",
  "kevin@distribute.you",
] as const;

/**
 * Normalized lowercase Set of the hardcoded staff allowlist.
 */
function staffEmailAllowlist(): Set<string> {
  return new Set(
    STAFF_EMAILS.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0),
  );
}

/**
 * Staff-only gate. MUST run after `authenticate` or `authenticatePlatform`.
 *
 * Two conditions, BOTH required (fail closed → 403):
 *  1. `req.authType === "admin"` — the request came in via the platform API key
 *     (ADMIN_DISTRIBUTE_API_KEY), i.e. a trusted server-side caller (the admin /
 *     dashboard proxy). A Bearer user-key (authType "user_key") is rejected, so a
 *     customer cannot forge `x-email` on a direct call and self-authorize.
 *  2. The forwarded `x-email` header is in the hardcoded staff allowlist
 *     (`STAFF_EMAILS`). The platform key ALONE is shared with the customer
 *     dashboard's server-side proxy, so it does NOT distinguish staff from
 *     customer — `x-email` (forwarded from the verified dashboard/admin session)
 *     is the staff signal.
 *
 * This closes the customer-self-grant hole that `authenticatePlatform` alone leaves
 * open. The staff allowlist is hardcoded in source (not an env var) so it cannot drift.
 */
export function requireStaff(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.authType !== "admin") {
    return res.status(403).json({ error: "Staff access required" });
  }

  const allowlist = staffEmailAllowlist();
  if (allowlist.size === 0) {
    // Defensive fail-closed — the hardcoded allowlist is non-empty, so this
    // should be unreachable unless the constant is emptied in a bad edit.
    console.warn("[auth] requireStaff blocked: staff allowlist is empty — no staff configured");
    return res.status(403).json({ error: "Staff access required" });
  }

  const email = (req.headers["x-email"] as string | undefined)?.trim().toLowerCase();
  if (!email || !allowlist.has(email)) {
    console.warn("[auth] requireStaff blocked non-staff email", { email: email || null, path: req.path });
    return res.status(403).json({ error: "Staff access required" });
  }

  req.staffEmail = email;
  return next();
}

/**
 * Require organization context
 */
export function requireOrg(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.orgId) {
    console.warn("[auth] requireOrg blocked request", {
      path: req.path,
      authType: req.authType,
      hasOrgHeader: !!req.headers["x-external-org-id"],
      hasUserHeader: !!req.headers["x-external-user-id"],
    });
    return res.status(400).json({ error: "Organization context required" });
  }
  next();
}

/**
 * Require user context — must be used after authenticate.
 * Returns 401 if userId was not resolved during authentication.
 */
export function requireUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.userId) {
    return res.status(401).json({ error: "User identity required" });
  }
  next();
}
