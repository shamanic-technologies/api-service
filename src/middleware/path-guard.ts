import { Request, Response, NextFunction } from "express";

/**
 * Path-traversal guard (SECRETS-ROTATE-1127, security hotfix 2026-11-27). Mounted FIRST
 * in `src/index.ts`, before any router.
 *
 * On 2026-11-20/21 a signed-in customer escaped `/v1` with
 * `dashboard.distribute.you/api/v1/..%2f..%2finternal/admin/...`: a proxy decoded the
 * encoded slashes and `..` segments, the platform key it injects rode along, and the
 * staff table browser answered. No legitimate caller of this gateway sends a dot-segment,
 * a backslash or an encoded slash in a PATH, so any of them is refused 400 here, in every
 * spelling: raw (`..`, `\`), percent-encoded in any case (`%2e%2e`, `%2F`, `%5c`), and
 * multiply encoded (`%252f`). Each segment is decoded until stable; a segment that decodes
 * to `.`/`..` or contains `/` or `\`, or cannot be decoded at all, is refused.
 * The query string is not inspected (values there are data, never a route).
 */
const MAX_DECODE_PASSES = 5;

export function pathRefusalReason(rawPath: string): string | null {
  if (rawPath.includes("\\")) return "backslash";
  for (const segment of rawPath.split("/")) {
    let decoded = segment;
    for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
      if (decoded === "." || decoded === "..") return "dot_segment";
      if (decoded.includes("/") || decoded.includes("\\")) return "encoded_separator";
      if (!decoded.includes("%")) break;
      let next: string;
      try {
        next = decodeURIComponent(decoded);
      } catch {
        return "malformed_encoding";
      }
      if (next === decoded) break;
      decoded = next;
      if (pass === MAX_DECODE_PASSES - 1 && decoded.includes("%")) return "too_deeply_encoded";
    }
    if (decoded === "." || decoded === "..") return "dot_segment";
    if (decoded.includes("/") || decoded.includes("\\")) return "encoded_separator";
  }
  return null;
}

export function refuseTraversalPaths(req: Request, res: Response, next: NextFunction) {
  const raw = req.originalUrl ?? req.url ?? "";
  const queryAt = raw.indexOf("?");
  const rawPath = queryAt === -1 ? raw : raw.slice(0, queryAt);
  const reason = pathRefusalReason(rawPath);
  if (reason) {
    console.warn("[path-guard] refused request path", { reason, method: req.method, path: rawPath.slice(0, 300) });
    return res.status(400).json({
      error: "Invalid request path: dot-segments, backslashes and encoded slashes are not allowed",
      code: "invalid_path",
      reason,
    });
  }
  return next();
}
