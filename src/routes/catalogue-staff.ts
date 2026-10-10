import { Router } from "express";
import { authenticatePlatform, requireStaff, AuthenticatedRequest } from "../middleware/auth.js";
import { pipeExternalService, externalServices } from "../lib/service-client.js";
import { respondUpstreamError } from "../lib/upstream-error.js";

// Staff-only reads of features-service's agent catalogue (`/internal/catalogue/*`, features-service
// PR #1482): steps, sales paths, channels, pipes, sales funnels and workflows, each a small LIST
// (`q`, `limit` <= 25, the "contains at least one" filters) and ONE object by id. Behind the
// dashboard v2 Staff sections (one per business object: an overview, the ongoing ones, a page
// each). Fleet-wide, no org scoping: the producer takes no identity. Gate: authenticatePlatform +
// requireStaff, like every other staff Monitoring route. Status + body piped byte-for-byte (#10),
// errors field-for-field (#7), query string verbatim (#11).
const router = Router();

/** The six catalogue objects features-service serves, in its own path spelling. */
export const CATALOGUE_OBJECTS = ["steps", "sales-paths", "channels", "pipes", "sales-funnels", "workflows"] as const;

/** Raw query string (with its `?`) off the original URL, forwarded verbatim (#11). */
function rawQueryString(originalUrl: string): string {
  const i = originalUrl.indexOf("?");
  return i === -1 ? "" : originalUrl.slice(i);
}

async function pipe(res: import("express").Response, path: string, fallback: string) {
  try {
    await pipeExternalService(externalServices.features, path, { expressRes: res });
  } catch (error: any) {
    console.error(`[api-service] ${fallback}:`, error.message);
    if (res.headersSent) { res.end(); return; }
    respondUpstreamError(res, error, fallback);
  }
}

// One explicit route per downstream path (no catch-all): the list, then the object by id.
for (const object of CATALOGUE_OBJECTS) {
  /** GET /v1/catalogue/<object> → features-service GET /internal/catalogue/<object> (one page of rows). */
  router.get(`/v1/catalogue/${object}`, authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
    pipe(res, `/internal/catalogue/${object}${rawQueryString(req.originalUrl)}`, `Failed to list catalogue ${object}`),
  );

  /**
   * GET /v1/catalogue/<object>/:id → features-service GET /internal/catalogue/<object>/:id (one object).
   * Express decodes the id, so it is re-encoded on the way down: a sales path id carries `+`
   * (sent as `%2B`, never a space) and a pipe id carries `|`. A workflow needs `?pipe=`, which
   * rides the verbatim query string.
   */
  router.get(`/v1/catalogue/${object}/:id`, authenticatePlatform, requireStaff, (req: AuthenticatedRequest, res) =>
    pipe(
      res,
      `/internal/catalogue/${object}/${encodeURIComponent(req.params.id)}${rawQueryString(req.originalUrl)}`,
      `Failed to read catalogue ${object}`,
    ),
  );
}

export default router;
