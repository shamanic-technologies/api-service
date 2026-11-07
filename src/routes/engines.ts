import { Router } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { catalogueReader } from "./catalogue-staff.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

/**
 * GET /v1/engines/:outcome → workflow-service GET /internal/engines/{outcome} (CATALOGUE-FOR-CLIENTS-1107).
 *
 * An Engine is the one thing per outcome that makes it; its scripts compete in it (GET /v1/scripts?outcome=). This
 * read says whether the Engine runs campaigns: `live`, `scope` (fleet or org), the dynasty it was proven on, when it
 * was switched on or rolled back. A catalogue READ, same gate as the customer catalogue (`catalogueReader`): any
 * signed-in client (the dashboard's Catalogue page, a customer key) or staff.
 *
 * The catalogue is cross-org, so a client reads the FLEET answer, the same bytes staff get with no `orgId`: the
 * producer's optional `orgId` (one org's campaign switch) is dropped from a client's query, so no client can ask about
 * another org. Staff pass it as sent. Every other parameter rides verbatim (#11); status and body piped byte-for-byte
 * (#7, #10).
 */
const router = Router();

/** The raw query string without `orgId`; every other parameter byte-for-byte. */
export function withoutOrgId(rawQuery: string): string {
  const kept = rawQuery.replace(/^\?/, "").split("&").filter((part) => part !== "" && part.split("=")[0] !== "orgId");
  return kept.length ? `?${kept.join("&")}` : "";
}

function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
}

router.get("/v1/engines/:outcome", catalogueReader, async (req: AuthenticatedRequest, res) => {
  const raw = rawQueryString(req.originalUrl);
  const query = req.catalogueCustomer ? withoutOrgId(raw) : raw;
  try {
    await pipeExternalService(externalServices.workflow, `/internal/engines/${encodeURIComponent(req.params.outcome)}${query}`, {
      expressRes: res,
    });
  } catch (error: any) {
    console.error("[api-service] Failed to read engine:", error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, "Failed to read engine");
  }
});

export default router;
