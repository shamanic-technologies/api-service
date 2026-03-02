import { AuthenticatedRequest } from "../middleware/auth.js";

/**
 * Build headers for internal service-to-service calls
 * Convention:
 * - x-org-id: Internal org UUID (when available)
 * - x-user-id: Internal user UUID (when available)
 * - x-app-id: App ID (when available)
 * - x-key-source: Resolved key source from billing-service (when available)
 */
export function buildInternalHeaders(req: AuthenticatedRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  if (req.orgId) headers["x-org-id"] = req.orgId;
  if (req.userId) headers["x-user-id"] = req.userId;
  if (req.appId) headers["x-app-id"] = req.appId;
  if (req.keySource) headers["x-key-source"] = req.keySource;
  return headers;
}
