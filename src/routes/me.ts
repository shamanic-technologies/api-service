import { Router } from "express";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { fetchBrandMemberships, fetchOrganizationNames } from "../lib/org-scope.js";

const router = Router();

interface MeUser { id: string; email: string | null; firstName: string | null; lastName: string | null }
interface MeOrg { id: string; name: string | null }
interface MeBrand { id: string; name: string | null; domain: string | null }
interface MeOrgWithBrands extends MeOrg { brands: MeBrand[] }

export const KEY_SCOPE =
  "A distribute.you API key belongs to its USER and acts in every organization that user is a member of " +
  "(membership is checked on every request; distribute.you staff count as members of every organization). " +
  "Each request acts in ONE organization: name a brand (`?brandId=`, the `x-brand-id` header, or `brandId` in a JSON body), " +
  "which selects the organization holding it, or name the organization (`?orgId=` or the `x-org-id` header). " +
  "A user in exactly one organization needs to name nothing; a user in several gets `400 org_target_required` with the list. " +
  "The key never carries staff, admin or beta powers, even when its user has them.";

/** client-service caps a batch; staff see every org that holds a brand. */
const ORG_NAMES_BATCH = 200;

/**
 * GET /v1/me
 * Who is this request acting as: the user, every organization the access can
 * act in (by name, each with its brands), the organization THIS request targets
 * (if one is named or implied), and what the key covers.
 *
 * Gateway-constructed response (CLAUDE.md #8 exception): identity and key scope
 * are this gateway's own concern, so the shape is built here from client-service
 * (users, memberships, org names) and brand-service (brand ↔ org memberships).
 * Each lookup that fails is listed in `lookupErrors` with the upstream message
 * and its field is `null`, so a caller never mistakes "unknown" for "none".
 *
 * Uses `authenticateUser`: a multi-org user calling it without naming a target
 * is answered (that is how they learn the choices), with `organization: null`.
 */
router.get("/me", authenticateUser, async (req: AuthenticatedRequest, res) => {
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

  const userPromise = req.userId
    ? attempt("client-service /internal/users", () =>
        callExternalService<{ user: MeUser }>(externalServices.client, `/internal/users/${encodeURIComponent(req.userId!)}`, { headers }))
    : Promise.resolve(null);

  const scope = req.userKeyScope;
  let organizations: MeOrgWithBrands[] | null;
  // Staff (member of every organization): their real memberships come first.

  if (scope) {
    // User key: every organization the key can act in.
    const memberships = await attempt("brand-service /internal/brands/all", fetchBrandMemberships);
    let orgs: MeOrg[] | null;
    if (scope.isStaff) {
      const ids = memberships ? [...new Set(memberships.map((m) => m.orgId))] : [];
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += ORG_NAMES_BATCH) chunks.push(ids.slice(i, i + ORG_NAMES_BATCH));
      const named = await attempt("client-service org names", async () => (await Promise.all(chunks.map(fetchOrganizationNames))).flat());
      const own = new Set(scope.memberships.map((m) => m.id));
      const ordered = [...ids.filter((id) => own.has(id)), ...ids.filter((id) => !own.has(id))];
      orgs = memberships && named ? ordered.map((id) => named.find((n) => n.id === id) ?? { id, name: null }) : null;
    } else {
      orgs = scope.memberships;
    }
    organizations = orgs && memberships
      ? orgs.map((o) => ({
          id: o.id,
          name: o.name,
          brands: memberships.filter((m) => m.orgId === o.id).map((m) => ({ id: m.id, name: m.name, domain: m.domain })),
        }))
      : null;
  } else {
    // Dashboard session: the one organization it is signed into.
    const [orgRes, brandsRes] = await Promise.all([
      req.orgId
        ? attempt("client-service /internal/orgs", () =>
            callExternalService<MeOrg>(externalServices.client, `/internal/orgs/${encodeURIComponent(req.orgId!)}`, { headers }))
        : null,
      req.orgId
        ? attempt("brand-service /orgs/brands", () =>
            callExternalService<{ brands: MeBrand[] }>(externalServices.brand, `/orgs/brands?orgId=${encodeURIComponent(req.orgId!)}`, { headers }))
        : null,
    ]);
    organizations = orgRes && brandsRes
      ? [{ id: orgRes.id, name: orgRes.name, brands: brandsRes.brands.map((b) => ({ id: b.id, name: b.name, domain: b.domain })) }]
      : null;
  }

  const userRes = await userPromise;
  const user = userRes
    ? { id: userRes.user.id, email: userRes.user.email, firstName: userRes.user.firstName, lastName: userRes.user.lastName }
    : null;
  const target = req.orgId && organizations ? organizations.find((o) => o.id === req.orgId) ?? null : null;
  // A staff target holding no brand is not in the brand-derived list: name it anyway.
  const targetOrg = target ?? (req.orgId && scope?.isStaff
    ? await attempt("client-service org names", async () => (await fetchOrganizationNames([req.orgId!]))[0] ?? { id: req.orgId!, name: null })
    : null);

  res.json({
    summary: buildSummary(user, organizations, targetOrg, !!scope?.isStaff, req.authType === "user_key"),
    user,
    organizations,
    organization: targetOrg ? { id: targetOrg.id, name: targetOrg.name } : null,
    brands: target ? target.brands : targetOrg ? [] : null,
    keyScope: req.authType === "user_key" ? KEY_SCOPE : null,
    lookupErrors,
    userId: req.userId || null,
    orgId: req.orgId || null,
    authType: req.authType,
  });
});

function orgLabel(o: MeOrg): string {
  return o.name ? `"${o.name}"` : `organization ${o.id} (name not recorded)`;
}

function buildSummary(
  user: MeUser | null,
  orgs: MeOrgWithBrands[] | null,
  target: MeOrg | null,
  isStaff: boolean,
  isKey: boolean,
): string {
  const who = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id
    : "an unknown user (lookup failed)";
  const email = user?.email && who !== user.email ? ` (${user.email})` : "";
  const parts = [`Acting as ${who}${email}.`];

  if (!orgs) parts.push("Its organizations could not be listed (lookup failed).");
  else if (isStaff) parts.push(`Staff: counts as a member of every organization; ${orgs.length} organizations hold a brand.`);
  else if (orgs.length === 0) parts.push("Member of no organization.");
  else {
    const list = orgs
      .map((o) => `${orgLabel(o)} (${o.brands.length === 0 ? "no brand yet" : o.brands.map((b) => b.name || b.domain || b.id).join(", ")})`)
      .join("; ");
    parts.push(`${isKey ? "This key reaches" : "Signed into"} ${orgs.length} organization${orgs.length === 1 ? "" : "s"}: ${list}.`);
  }

  if (target) parts.push(`This request acts in ${orgLabel(target)}.`);
  else if (isKey) parts.push("Each request must name a brand (brandId) or an organization (orgId) to act on.");
  return parts.join(" ");
}

export default router;
