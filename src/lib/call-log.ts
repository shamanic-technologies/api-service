/**
 * The customer call log: every call a client (or their AI assistant) makes to
 * this gateway with THEIR OWN key is a conversation with us, like a WhatsApp
 * thread or a Copilot chat (owner 2026-10-12). Each such call is recorded with
 * who made it, when, the channel (`api`, or `mcp` when our MCP server made it on
 * their behalf), what they asked (method, path, query, body) and what we
 * answered (status, body), and pushed to crm-service, which files it on that
 * person's thread in the staff Unibox (`POST /internal/api-calls`).
 *
 * Scope: user-key calls only (`Authorization: Bearer distrib.usr_...`, which is
 * what the MCP server sends too). The dashboard's own traffic (platform key)
 * is the client clicking our UI, not their assistant talking to us: never
 * recorded. A call refused before its key resolved to a user has no person to
 * file it under and is not recorded either.
 *
 * Never recorded either: reads of the API's own description (the openapi
 * catalogue, GET or HEAD, see HOUSEKEEPING_PATHS): machine housekeeping.
 *
 * Never recorded: the Authorization / x-api-key / cookie headers (only an
 * allow-list of harmless headers is kept), the key itself (the record carries a
 * one-way fingerprint), and any secret-looking field or value in the query,
 * request body or response body (`redactJson` / `redactText`).
 *
 * Bounded: each body is kept up to BODY_CAP_BYTES; a longer one keeps its first
 * BODY_CAP_BYTES, is marked truncated, and states its real size.
 *
 * Never slows or fails the client's call: the response bytes are copied (up to
 * the cap) as they are written, the record is built after the response has
 * finished, and records are pushed in batches off the request path. A push
 * failure is logged loud and retried once with the next batch; the client
 * never sees it. Records still queued when the process stops are lost (the
 * queue lives a few seconds at most).
 */

import { createHash, randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { namedBrandIds } from "./org-scope.js";
import { callExternalService, externalServices } from "./service-client.js";

/** Largest body (request or response) kept per call, in bytes. */
export const BODY_CAP_BYTES = 256 * 1024;

/** Header our MCP server sends on every call it makes for a client. */
export const CLIENT_HEADER = "x-distribute-client";
/** Optional header naming the MCP tool the call serves. */
export const MCP_TOOL_HEADER = "x-distribute-mcp-tool";

export const CALL_CHANNELS = ["api", "mcp"] as const;
export type CallChannel = (typeof CALL_CHANNELS)[number];

/** Request headers kept on the record. Everything else (auth above all) is dropped. */
const KEPT_HEADERS = [
  "content-type",
  "user-agent",
  "x-request-id",
  "x-org-id",
  "x-brand-id",
  CLIENT_HEADER,
  MCP_TOOL_HEADER,
] as const;

export interface CallRecord {
  callId: string;
  channel: CallChannel;
  mcpTool: string | null;
  orgId: string | null;
  userId: string;
  email: string | null;
  displayName: string | null;
  /** First 16 hex chars of sha256(key): tells keys apart, cannot be turned back into one. */
  keyFingerprint: string | null;
  brandIds: string[];
  method: string;
  path: string;
  query: Record<string, unknown>;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  requestBodyBytes: number;
  requestBodyTruncated: boolean;
  status: number;
  responseContentType: string | null;
  responseBody: string | null;
  responseBodyBytes: number;
  responseBodyTruncated: boolean;
  durationMs: number;
  at: string;
  requestId: string | null;
  runId: string | null;
}

// ─── redaction (pure) ───────────────────────────────────────────────────────

export const REDACTED = "[redacted]";

/** Field names whose value is a secret, compared on the snake_case form of the name. */
const SECRET_NAME =
  /(^|_)(password|passwd|passphrase|secret|token|api_?key|authorization|auth|cookie|credentials?|private_key|session_key|access_key|signature)$/;

/** Secret-looking VALUES, wherever they appear (a key echoed back on creation included). */
const SECRET_VALUES: RegExp[] = [
  /distrib\.usr_[A-Za-z0-9_\-]+/g,
  /\bBearer\s+[A-Za-z0-9._~+/=\-]+/gi,
  /\b(?:sk|rk|pk)[-_](?:live|test|ant|proj)[-_][A-Za-z0-9_\-]{8,}/g,
  /\bsk-[A-Za-z0-9_\-]{20,}/g,
  /\b(?:ghp|gho|ghs|github_pat|xox[abpr])[-_][A-Za-z0-9_\-]{10,}/g,
];

function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s.]+/g, "_")
    .toLowerCase();
}

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(snake(name));
}

export function redactText(text: string): string {
  let out = text;
  for (const re of SECRET_VALUES) out = out.replace(re, REDACTED);
  // A secret-named JSON field inside text that is not parseable JSON (a truncated body).
  out = out.replace(/("([^"\\]{1,80})"\s*:\s*)"(?:[^"\\]|\\.)*"/g, (m, head: string, name: string) =>
    isSecretName(name) ? `${head}"${REDACTED}"` : m,
  );
  return out;
}

export function redactJson(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretName(k) && v !== null && v !== undefined ? REDACTED : redactJson(v);
    }
    return out;
  }
  return value;
}

export function keepHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const v = headers[name];
    const value = Array.isArray(v) ? v.join(", ") : v;
    if (typeof value === "string" && value) out[name] = redactText(value);
  }
  return out;
}

/** A body as stored: redacted, then cut at BODY_CAP_BYTES. */
export function boundBody(text: string, totalBytes: number): { body: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= BODY_CAP_BYTES && totalBytes <= BODY_CAP_BYTES) return { body: text, truncated: false };
  // Cut on a code-point boundary: decoding a cut multi-byte char yields U+FFFD, drop it.
  const cut = buf.subarray(0, BODY_CAP_BYTES).toString("utf8").replace(/\uFFFD$/, "");
  return { body: cut, truncated: true };
}

/** The request body as recorded (JSON bodies are parsed by express.json before routes). */
export function recordRequestBody(req: Request): { body: string | null; bytes: number; truncated: boolean } {
  const contentType = String(req.headers["content-type"] ?? "");
  const declared = Number(req.headers["content-length"] ?? 0) || 0;
  if (contentType.startsWith("multipart/")) {
    return { body: `[multipart body not recorded: ${declared} bytes]`, bytes: declared, truncated: false };
  }
  const raw = req.body;
  if (raw === undefined || raw === null) return { body: null, bytes: declared, truncated: false };
  if (typeof raw === "object" && !Buffer.isBuffer(raw) && Object.keys(raw).length === 0 && declared === 0) {
    return { body: null, bytes: 0, truncated: false };
  }
  const text = Buffer.isBuffer(raw)
    ? redactText(raw.toString("utf8"))
    : typeof raw === "string"
      ? redactText(raw)
      : JSON.stringify(redactJson(raw));
  const bytes = declared || Buffer.byteLength(text, "utf8");
  const { body, truncated } = boundBody(text, bytes);
  return { body, bytes, truncated };
}

/** The response body as recorded, from the bytes captured while it was written. */
export function recordResponseBody(
  captured: Buffer,
  totalBytes: number,
  contentType: string | null,
): { body: string | null; truncated: boolean } {
  if (totalBytes === 0) return { body: null, truncated: false };
  const text = captured.toString("utf8");
  const complete = totalBytes <= BODY_CAP_BYTES;
  let redacted: string;
  if (complete && contentType?.includes("json")) {
    try {
      redacted = JSON.stringify(redactJson(JSON.parse(text)));
    } catch {
      redacted = redactText(text);
    }
  } else {
    redacted = redactText(text);
  }
  return boundBody(redacted, totalBytes);
}

export function keyFingerprint(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const key = authorization.slice(7).trim();
  if (!key) return null;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function callChannel(headers: Record<string, string | string[] | undefined>): CallChannel {
  const v = headers[CLIENT_HEADER];
  const value = (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase();
  return value === "mcp" ? "mcp" : "api";
}

// ─── housekeeping (never recorded) ──────────────────────────────────────────

/**
 * The API's own description: the openapi catalogue documents. A client (our MCP
 * server above all) reads or revalidates them before its real calls to learn
 * what it may call. That is machine housekeeping, not something the person
 * asked us, so it is never filed on their thread and never starts a
 * conversation (owner 2026-10-12).
 */
export const HOUSEKEEPING_PATHS: ReadonlySet<string> = new Set([
  "/openapi.json",
  "/public/openapi.json",
  "/internal/openapi.json",
  "/v1/me/openapi.json",
]);

/** A GET/HEAD of a catalogue document (query string and a trailing slash ignored). */
export function isHousekeepingCall(method: string, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const [path] = url.split("?");
  const bare = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return HOUSEKEEPING_PATHS.has(bare);
}

// ─── capture middleware ─────────────────────────────────────────────────────

/**
 * Mounted once before every route. Only a request carrying a Bearer credential
 * is watched (anything else costs one header read); its response bytes are
 * copied up to the cap as they go out, and the record is queued once the
 * response has finished and the route's `authenticate` has said whose key it was.
 */
export function recordCustomerCalls(req: Request, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return next();
  if (isHousekeepingCall(req.method, req.originalUrl)) return next();

  const startedAt = Date.now();
  const chunks: Buffer[] = [];
  let captured = 0;
  let total = 0;
  const capture = (chunk: unknown, encoding?: unknown) => {
    if (chunk === undefined || chunk === null || typeof chunk === "function") return;
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : Buffer.from(String(chunk), typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8");
    total += buf.length;
    if (captured < BODY_CAP_BYTES) {
      const slice = buf.subarray(0, BODY_CAP_BYTES - captured);
      chunks.push(slice);
      captured += slice.length;
    }
  };

  const originalWrite = res.write;
  const originalEnd = res.end;
  res.write = function (this: Response, chunk: unknown, ...rest: unknown[]) {
    try {
      capture(chunk, rest[0]);
    } catch (err) {
      console.error("[call-log] response capture failed (call unaffected):", (err as Error).message);
    }
    return (originalWrite as (...a: unknown[]) => boolean).call(this, chunk, ...rest);
  } as Response["write"];
  res.end = function (this: Response, chunk?: unknown, ...rest: unknown[]) {
    try {
      capture(chunk, rest[0]);
    } catch (err) {
      console.error("[call-log] response capture failed (call unaffected):", (err as Error).message);
    }
    return (originalEnd as (...a: unknown[]) => Response).call(this, chunk, ...rest);
  } as Response["end"];

  res.on("finish", () => {
    setImmediate(() => {
      try {
        const record = buildRecord(req as AuthenticatedRequest, res, Buffer.concat(chunks), total, startedAt);
        if (record) enqueueCall(record);
      } catch (err) {
        console.error("[call-log] could not build the call record (call unaffected):", (err as Error).message);
      }
    });
  });
  next();
}

function buildRecord(
  req: AuthenticatedRequest,
  res: Response,
  captured: Buffer,
  totalBytes: number,
  startedAt: number,
): CallRecord | null {
  // Only a call whose key resolved to a user is someone's conversation.
  if (req.authType !== "user_key" || !req.userId) return null;
  const [path] = req.originalUrl.split("?");
  const contentType = (res.getHeader("content-type") as string | undefined) ?? null;
  const request = recordRequestBody(req);
  const response = recordResponseBody(captured, totalBytes, contentType);
  const channel = callChannel(req.headers);
  const toolHeader = req.headers[MCP_TOOL_HEADER];
  const mcpTool = channel === "mcp" && typeof toolHeader === "string" && toolHeader.trim() ? toolHeader.trim().slice(0, 200) : null;
  let brandIds: string[] = [];
  try {
    brandIds = namedBrandIds(req).slice(0, 50);
  } catch {
    brandIds = [];
  }
  return {
    callId: randomUUID(),
    channel,
    mcpTool,
    orgId: req.orgId ?? null,
    userId: req.userId,
    email: req.userKeyScope?.email ?? null,
    displayName: req.userKeyScope?.displayName ?? null,
    keyFingerprint: keyFingerprint(req.headers.authorization),
    brandIds,
    method: req.method,
    path,
    query: redactJson(req.query ?? {}) as Record<string, unknown>,
    requestHeaders: keepHeaders(req.headers),
    requestBody: request.body,
    requestBodyBytes: request.bytes,
    requestBodyTruncated: request.truncated,
    status: res.statusCode,
    responseContentType: contentType,
    responseBody: response.body,
    responseBodyBytes: totalBytes,
    responseBodyTruncated: response.truncated,
    durationMs: Date.now() - startedAt,
    at: new Date(startedAt).toISOString(),
    requestId: req.requestId ?? null,
    runId: req.runId ?? null,
  };
}

// ─── batched push to crm-service ────────────────────────────────────────────

export const FLUSH_INTERVAL_MS = 2_000;
export const BATCH_SIZE = 50;
/** A batch stops growing past this many serialized bytes (crm-service accepts 16 MB on this route). */
export const BATCH_MAX_BYTES = 6 * 1024 * 1024;
export const QUEUE_CAP = 2_000;

interface Queued {
  record: CallRecord;
  attempts: number;
}

const queue: Queued[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing = false;

export function enqueueCall(record: CallRecord) {
  queue.push({ record, attempts: 0 });
  if (queue.length > QUEUE_CAP) {
    const dropped = queue.splice(0, queue.length - QUEUE_CAP);
    console.error(`[call-log] queue over ${QUEUE_CAP}: dropped ${dropped.length} oldest call record(s), crm-service is not keeping up`);
  }
  if (!timer) {
    timer = setInterval(() => {
      void flushCalls();
    }, FLUSH_INTERVAL_MS);
    timer.unref();
  }
}

/** Push everything queued, BATCH_SIZE at a time. Exported for tests. */
export async function flushCalls(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      let take = 0;
      let bytes = 0;
      while (take < queue.length && take < BATCH_SIZE) {
        const size = Buffer.byteLength(queue[take].record.requestBody ?? "") + Buffer.byteLength(queue[take].record.responseBody ?? "") + 2048;
        if (take > 0 && bytes + size > BATCH_MAX_BYTES) break;
        bytes += size;
        take += 1;
      }
      const batch = queue.splice(0, take);
      try {
        await callExternalService(externalServices.crm, "/internal/api-calls", {
          method: "POST",
          body: { calls: batch.map((q) => q.record) },
        });
      } catch (err) {
        const retry = batch.filter((q) => q.attempts === 0).map((q) => ({ ...q, attempts: 1 }));
        console.error(
          `[call-log] crm-service refused ${batch.length} call record(s): ${(err as Error).message}. ` +
            `${retry.length} re-queued once, ${batch.length - retry.length} dropped.`,
        );
        queue.unshift(...retry);
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

/** Tests only. */
export function _queuedCalls(): CallRecord[] {
  return queue.map((q) => q.record);
}
export function _resetCallLog() {
  queue.length = 0;
  if (timer) clearInterval(timer);
  timer = null;
  flushing = false;
}
