import { Response } from "express";

/**
 * Why a request failed authentication, stated so the caller (often an AI
 * assistant relaying to a human) can say what to do next.
 *
 * The `error` string each code carries is the one this gateway always sent for
 * that case; `code`, `message` and `fix` were added beside it, so a caller that
 * matched on `error` sees no difference.
 *
 * What the key store can and cannot tell apart: key-service DELETES a revoked
 * key outright (no tombstone), so "never existed / mistyped" and "revoked" are
 * the same lookup miss there. `key_not_recognized` says so instead of guessing.
 */
export type AuthFailureCode =
  | "missing_credentials"
  | "wrong_header"
  | "invalid_admin_key"
  | "malformed_key"
  | "key_not_recognized"
  | "key_validation_unavailable";

const USER_KEY_PREFIXES = ["distrib.usr_", "mcpf_usr_"];
const DASHBOARD_KEYS_URL = "https://dashboard.distribute.you";
const HOW_TO_AUTH = "Send the key as `Authorization: Bearer <key>`.";

export function looksLikeUserKey(value: string): boolean {
  return USER_KEY_PREFIXES.some((p) => value.startsWith(p));
}

const FAILURES: Record<AuthFailureCode, { status: number; error: string; message: string; fix: string }> = {
  missing_credentials: {
    status: 401,
    error: "Missing authentication",
    message: "No credentials were sent.",
    fix: `${HOW_TO_AUTH} Create a key in the distribute.you dashboard (${DASHBOARD_KEYS_URL}) under API keys.`,
  },
  wrong_header: {
    status: 401,
    error: "Invalid admin key",
    message: "A distribute.you user key was sent in the X-API-Key header. That header is reserved for distribute.you's own services and is never checked against user keys.",
    fix: `${HOW_TO_AUTH} Remove the X-API-Key header.`,
  },
  invalid_admin_key: {
    status: 401,
    error: "Invalid admin key",
    message: "The X-API-Key header is reserved for distribute.you's own services and this value is not that key.",
    fix: `If you hold a distribute.you user key (it starts with \`distrib.usr_\`): ${HOW_TO_AUTH}`,
  },
  malformed_key: {
    status: 401,
    error: "Invalid API key",
    message: "The Bearer value is not a distribute.you user key: user keys start with `distrib.usr_`.",
    fix: `Check the key was copied whole, without quotes or spaces. ${HOW_TO_AUTH}`,
  },
  key_not_recognized: {
    status: 401,
    error: "Invalid API key",
    message: "This key is not an active distribute.you key. Either it was mistyped or truncated, or it was deleted (revoked). Revoked keys are erased, so these two cases cannot be told apart.",
    fix: `Copy the key again, or create a new one in the distribute.you dashboard (${DASHBOARD_KEYS_URL}) under API keys.`,
  },
  key_validation_unavailable: {
    status: 503,
    error: "Key validation unavailable",
    message: "distribute.you could not check this key right now. This says nothing about whether the key is valid.",
    fix: "Retry in a minute. Do not create a new key because of this error.",
  },
};

/**
 * Send the failure. User-key failures also carry `WWW-Authenticate: Bearer`
 * (RFC 6750), which names the scheme a client should use.
 */
export function respondAuthFailure(res: Response, code: AuthFailureCode) {
  const f = FAILURES[code];
  if (f.status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="distribute.you"');
  return res.status(f.status).json({ error: f.error, code, message: f.message, fix: f.fix });
}
