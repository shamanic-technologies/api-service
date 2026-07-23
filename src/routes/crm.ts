import { Router } from "express";
import { authenticate, requireOrg, requireUser, AuthenticatedRequest } from "../middleware/auth.js";
import {
  callExternalService,
  forwardMultipartUpload,
  externalServices,
} from "../lib/service-client.js";
import { buildInternalHeaders } from "../lib/internal-headers.js";

/**
 * Transparent proxy of crm-service `/orgs/contacts/*` (client B2C CRM CSV
 * exports ingested as contacts, Bronze/Silver/Gold). Every sub-path is
 * forwarded verbatim — no path rename, no body transform, no field stripping,
 * no aggregation. Response is whatever crm-service returns (CLAUDE.md rules
 * #1/#2/#4/#6/#8). All routes are org+user scoped: the upload route requires
 * `x-user-id`, so `requireUser` is applied uniformly.
 *
 * Identity (org + user) is forwarded via `buildInternalHeaders`; the
 * `x-api-key: CRM_SERVICE_API_KEY` header is added by the service client. If
 * the crm-service env vars are unset the lazy getters throw with
 * `statusCode: 502`, so a deploy that lands before the Railway vars are set
 * degrades to a 502 on these routes only — never a boot-loop.
 *
 * The upload route is a MULTIPART file upload (a CSV, up to ~80K rows). The body
 * is buffered whole and forwarded via `forwardMultipartUpload` — the multipart
 * boundary stays intact (raw bytes copied verbatim) and undici sets a
 * `content-length` matching the buffered bytes. The global `express.json()`
 * only parses application/json, so the multipart body reaches the handler as an
 * untouched readable stream.
 *
 * crm-service `/internal/contacts/promote` is deliberately NOT proxied — it is
 * an internal-tier route, not a dashboard path (CLAUDE.md rule #3).
 */
const router = Router();

const authChain = [authenticate, requireOrg, requireUser] as const;

function fail(res: import("express").Response, error: any, msg: string): void {
  console.error(`[api-service] ${msg}:`, error);
  res.status(error.statusCode || 500).json({ error: error.message || msg });
}

// POST /v1/orgs/contacts/upload → crm-service POST /orgs/contacts/upload
// Multipart CSV upload buffered + forwarded untouched.
router.post("/orgs/contacts/upload", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const { status, data } = await forwardMultipartUpload(externalServices.crm, "/orgs/contacts/upload", {
      req,
      headers: buildInternalHeaders(req),
    });
    res.status(status).json(data);
  } catch (error: any) {
    fail(res, error, "Upload contacts error");
  }
});

// GET /v1/orgs/contacts → crm-service GET /orgs/contacts (list silver contacts for a brand)
router.get("/orgs/contacts", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const brandId = req.query?.brandId;
    const qs = typeof brandId === "string" && brandId.length > 0 ? `?brandId=${encodeURIComponent(brandId)}` : "";
    const result = await callExternalService(externalServices.crm, `/orgs/contacts${qs}`, {
      headers: buildInternalHeaders(req),
    });
    res.json(result);
  } catch (error: any) {
    fail(res, error, "List contacts error");
  }
});

// GET /v1/orgs/contacts/uploads → crm-service GET /orgs/contacts/uploads (list uploads + status)
router.get("/orgs/contacts/uploads", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const brandId = req.query?.brandId;
    const qs = typeof brandId === "string" && brandId.length > 0 ? `?brandId=${encodeURIComponent(brandId)}` : "";
    const result = await callExternalService(externalServices.crm, `/orgs/contacts/uploads${qs}`, {
      headers: buildInternalHeaders(req),
    });
    res.json(result);
  } catch (error: any) {
    fail(res, error, "List contact uploads error");
  }
});

// GET /v1/orgs/contacts/serve-stats → crm-service GET /orgs/contacts/serve-stats
// (served / remainingSendable / totalSendable counts for a brand)
router.get("/orgs/contacts/serve-stats", ...authChain, async (req: AuthenticatedRequest, res) => {
  try {
    const brandId = req.query?.brandId;
    const qs = typeof brandId === "string" && brandId.length > 0 ? `?brandId=${encodeURIComponent(brandId)}` : "";
    const result = await callExternalService(externalServices.crm, `/orgs/contacts/serve-stats${qs}`, {
      headers: buildInternalHeaders(req),
    });
    res.json(result);
  } catch (error: any) {
    fail(res, error, "Contact serve-stats error");
  }
});

export default router;
