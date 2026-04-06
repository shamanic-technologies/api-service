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
 * Identity query params that map 1:1 to forwarded headers.
 * Each entry: [header-name, req property on AuthenticatedRequest, query param name]
 */
const IDENTITY_QUERY_MAP: Array<[string, keyof AuthenticatedRequest, string]> = [
  ["x-brand-id", "brandId", "brandId"],
  ["x-campaign-id", "campaignId", "campaignId"],
  ["x-feature-slug", "featureSlug", "featureSlug"],
  ["x-workflow-slug", "workflowSlug", "workflowSlug"],
];

/**
 * Build headers for internal service-to-service calls.
 * Identity headers from the incoming request are forwarded.
 * brandId, campaignId, featureSlug, and workflowSlug are also read
 * from query params and promoted to headers so downstream services
 * always receive them. Throws 400 if header and query param conflict.
 */
export function buildInternalHeaders(req: AuthenticatedRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  if (req.orgId) headers["x-org-id"] = req.orgId;
  if (req.userId) headers["x-user-id"] = req.userId;
  if (req.runId) headers["x-run-id"] = req.runId;

  for (const [headerName, reqProp, queryParam] of IDENTITY_QUERY_MAP) {
    const resolved = resolveHeaderOrQuery(
      req[reqProp] as string | undefined,
      req.query?.[queryParam] as string | undefined,
      headerName,
    );
    if (resolved) headers[headerName] = resolved;
  }

  return headers;
}
