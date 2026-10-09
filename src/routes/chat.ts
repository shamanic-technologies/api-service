import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import { callExternalService, streamExternalService, externalServices } from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

const router = Router();

// PUT /v1/chat/config — register chat config
router.put("/chat/config", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.chat,
      "/config",
      { method: "PUT", body: req.body, headers: buildInternalHeaders(req) }
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to register chat config" });
  }
});

// The raw query string (with its leading "?") or "" — forwarded verbatim per
// CLAUDE.md rule #11, never rebuilt from a destructured whitelist.
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

// GET /v1/chat/sessions/latest?configKey=<key> — the caller's most recently active
// chat session for one chat config key, with its full history (same body as the
// per-id read). Lets a chat panel restore the same conversation on any device.
// chat-service scopes the lookup on the forwarded org AND user identity.
//
// MUST be registered BEFORE "/chat/sessions/:sessionId" (CLAUDE.md rule #13):
// Express would otherwise capture "latest" as a sessionId and drop the query.
// Upstream status + body are forwarded as-is: 404 = "this user has no session for
// that key yet" (a normal first visit), 400 = configKey missing.
router.get(
  "/chat/sessions/latest",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.chat,
        `/sessions/latest${rawQueryString(req.originalUrl)}`,
        { method: "GET", headers: buildInternalHeaders(req) }
      );
      res.json(result);
    } catch (error: unknown) {
      respondUpstreamError(res, error, "Failed to fetch latest chat session");
    }
  }
);

// GET /v1/chat/sessions/:sessionId — read a chat session's stored conversation
// history. Lets the dashboard "Edit with AI" panel restore its visible chat
// after a page refresh. Org identity is forwarded; chat-service returns 404 for
// a session belonging to another org (existence not leaked across orgs).
router.get(
  "/chat/sessions/:sessionId",
  authenticate,
  requireOrg,
  requireUser,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.chat,
        `/sessions/${encodeURIComponent(req.params.sessionId)}`,
        { method: "GET", headers: buildInternalHeaders(req) }
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch chat session history" });
    }
  }
);

// POST /v1/chat — stream AI response via SSE
router.post("/chat", authenticate, requireOrg, requireUser, async (req: AuthenticatedRequest, res) => {
  try {
    // Chat-service requires sessionId to be omitted (not null) to create a new session.
    // The dashboard sends sessionId: null after "Reset Chat", so strip it here.
    const { sessionId, ...rest } = req.body;
    const body = sessionId ? { ...rest, sessionId } : rest;

    await streamExternalService(
      externalServices.chat,
      "/chat",
      {
        method: "POST",
        body,
        headers: buildInternalHeaders(req),
        expressRes: res,
      }
    );
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Failed to stream chat response" });
    }
  }
});

export default router;
