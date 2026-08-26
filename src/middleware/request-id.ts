import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

/** Max accepted length of a caller-supplied correlation id. */
const MAX_LENGTH = 128;

/** Printable ASCII only — the value is echoed into a response header. */
const SAFE = /^[A-Za-z0-9._:\-]+$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id for this request — caller-supplied or generated here. */
      requestId?: string;
    }
  }
}

/**
 * Correlation id, accepted on every operation and echoed on every response.
 *
 * An agent that fans out concurrent calls has no other way to tie a response
 * (or a log line it later asks a human about) back to the call it made. The
 * caller's own value is used verbatim when it is a safe token; otherwise the
 * gateway mints a UUID, so the header is present on every response either way.
 *
 * Deliberately NOT forwarded downstream: the identity/tracking headers this
 * gateway forwards are a fixed, documented set (see the CLAUDE.md convention on
 * identity-enrichment headers), and adding a header to what downstream services
 * receive is a contract change on 24 services, not a gateway one.
 */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const supplied = req.headers["x-request-id"];
  const candidate = Array.isArray(supplied) ? supplied[0] : supplied;

  const id =
    typeof candidate === "string" &&
    candidate.length > 0 &&
    candidate.length <= MAX_LENGTH &&
    SAFE.test(candidate)
      ? candidate
      : randomUUID();

  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
