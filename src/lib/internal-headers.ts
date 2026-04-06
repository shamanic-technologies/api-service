import { AuthenticatedRequest } from "../middleware/auth.js";

/**
 * Resolve a value from both header and query param sources.
 * If both exist and conflict, throw a 400 error.
 * If only one exists, return it. If neither, return undefined.
 */
function resolveHeaderOrQuery(
  headerVal: string | undefined,
  queryVal: string | undefined,
  name: string,
): string | undefined {
  if (headerVal && queryVal && headerVal !== queryVal) {
    const err: any = new Error(
      `Conflict: header ${name} (${headerVal}) does not match query param (${queryVal})`,
    );
    err.statusCode = 400;
    throw err;
  }
  return headerVal || queryVal;
}

/**
 * Build headers for internal service-to-service calls.
 * Identity headers from the incoming request are forwarded.
 * brandId and campaignId are also read from query params and promoted
 * to headers so downstream services always receive them.
 */
export function buildInternalHeaders(req: AuthenticatedRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  if (req.orgId) headers["x-org-id"] = req.orgId;
  if (req.userId) headers["x-user-id"] = req.userId;
  if (req.runId) headers["x-run-id"] = req.runId;
  if (req.workflowSlug) headers["x-workflow-slug"] = req.workflowSlug;
  if (req.featureSlug) headers["x-feature-slug"] = req.featureSlug;

  const brandId = resolveHeaderOrQuery(
    req.brandId,
    req.query?.brandId as string | undefined,
    "x-brand-id",
  );
  if (brandId) headers["x-brand-id"] = brandId;

  const campaignId = resolveHeaderOrQuery(
    req.campaignId,
    req.query?.campaignId as string | undefined,
    "x-campaign-id",
  );
  if (campaignId) headers["x-campaign-id"] = campaignId;

  return headers;
}
