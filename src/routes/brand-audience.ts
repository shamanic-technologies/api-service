import { Router, type Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, pipeExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

/**
 * CUSTOMER reads of a brand's Audience page: the lists we source the brand's people
 * from, what each holds, and the net $ invested in sourcing. The staff twins live in
 * src/routes/admin-brands.ts (`/v1/admin/brands/:brandId/...`, cross-org, vendor cost)
 * and are untouched; these are the same six reads for an ordinary org member.
 *
 * ORG SCOPING, three layers, none of them a heuristic:
 *   1. The org is the AUTHENTICATED one (authenticate + requireOrg). For a user key,
 *      authenticate already resolves the org from `:brandId` among the user's own orgs.
 *   2. Ownership gate: the brand must be one of the org's brands at brand-service
 *      (`GET /orgs/brands`, org_brands membership under x-org-id), else 404
 *      `brand_not_in_org` and NO data read is made. Brand ownership is many-to-many
 *      (org_brands: one domain can be claimed by several orgs), so "it is my brand"
 *      does not make a per-brand read "my data" by itself, hence layer 3.
 *   3. Each data read is scoped to that org by its producer: human-service's snapshot
 *      takes `orgId` (filters audiences.org_id) and the gateway SETS it to the
 *      authenticated org, dropping any `orgId` the caller sent; features-service's
 *      sourcing investment is scoped on `x-org-id` from buildInternalHeaders.
 *
 * Deliberate exception to rule #4 (no body transform), owner-requested: the sourcing
 * investment bodies carry `vendorUsd`, what sourcing cost US at the vendor (our
 * margin). features-service serves no net-only view, so the gateway parses those
 * bodies and deletes every `vendorUsd` key at any depth before answering a customer.
 * Everything else is forwarded unchanged. The snapshot carries no money and stays a
 * byte pipe.
 *
 * Mounted BEFORE brandRoutes in src/index.ts (these paths point at services other
 * than brand-service).
 */

/** Raw query string minus every `orgId` key, without the leading `?` (rule #11 otherwise). */
function queryWithoutOrgId(originalUrl: string): string[] {
  const index = originalUrl.indexOf("?");
  if (index === -1) return [];
  return originalUrl
    .slice(index + 1)
    .split("&")
    .filter((part) => {
      if (part === "") return false;
      const rawKey = part.split("=")[0];
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      } catch {
        // Malformed escape: keep the raw key; it cannot spell orgId anyway.
      }
      return key !== "orgId";
    });
}

/** Deletes every `vendorUsd` key, at any depth, in place. Returns the same value. */
export function stripVendorCost<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) stripVendorCost(item);
  } else if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    delete obj.vendorUsd;
    for (const key of Object.keys(obj)) stripVendorCost(obj[key]);
  }
  return value;
}

/**
 * 404 unless the brand is one of the authenticated org's brands at brand-service.
 * Returns true when the caller may proceed; otherwise the response has been sent.
 */
async function ensureBrandInOrg(req: AuthenticatedRequest, res: Response, brandId: string): Promise<boolean> {
  const result = await callExternalService<{ brands?: Array<{ id?: unknown }> }>(
    externalServices.brand,
    "/orgs/brands",
    { headers: buildInternalHeaders(req) },
  );
  if (!Array.isArray(result?.brands)) {
    console.error("[api-service] brand ownership check: brand-service /orgs/brands returned no brands array", {
      brandId,
      orgId: req.orgId,
    });
    res.status(502).json({ error: "Could not verify brand ownership" });
    return false;
  }
  if (!result.brands.some((b) => b?.id === brandId)) {
    res.status(404).json({
      error: "Brand not found in this organization",
      code: "brand_not_in_org",
      fix: "Use a brand id from GET /v1/brands for the organization you act in.",
    });
    return false;
  }
  return true;
}

// GET /v1/brands/:brandId/audience-snapshot[/people|/companies]
// → human-service GET /internal/brands/{brandId}/audience-snapshot*?orgId=<authenticated org>
const AUDIENCE_SNAPSHOT_READS = [
  { suffix: "", label: "brand audience snapshot" },
  { suffix: "/people", label: "brand held people" },
  { suffix: "/companies", label: "brand held companies" },
] as const;

for (const { suffix, label } of AUDIENCE_SNAPSHOT_READS) {
  router.get(
    `/brands/:brandId/audience-snapshot${suffix}`,
    authenticate,
    requireOrg,
    requireUser,
    async (req: AuthenticatedRequest, res) => {
      const brandId = req.params.brandId as string;
      try {
        if (!(await ensureBrandInOrg(req, res, brandId))) return;
        const query = [...queryWithoutOrgId(req.originalUrl), `orgId=${encodeURIComponent(req.orgId as string)}`];
        await pipeExternalService(
          externalServices.human,
          `/internal/brands/${encodeURIComponent(brandId)}/audience-snapshot${suffix}?${query.join("&")}`,
          { headers: buildInternalHeaders(req), expressRes: res },
        );
      } catch (error: any) {
        if (res.headersSent) { res.end(); return; }
        console.error(`[api-service] Read ${label} error:`, error, { brandId, orgId: req.orgId });
        respondUpstreamError(res, error, `Failed to read ${label}`);
      }
    },
  );
}

// GET /v1/brands/:brandId/sourcing-investment[/people|/companies]
// → features-service GET /brands/{brandId}/sourcing-investment* (x-org-id scoped), vendorUsd removed.
const SOURCING_INVESTMENT_READS = [
  { suffix: "", label: "brand sourcing investment" },
  { suffix: "/people", label: "brand sourcing investment per person" },
  { suffix: "/companies", label: "brand sourcing investment per company" },
] as const;

for (const { suffix, label } of SOURCING_INVESTMENT_READS) {
  router.get(
    `/brands/:brandId/sourcing-investment${suffix}`,
    authenticate,
    requireOrg,
    requireUser,
    async (req: AuthenticatedRequest, res) => {
      const brandId = req.params.brandId as string;
      try {
        if (!(await ensureBrandInOrg(req, res, brandId))) return;
        const qIndex = req.originalUrl.indexOf("?");
        const rawQuery = qIndex === -1 ? "" : req.originalUrl.slice(qIndex);
        const result = await callExternalService<unknown>(
          externalServices.features,
          `/brands/${encodeURIComponent(brandId)}/sourcing-investment${suffix}${rawQuery}`,
          { headers: buildInternalHeaders(req) },
        );
        res.json(stripVendorCost(result));
      } catch (error: any) {
        console.error(`[api-service] Read ${label} error:`, error, { brandId, orgId: req.orgId });
        respondUpstreamError(res, error, `Failed to read ${label}`);
      }
    },
  );
}

export default router;
