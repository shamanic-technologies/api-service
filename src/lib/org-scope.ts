import { Response } from "express";
import { callExternalService, externalServices } from "./service-client.js";
import { isStaffEmail } from "./staff.js";

/**
 * Which organization a USER-KEY request acts in.
 *
 * A distribute.you user API key belongs to the USER, not to an organization
 * (owner decision 2026-10-01). It reaches every organization the user is a
 * member of RIGHT NOW, read from client-service on every request, so a user
 * removed from an organization loses that organization through their key.
 * Staff users count as members of every organization. A key never carries staff
 * powers: staff/platform routes gate on the platform key (`requireStaff`,
 * `authenticatePlatform`), which a Bearer key never passes; staff status here
 * only widens WHICH organizations the key can name.
 *
 * Each request targets exactly one organization:
 *   - named directly: `x-org-id` header, `orgId` query parameter, or an
 *     `:orgId` path segment;
 *   - implied by a brand: `x-brand-id` header, `brandId` query parameter,
 *     `brandId` / `brandIds` in a JSON body, a `:brandId` path parameter, or the
 *     `:id` of a `/brands/:id...` route. The org is the one of the caller's
 *     organizations that holds every named brand;
 *   - nothing named: allowed only when the user belongs to exactly one
 *     organization. Otherwise the request is refused with the list of choices.
 *     There is never a default organization for a multi-org user.
 *
 * The key's stored org (the org active when it was created) is ignored: that
 * binding is retired, so every existing key gains the cross-org scope with no
 * action from anyone.
 */

export interface ScopeOrg { id: string; name: string | null }
export interface BrandMembership { id: string; name: string | null; domain: string | null; orgId: string }

export interface UserKeyScope {
  isStaff: boolean;
  /**
   * The organizations the user is actually a member of. Staff can act in every
   * organization; their real memberships still rank first when a brand is held
   * by several organizations.
   */
  memberships: ScopeOrg[];
}

export type TargetFailureCode =
  | "org_target_required"
  | "org_not_member"
  | "org_not_found"
  | "brand_not_found"
  | "brand_in_several_orgs"
  | "brands_span_orgs"
  | "no_organization"
  | "membership_unavailable";

export interface TargetFailure {
  status: number;
  code: TargetFailureCode;
  error: string;
  message: string;
  fix: string;
  organizations?: ScopeOrg[];
}

const HOW_TO_TARGET =
  "Name a brand with `?brandId=<id>` (or the `x-brand-id` header, or `brandId` in a JSON body), which selects the organization holding it, " +
  "or name the organization with `?orgId=<id>` (or the `x-org-id` header). GET /v1/me lists your organizations and their brands.";

export function respondTargetFailure(res: Response, f: TargetFailure) {
  const body: Record<string, unknown> = { error: f.error, code: f.code, message: f.message, fix: f.fix };
  if (f.organizations) body.organizations = f.organizations;
  return res.status(f.status).json(body);
}

/** Who the key's user is, for scoping: staff, and if not, their organizations. */
export async function loadUserKeyScope(userId: string): Promise<UserKeyScope | TargetFailure> {
  try {
    const [user, memberships] = await Promise.all([
      callExternalService<{ user: { email: string | null } }>(
        externalServices.client,
        `/internal/users/${encodeURIComponent(userId)}`,
      ),
      fetchUserOrganizations(userId),
    ]);
    return { isStaff: isStaffEmail(user.user.email), memberships };
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) {
      // The key outlived its user (client-service no longer knows them).
      return {
        status: 403,
        code: "no_organization",
        error: "No organization",
        message: `This key's user no longer exists in distribute.you, so the key can act on nothing: ${(err as Error).message}`,
        fix: "Create a new key from the distribute.you dashboard while signed in.",
      };
    }
    console.error("[org-scope] membership lookup failed:", (err as Error).message);
    return {
      status: 503,
      code: "membership_unavailable",
      error: "Organization membership unavailable",
      message: `distribute.you could not check which organizations this key's user belongs to right now: ${(err as Error).message}`,
      fix: "Retry in a minute. This says nothing about the key itself.",
    };
  }
}

/**
 * The user's current organizations, from client-service (identity provider
 * truth, cached there at most 60s, so a removed member loses access within 60s).
 * Clerk orgs client-service has no internal id for yet (`unresolved`) cannot be
 * targeted by id and are left out until the org is first resolved.
 */
export async function fetchUserOrganizations(userId: string): Promise<ScopeOrg[]> {
  const result = await callExternalService<{ organizations: Array<{ orgId: string; name: string | null }> }>(
    externalServices.client,
    `/internal/users/${encodeURIComponent(userId)}/orgs`,
  );
  return result.organizations.map((o) => ({ id: o.orgId, name: o.name ?? null }));
}

/** Display names for a set of organizations, one call. */
export async function fetchOrganizationNames(orgIds: string[]): Promise<ScopeOrg[]> {
  if (orgIds.length === 0) return [];
  const result = await callExternalService<{ orgs: Array<{ orgId: string; name: string | null }>; notFound: string[] }>(
    externalServices.client,
    "/internal/orgs/names",
    { method: "POST", body: { orgIds } },
  );
  return result.orgs.map((o) => ({ id: o.orgId, name: o.name ?? null }));
}

/** Every (brand, org) membership on the platform, from brand-service. */
export async function fetchBrandMemberships(): Promise<BrandMembership[]> {
  const result = await callExternalService<{ brands: BrandMembership[] }>(
    externalServices.brand,
    "/internal/brands/all",
  );
  return result.brands;
}

interface TargetRequest {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  body?: unknown;
  params?: Record<string, string>;
  route?: { path?: unknown };
}

function splitIds(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(splitIds);
  return [];
}

/** Every brand id the request names, wherever it names it. */
export function namedBrandIds(req: TargetRequest): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => splitIds(v).forEach((id) => ids.add(id));
  add(req.headers["x-brand-id"]);
  add(req.query?.brandId);
  add(req.query?.brandIds);
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    const body = req.body as Record<string, unknown>;
    add(body.brandId);
    add(body.brandIds);
  }
  add(req.params?.brandId);
  const routePath = typeof req.route?.path === "string" ? req.route.path : "";
  if (/(^|\/)brands\/:id(\/|$)/.test(routePath)) add(req.params?.id);
  return [...ids];
}

/** The org the request names directly, if any. Two different values = a failure. */
export function namedOrgId(req: TargetRequest): string | TargetFailure | undefined {
  const header = req.headers["x-org-id"];
  const sources: Array<[string, unknown]> = [
    ["the x-org-id header", header],
    ["the orgId query parameter", req.query?.orgId],
    ["the :orgId path segment", req.params?.orgId],
  ];
  const named = sources
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([where, v]) => [where, (v as string).trim()] as const);
  const distinct = [...new Set(named.map(([, v]) => v))];
  if (distinct.length > 1) {
    return {
      status: 400,
      code: "org_target_required",
      error: "Conflicting organization",
      message: `The request names different organizations: ${named.map(([w, v]) => `${w} (${v})`).join(", ")}.`,
      fix: "Name one organization.",
    };
  }
  return distinct[0];
}

/**
 * Pick the request's organization, or say why none can be picked.
 * `undefined` org with no failure never happens: the result is an org id or a failure.
 */
export async function resolveTargetOrg(
  req: TargetRequest,
  scope: UserKeyScope,
): Promise<{ orgId: string } | TargetFailure> {
  const orgNamed = namedOrgId(req);
  if (orgNamed && typeof orgNamed === "object") return orgNamed;
  const brandIds = namedBrandIds(req);
  const { memberships, isStaff } = scope;

  if (!isStaff && memberships.length === 0) {
    return {
      status: 403,
      code: "no_organization",
      error: "No organization",
      message: "This key's user is not a member of any distribute.you organization, so the key can act on nothing.",
      fix: "Ask an organization admin to invite this user, or sign in to the dashboard to create an organization.",
    };
  }

  // A single-org user naming nothing: today's behaviour, no lookup needed.
  if (!orgNamed && brandIds.length === 0) {
    if (!isStaff && memberships.length === 1) return { orgId: memberships[0].id };
    return {
      status: 400,
      code: "org_target_required",
      error: "Organization target required",
      message: isStaff
        ? "This key's user is distribute.you staff and therefore counts as a member of every organization. Each request must say which organization it acts on."
        : `This key's user belongs to ${memberships.length} organizations. Each request must say which one it acts on; none is picked by default.`,
      fix: HOW_TO_TARGET,
      ...(isStaff ? {} : { organizations: memberships }),
    };
  }

  if (orgNamed && !isStaff && !memberships.some((o) => o.id === orgNamed)) {
    return {
      status: 403,
      code: "org_not_member",
      error: "Not a member of this organization",
      message: `This key's user is not a member of organization ${orgNamed}.`,
      fix: HOW_TO_TARGET,
      organizations: memberships,
    };
  }

  if (brandIds.length === 0) {
    // Staff naming an org: it must exist.
    if (isStaff) {
      const names = await fetchOrganizationNames([orgNamed as string]);
      if (names.length === 0) {
        return {
          status: 404,
          code: "org_not_found",
          error: "Organization not found",
          message: `No organization ${orgNamed} exists.`,
          fix: HOW_TO_TARGET,
        };
      }
    }
    return { orgId: orgNamed as string };
  }

  // A single-org user naming a brand: the org is already known; the downstream
  // scopes the brand on it (a brand of another org is the downstream's 404).
  if (!isStaff && !orgNamed && memberships.length === 1) return { orgId: memberships[0].id };

  const allowed = isStaff ? null : new Set(memberships.map((o) => o.id));
  const rows = (await fetchBrandMemberships()).filter((r) => brandIds.includes(r.id) && (!allowed || allowed.has(r.orgId)));

  const orgsPerBrand = brandIds.map((b) => new Set(rows.filter((r) => r.id === b).map((r) => r.orgId)));
  const missing = brandIds.filter((_, i) => orgsPerBrand[i].size === 0);
  if (missing.length > 0) {
    return {
      status: 404,
      code: "brand_not_found",
      error: "Brand not found",
      message: isStaff
        ? `No organization holds brand ${missing.join(", ")}.`
        : `None of this key's user's organizations holds brand ${missing.join(", ")}.`,
      fix: "Check the brand id. GET /v1/me lists your organizations and their brands.",
      ...(isStaff ? {} : { organizations: memberships }),
    };
  }

  let candidates = [...orgsPerBrand[0]].filter((o) => orgsPerBrand.every((s) => s.has(o)));
  if (orgNamed) candidates = candidates.filter((o) => o === orgNamed);
  // Staff reach every org, but a brand claimed by many orgs (a popular domain)
  // would always be ambiguous: the orgs staff ACTUALLY belong to rank first, and
  // the platform-wide set is used only when none of them holds the brand.
  if (isStaff && !orgNamed && candidates.length > 1) {
    const own = candidates.filter((o) => memberships.some((m) => m.id === o));
    if (own.length > 0) candidates = own;
  }

  if (candidates.length === 1) return { orgId: candidates[0] };
  if (candidates.length === 0) {
    return {
      status: 400,
      code: "brands_span_orgs",
      error: "Brands are in different organizations",
      message: orgNamed
        ? `Organization ${orgNamed} does not hold every named brand (${brandIds.join(", ")}).`
        : `The named brands (${brandIds.join(", ")}) are not all held by one organization; a request acts in one organization.`,
      fix: "Send one request per organization.",
    };
  }
  const names = await fetchOrganizationNames(candidates);
  return {
    status: 400,
    code: "brand_in_several_orgs",
    error: "Organization target required",
    message: `Brand ${brandIds.join(", ")} is held by ${candidates.length} organizations this key can act in. Say which one.`,
    fix: "Add `?orgId=<id>` (or the `x-org-id` header) naming one of the organizations listed.",
    organizations: candidates.map((id) => names.find((n) => n.id === id) ?? { id, name: null }),
  };
}
