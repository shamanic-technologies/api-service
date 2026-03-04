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
 * Authenticate via Bearer token. Two paths:
 *
 * 1. Admin key → Bearer token matches ADMIN_DISTRIBUTE_API_KEY env var (dashboard).
 *    External Clerk IDs from x-org-id / x-user-id are resolved via client-service.
 *
 * 2. User key (distrib.usr_*) → validated via key-service. Identity comes from the key itself.
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing authentication" });
    }

    const key = authHeader.slice(7);

    // ── Path 1: Admin / dashboard auth ──
    if (key === process.env.ADMIN_DISTRIBUTE_API_KEY) {
      req.authType = "admin";

      // Dashboard sends external Clerk IDs → resolve to internal UUIDs
      const externalOrgId = req.headers["x-org-id"] as string | undefined;
      const externalUserId = req.headers["x-user-id"] as string | undefined;

      if (externalOrgId && externalUserId) {
        const resolved = await resolveExternalIds(externalOrgId, externalUserId);

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
      // Admin without org/user context is valid (e.g. listing all orgs)

    } else {
      // ── Path 2: User key auth via key-service ──
      const validation = await validateKey(key);
      if (!validation) {
        return res.status(401).json({ error: "Invalid API key" });
      }

      req.orgId = validation.orgId;
      req.userId = validation.userId;
      req.authType = "user_key";
    }

    // Create a request run for tracking (best-effort — don't block if runs-service is down)
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
          updateRun(run.id, status, req.orgId).catch((e: unknown) =>
            console.warn("[auth] Failed to update run:", (e as Error).message)
          );
        });
      } catch (err) {
        console.warn("[auth] Failed to create request run:", (err as Error).message);
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
 * Resolve external org/user IDs to internal UUIDs via client-service POST /resolve
 */
async function resolveExternalIds(
  externalOrgId: string,
  externalUserId: string,
): Promise<{ orgId: string; userId: string } | null> {
  try {
    const result = await callExternalService<{
      orgId: string;
      userId: string;
    }>(
      externalServices.client,
      "/resolve",
      {
        method: "POST",
        body: { externalOrgId, externalUserId },
      }
    );
    return result;
  } catch (error) {
    console.error("[auth] Failed to resolve external IDs:", (error as Error).message);
    return null;
  }
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
      hasOrgHeader: !!req.headers["x-org-id"],
      hasUserHeader: !!req.headers["x-user-id"],
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
