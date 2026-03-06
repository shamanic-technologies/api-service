import { Request, Response, NextFunction } from "express";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { createRun, updateRun } from "@distribute/runs-client";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  orgId?: string;
  runId?: string;
  authType?: "user_key" | "admin";
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
      if (apiKey !== process.env.ADMIN_DISTRIBUTE_API_KEY) {
        return res.status(401).json({ error: "Invalid admin key" });
      }
      req.authType = "admin";

      const externalOrgId = req.headers["x-external-org-id"] as string | undefined;
      const externalUserId = req.headers["x-external-user-id"] as string | undefined;

      if (!externalOrgId || !externalUserId) {
        return res.status(400).json({ error: "Admin auth requires both x-external-org-id and x-external-user-id" });
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

    // Create a request run for tracking — mandatory, fail the request if runs-service is down
    if (req.orgId) {
      try {
        const run = await createRun({
          orgId: req.orgId,
          userId: req.userId,
          serviceName: "api-service",
          taskName: `${req.method} ${req.baseUrl}${req.path}`,
        });
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
      "/resolve",
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
  if (!apiKey || apiKey !== process.env.ADMIN_DISTRIBUTE_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing platform API key" });
  }
  req.authType = "admin";
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
