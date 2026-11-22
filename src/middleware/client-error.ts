import type express from "express";

/**
 * GATEWAY-PARSE-400-1122: a client error raised BEFORE any route (body-parser's
 * malformed JSON, body too large, unsupported charset, or any error carrying a
 * 4xx status) is answered with that 4xx and a message naming what was wrong
 * with the request. Before, the fallback handler answered every such error
 * `500 Internal server error`, and an AI agent that double-encoded its JSON
 * body told a client "the email writer is down" (2026-11-22).
 *
 * Anything without a 4xx status falls through to the 500 handler unchanged.
 */

interface ClientErrorBody {
  error: string;
  code: string;
  fix?: string;
}

const BODY_PARSER_ERRORS: Record<string, (err: HttpishError) => ClientErrorBody> = {
  "entity.parse.failed": (err) => ({
    code: "invalid_json_body",
    error: `The request body is not valid JSON (${err.message}).`,
    fix: "Send the JSON object itself as the body with Content-Type: application/json. Do not JSON-encode it twice (a body that starts with a quote is a string, not an object).",
  }),
  "entity.too.large": () => ({
    code: "body_too_large",
    error: "The request body is larger than the 10 MB this API accepts.",
    fix: "Send a smaller body.",
  }),
  "encoding.unsupported": (err) => ({
    code: "unsupported_content_encoding",
    error: `The request body's Content-Encoding is not supported (${err.message}).`,
    fix: "Send the body uncompressed, or gzip / deflate / br.",
  }),
  "charset.unsupported": (err) => ({
    code: "unsupported_charset",
    error: `The request body's charset is not supported (${err.message}).`,
    fix: "Send the body as UTF-8.",
  }),
  "request.aborted": () => ({
    code: "request_aborted",
    error: "The request was aborted before its body was fully received.",
  }),
  "request.size.invalid": () => ({
    code: "body_size_mismatch",
    error: "The request body's size does not match its Content-Length header.",
    fix: "Send a Content-Length equal to the body's byte length, or omit it.",
  }),
};

interface HttpishError extends Error {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
  expose?: unknown;
}

export function clientErrorStatus(err: HttpishError): number | null {
  const raw = typeof err.status === "number" ? err.status : err.statusCode;
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= 400 && raw < 500 ? raw : null;
}

export function clientErrorHandler(
  err: HttpishError,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const status = clientErrorStatus(err);
  if (status === null || res.headersSent) {
    next(err);
    return;
  }
  const describe = typeof err.type === "string" ? BODY_PARSER_ERRORS[err.type] : undefined;
  const body: ClientErrorBody = describe
    ? describe(err)
    : {
        code: "bad_request",
        error: err.expose === false || !err.message ? `The request was refused (${status}).` : err.message,
      };
  console.warn(`[client-error] ${req.method} ${req.path} -> ${status} ${body.code}`);
  res.status(status).json(body);
}
