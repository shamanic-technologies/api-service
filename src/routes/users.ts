import { Router } from "express";
import { authenticate, requireOrg, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { ResolveUserRequestSchema, ListUsersQuerySchema } from "../schemas.js";

const router = Router();

/**
 * POST /v1/users/resolve
 * Resolve external org/user IDs to internal UUIDs (idempotent upsert).
 * For anonymous users, the caller generates a UUID as externalUserId.
 */
/**
 * SEC-STAFF-EMAIL-1120 (security hotfix 2026-11-20): this route only ever
 * creates or updates the CALLER's own, proven identity.
 *
 * Before, any authenticated caller could name any `externalOrgId` /
 * `externalUserId` / `email`, and client-service upserted it: a customer key
 * created a user carrying the owner's staff address in a fresh org. Now:
 *   - a user key (`Bearer distrib.usr_…`) is refused: a key proves who holds it,
 *     not who an arbitrary new identity is (no customer integration calls this);
 *   - the platform key is admitted only for the identity its proxy stamped from
 *     the signed-in Clerk session: `externalOrgId` / `externalUserId` must equal
 *     `x-external-org-id` / `x-external-user-id`, and an `email` must equal the
 *     session's `x-email` (Clerk-verified primary email). Anything else is 403
 *     `identity_not_proven` before client-service is called.
 * The body is never rewritten (rule #4): a mismatch is refused, not corrected.
 */
export function identityNotProven(req: AuthenticatedRequest, body: { externalOrgId: string; externalUserId: string; email?: string }): string | null {
  if (req.authType !== "admin") {
    return "An API key cannot create or resolve user identities. Users are created when they sign in to distribute.you.";
  }
  const headerOrg = req.headers["x-external-org-id"] as string | undefined;
  const headerUser = req.headers["x-external-user-id"] as string | undefined;
  if (!headerOrg || !headerUser || headerOrg !== body.externalOrgId || headerUser !== body.externalUserId) {
    return "externalOrgId and externalUserId must be the signed-in session's own (x-external-org-id / x-external-user-id).";
  }
  if (body.email !== undefined) {
    const sessionEmail = (req.headers["x-email"] as string | undefined)?.trim().toLowerCase();
    if (!sessionEmail || sessionEmail !== body.email.trim().toLowerCase()) {
      return "email must be the signed-in session's verified email (x-email).";
    }
  }
  return null;
}

router.post("/users/resolve", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = ResolveUserRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const refusal = identityNotProven(req, parsed.data);
    if (refusal) {
      console.warn("[users/resolve] refused unproven identity", { authType: req.authType, orgId: req.orgId, userId: req.userId });
      return res.status(403).json({ error: "Identity not proven", code: "identity_not_proven", message: refusal });
    }

    const result = await callExternalService(
      externalServices.client,
      "/internal/resolve",
      {
        method: "POST",
        body: parsed.data,
        headers: buildInternalHeaders(req),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error("Resolve user error:", error);
    res.status(500).json({ error: error.message || "Failed to resolve user identity" });
  }
});

/**
 * GET /v1/users
 * List users for the authenticated org, with optional email filter and pagination.
 */
router.get("/users", authenticate, requireOrg, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = ListUsersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten() });
    }

    const { email, limit, offset } = parsed.data;
    const params = new URLSearchParams({ orgId: req.orgId! });
    if (limit !== undefined) params.set("limit", String(limit));
    if (offset !== undefined) params.set("offset", String(offset));
    if (email) params.set("email", email);

    const result = await callExternalService(
      externalServices.client,
      `/internal/users?${params.toString()}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error: any) {
    console.error("List users error:", error);
    res.status(500).json({ error: error.message || "Failed to list users" });
  }
});

export default router;
