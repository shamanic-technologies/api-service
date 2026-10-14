import { Router, type Response } from "express";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// The agent skill tree, READ-ONLY, for any authenticated caller (a client's key, their AI agent
// through the distribute MCP). It is the same markdown the Copilot loads to organize a client's
// request (chat-service `/internal/skills`), so a client's own agent can follow the same method.
// Writes and version history stay staff-only on /v1/chat/skills (src/routes/chat-skills-staff.ts).
//
// Gate: `authenticateUser`: the tree is the same for every client, not one org's data, so a
// multi-org key names no organization. Status + body piped byte-for-byte (#10), errors
// field-for-field (#7), query string verbatim (#11).
const router = Router();

/** Raw query string (with its `?`) off the original URL, forwarded verbatim (#11). */
function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
}

async function pipe(res: Response, path: string, fallback: string) {
  try {
    await pipeExternalService(externalServices.chat, path, { expressRes: res });
  } catch (error: any) {
    console.error(`[api-service] ${fallback}:`, error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, fallback);
  }
}

/** GET /v1/skills → chat-service GET /internal/skills: the tree (slug, parent, title, description), no content. */
router.get("/v1/skills", authenticateUser, (req: AuthenticatedRequest, res) =>
  pipe(res, `/internal/skills${rawQueryString(req.originalUrl)}`, "Failed to list skills"),
);

/** GET /v1/skills/:slug → chat-service GET /internal/skills/:slug: one skill with its markdown `content`. */
router.get("/v1/skills/:slug", authenticateUser, (req: AuthenticatedRequest, res) =>
  pipe(res, `/internal/skills/${encodeURIComponent(req.params.slug)}`, "Failed to read skill"),
);

export default router;
