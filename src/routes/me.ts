import { Router } from "express";
import { authenticate, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

const router = Router();

interface MeUser { id: string; email: string | null; firstName: string | null; lastName: string | null }
interface MeOrg { id: string; name: string | null }
interface MeBrand { id: string; name: string | null; domain: string | null }

const KEY_SCOPE =
  "A distribute.you API key acts as ONE user inside ONE organization: the organization that was active " +
  "when the key was created. It reads and acts on every brand of that organization and on nothing else. " +
  "It is not tied to a single brand, and it never carries staff, admin or beta powers, even when the user " +
  "who created it has them. To act for another organization, create a key while that organization is active.";

/**
 * GET /v1/me
 * Who is this request acting as: user, organization (by name), the brands that
 * organization holds, and what the key covers.
 *
 * Gateway-constructed response (CLAUDE.md #8 exception): identity is this
 * gateway's own concern, so the shape is built here from client-service
 * (`/internal/users/:id`, `/internal/orgs/:id`) and brand-service (`/orgs/brands`).
 * Each lookup that fails is listed in `lookupErrors` with the upstream message
 * and its field is `null`, so a caller never mistakes "unknown" for "none".
 * `userId` / `orgId` / `authType` are unchanged and need no downstream call.
 */
router.get("/me", authenticate, async (req: AuthenticatedRequest, res) => {
  const headers = buildInternalHeaders(req);
  const lookupErrors: Array<{ source: string; error: string }> = [];
  const attempt = async <T>(source: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      lookupErrors.push({ source, error: (err as Error).message });
      return null;
    }
  };

  const [userRes, orgRes, brandsRes] = await Promise.all([
    req.userId
      ? attempt("client-service /internal/users", () =>
          callExternalService<{ user: MeUser }>(externalServices.client, `/internal/users/${encodeURIComponent(req.userId!)}`, { headers }))
      : null,
    req.orgId
      ? attempt("client-service /internal/orgs", () =>
          callExternalService<MeOrg>(externalServices.client, `/internal/orgs/${encodeURIComponent(req.orgId!)}`, { headers }))
      : null,
    req.orgId
      ? attempt("brand-service /orgs/brands", () =>
          callExternalService<{ brands: MeBrand[] }>(externalServices.brand, `/orgs/brands?orgId=${encodeURIComponent(req.orgId!)}`, { headers }))
      : null,
  ]);

  const user = userRes
    ? { id: userRes.user.id, email: userRes.user.email, firstName: userRes.user.firstName, lastName: userRes.user.lastName }
    : null;
  const organization = orgRes ? { id: orgRes.id, name: orgRes.name } : null;
  const brands = brandsRes ? brandsRes.brands.map((b) => ({ id: b.id, name: b.name, domain: b.domain })) : null;

  res.json({
    summary: buildSummary(user, organization, brands),
    user,
    organization,
    brands,
    keyScope: req.authType === "user_key" ? KEY_SCOPE : null,
    lookupErrors,
    userId: req.userId || null,
    orgId: req.orgId || null,
    authType: req.authType,
  });
});

function buildSummary(user: MeUser | null, org: MeOrg | null, brands: MeBrand[] | null): string {
  const who = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id
    : "an unknown user (lookup failed)";
  const email = user?.email && who !== user.email ? ` (${user.email})` : "";
  const orgPart = org
    ? org.name ? `the organization "${org.name}"` : `organization ${org.id} (its name is not recorded)`
    : "an unknown organization (lookup failed)";
  let brandPart: string;
  if (!brands) brandPart = "Its brands could not be listed (lookup failed).";
  else if (brands.length === 0) brandPart = "It holds no brand yet.";
  else brandPart = `It holds ${brands.length} brand${brands.length === 1 ? "" : "s"}: ${brands.map((b) => b.name || b.domain || b.id).join(", ")}.`;
  return `Acting as ${who}${email} in ${orgPart}. ${brandPart} This access covers this one organization only.`;
}

export default router;
