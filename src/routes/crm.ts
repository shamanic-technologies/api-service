import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import {
  callExternalService,
  forwardMultipartUpload,
  externalServices,
} from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * Transparent proxy of crm-service's org-scoped surface. crm-service now holds
 * TWO contact sources behind the same registry and the same bronze/silver/gold
 * layering:
 *
 *   - `/orgs/contacts/*`  — CSV uploads a client exports out of their own CRM
 *   - `/orgs/matrix/*`    — inbound WhatsApp / Telegram / Discord DMs, bridged
 *                           into the Matrix homeserver on the box
 *
 * Every sub-path is forwarded verbatim — no path rename, no body transform, no
 * field stripping, no aggregation, no query-param whitelist (CLAUDE.md rules
 * #1/#2/#4/#6/#8). The whole inbound query string is byte-copied, so a filter
 * crm-service adds later (it already serves `limit`, `offset`, `uploadIds`,
 * `status`) arrives with no change here.
 *
 * Identity is forwarded via `buildInternalHeaders`; `x-api-key: CRM_SERVICE_API_KEY`
 * is added by the service client. The crm-service env getters are lazy, so a
 * deploy landing before the vars are set degrades to a 502 on these routes only,
 * never a boot-loop.
 *
 * The upload route is a MULTIPART file upload (a CSV, up to ~80K rows). The body
 * is buffered whole and forwarded via `forwardMultipartUpload` — the multipart
 * boundary stays intact (raw bytes copied verbatim) and undici sets a
 * `content-length` matching the buffered bytes. The global `express.json()` only
 * parses application/json, so the multipart body reaches the handler as an
 * untouched readable stream.
 *
 * crm-service's `/internal/*` routes — `contacts/promote`, `matrix/sync`,
 * `matrix/rebuild` — are deliberately NOT proxied. They are its service-to-service
 * tier, driven by a cron on the box, not by a browser (CLAUDE.md rule #3).
 *
 * Auth tier per route mirrors crm-service's own: everything is org-scoped, and
 * the two routes crm-service guards with `requireOrgAndUser` (the CSV upload and
 * the Matrix connection create, which persists the creator on the row) also carry
 * `requireUser` here.
 */
const router = Router();

const orgChain = [authenticate, requireOrg] as const;
const orgUserChain = [authenticate, requireOrg, requireUser] as const;

/**
 * The inbound query string, verbatim, including the leading `?` (empty when there
 * is none). Read off `req.originalUrl` rather than re-serialized from `req.query`:
 * re-serializing imposes this gateway's opinion on repeated keys, ordering and
 * encoding, and silently drops anything the gateway does not know about.
 * `?uploadIds=a&uploadIds=b` is exactly the shape that breaks under re-serialization.
 */
function rawQueryString(originalUrl: string): string {
  const index = originalUrl.indexOf("?");
  return index === -1 ? "" : originalUrl.slice(index);
}

// ─── CSV contact ingest ──────────────────────────────────────────────────────

// POST /v1/orgs/contacts/upload → crm-service POST /orgs/contacts/upload
// Multipart CSV buffered + forwarded untouched. Requires x-user-id.
router.post("/orgs/contacts/upload", ...orgUserChain, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await forwardMultipartUpload(
      externalServices.crm,
      "/orgs/contacts/upload",
      { req, headers: buildInternalHeaders(req) },
    );
    res.status(status).json(data);
  } catch (error) {
    console.error("[api-service] Upload contacts error:", error);
    respondUpstreamError(res, error, "Upload contacts error");
  }
});

// GET /v1/orgs/contacts → crm-service GET /orgs/contacts (silver contacts for a brand)
router.get("/orgs/contacts", ...orgChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.crm,
      `/orgs/contacts${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error) {
    console.error("[api-service] List contacts error:", error);
    respondUpstreamError(res, error, "List contacts error");
  }
});

// GET /v1/orgs/contacts/uploads → crm-service GET /orgs/contacts/uploads
router.get("/orgs/contacts/uploads", ...orgChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.crm,
      `/orgs/contacts/uploads${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error) {
    console.error("[api-service] List contact uploads error:", error);
    respondUpstreamError(res, error, "List contact uploads error");
  }
});

// GET /v1/orgs/contacts/serve-stats → crm-service GET /orgs/contacts/serve-stats
router.get("/orgs/contacts/serve-stats", ...orgChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.crm,
      `/orgs/contacts/serve-stats${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error) {
    console.error("[api-service] Contact serve-stats error:", error);
    respondUpstreamError(res, error, "Contact serve-stats error");
  }
});

// POST /v1/orgs/contacts/serve-next → crm-service POST /orgs/contacts/serve-next
// Body forwarded verbatim — crm-service owns its shape.
router.post("/orgs/contacts/serve-next", ...orgChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(externalServices.crm, "/orgs/contacts/serve-next", {
      method: "POST",
      body: req.body,
      headers: buildInternalHeaders(req),
    });
    res.json(result);
  } catch (error) {
    console.error("[api-service] Contact serve-next error:", error);
    respondUpstreamError(res, error, "Contact serve-next error");
  }
});

// ─── Matrix DM ingest (WhatsApp / Telegram / Discord) ────────────────────────

// POST /v1/orgs/matrix/connections → crm-service POST /orgs/matrix/connections
// Requires x-user-id: crm-service persists the creator on the connection row.
router.post("/orgs/matrix/connections", ...orgUserChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(externalServices.crm, "/orgs/matrix/connections", {
      method: "POST",
      body: req.body,
      headers: buildInternalHeaders(req),
    });
    res.json(result);
  } catch (error) {
    console.error("[api-service] Create matrix connection error:", error);
    respondUpstreamError(res, error, "Create matrix connection error");
  }
});

// PATCH /v1/orgs/matrix/connections/:id → crm-service PATCH /orgs/matrix/connections/{id}
router.patch(
  "/orgs/matrix/connections/:id",
  ...orgChain,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await callExternalService(
        externalServices.crm,
        `/orgs/matrix/connections/${encodeURIComponent(req.params.id)}`,
        { method: "PATCH", body: req.body, headers: buildInternalHeaders(req) },
      );
      res.json(result);
    } catch (error) {
      console.error("[api-service] Update matrix connection error:", error);
      respondUpstreamError(res, error, "Update matrix connection error");
    }
  },
);

// GET /v1/orgs/matrix/connections → crm-service GET /orgs/matrix/connections
router.get("/orgs/matrix/connections", ...orgChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.crm,
      `/orgs/matrix/connections${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error) {
    console.error("[api-service] List matrix connections error:", error);
    respondUpstreamError(res, error, "List matrix connections error");
  }
});

// GET /v1/orgs/matrix/leads → crm-service GET /orgs/matrix/leads
router.get("/orgs/matrix/leads", ...orgChain, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await callExternalService(
      externalServices.crm,
      `/orgs/matrix/leads${rawQueryString(req.originalUrl)}`,
      { headers: buildInternalHeaders(req) },
    );
    res.json(result);
  } catch (error) {
    console.error("[api-service] List matrix leads error:", error);
    respondUpstreamError(res, error, "List matrix leads error");
  }
});

export default router;
