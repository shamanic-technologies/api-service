import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, externalServices } from "./service-client.js";
import { buildInternalHeaders } from "./internal-headers.js";

/**
 * 404 unless the brand is one of the authenticated org's brands at brand-service.
 * Returns true when the caller may proceed; otherwise the response has been sent.
 */
export async function ensureBrandInOrg(req: AuthenticatedRequest, res: Response, brandId: string): Promise<boolean> {
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
