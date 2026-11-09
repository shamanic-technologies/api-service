import { Router, Response } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalServiceWithStatus, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * The MCP servers a brand gives to our conversation AI (BRAND-MCP-1109): the
 * dashboard v2 Integrations page and the distribute MCP list, plug, re-check and
 * unplug them here. Pass-through to chat-service `/orgs/brands/{brandId}/mcp-servers`,
 * same suffix:
 *
 *   GET    /v1/brands/:brandId/mcp-servers                      → { servers }
 *   POST   /v1/brands/:brandId/mcp-servers   {name, url, authorization?} → 201 { server }
 *   POST   /v1/brands/:brandId/mcp-servers/:serverId/check      → { server }
 *   DELETE /v1/brands/:brandId/mcp-servers/:serverId            → { deleted, id }
 *
 * `authenticate + requireOrg + requireUser`: chat-service's org tier requires
 * x-org-id, x-user-id and x-run-id, all from `buildInternalHeaders(req)` (the
 * AUTHENTICATED identity, never the caller's headers). The `:brandId` in the path
 * also selects the org for a user key (`src/lib/org-scope.ts`) and is sent as
 * `x-brand-id` (path wins over a caller header). chat-service scopes every row on
 * x-org-id + brandId. Body, query string, status and body back are forwarded
 * verbatim (rules #4, #7, #8, #11); chat-service owns the status vocabulary
 * (`connected` / `error`) and every refusal (400 bad URL or limit, 404, 409).
 *
 * The plug body carries a SECRET (`authorization`, the exact Authorization header
 * value of the brand's server). This file never logs a body; the customer call log
 * (`src/lib/call-log.ts`) redacts the field by name (`isSecretName`), pinned by
 * `tests/unit/brand-mcp-servers-proxy.behavior.test.ts`. No read ever returns it
 * (chat-service answers `hasAuthorization: boolean`).
 */
const router = Router();

/** The inbound query string, verbatim, with its `?` (rule #11). */
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

const enc = encodeURIComponent;

async function forward(
  req: AuthenticatedRequest,
  res: Response,
  method: "GET" | "POST" | "DELETE",
  suffix: string,
  fallback: string,
  withBody = false,
) {
  try {
    const headers = buildInternalHeaders(req);
    headers["x-brand-id"] = req.params.brandId;
    const { status, data } = await callExternalServiceWithStatus(
      externalServices.chat,
      `/orgs/brands/${enc(req.params.brandId)}/mcp-servers${suffix}${rawQueryString(req.originalUrl)}`,
      { method, headers, ...(withBody ? { body: req.body ?? {} } : {}) },
    );
    res.status(status).json(data);
  } catch (error: any) {
    // Never the request body here: it may carry the server's Authorization value.
    console.error(`[api-service] ${fallback}: upstream status ${error?.statusCode ?? "none"}`);
    respondUpstreamError(res, error, fallback);
  }
}

router.get(
  "/brands/:brandId/mcp-servers",
  authenticate,
  requireOrg,
  requireUser,
  (req: AuthenticatedRequest, res) => forward(req, res, "GET", "", "Failed to list the brand's MCP servers"),
);

router.post(
  "/brands/:brandId/mcp-servers",
  authenticate,
  requireOrg,
  requireUser,
  (req: AuthenticatedRequest, res) => forward(req, res, "POST", "", "Failed to plug the MCP server", true),
);

router.post(
  "/brands/:brandId/mcp-servers/:serverId/check",
  authenticate,
  requireOrg,
  requireUser,
  (req: AuthenticatedRequest, res) =>
    forward(req, res, "POST", `/${enc(req.params.serverId)}/check`, "Failed to check the MCP server"),
);

router.delete(
  "/brands/:brandId/mcp-servers/:serverId",
  authenticate,
  requireOrg,
  requireUser,
  (req: AuthenticatedRequest, res) =>
    forward(req, res, "DELETE", `/${enc(req.params.serverId)}`, "Failed to unplug the MCP server"),
);

export default router;
