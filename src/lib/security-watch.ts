import type { Request, Response, NextFunction } from "express";
import { edgeClientIp } from "../middleware/rate-limit.js";
import { pathRefusalReason } from "../middleware/path-guard.js";
import { isStaffEmail, isStaffHuman } from "./staff.js";
import { callExternalService, externalServices } from "./service-client.js";
import { recordAudit, type AuditRow } from "./security-audit-store.js";
import { keyFingerprint } from "./call-log.js";

/**
 * Gateway intrusion alerts + audit trail (SECURITY-ALERTS-1128, owner 2026-11-28).
 *
 * On 2026-11-20 a self-signed-up account minted keys named `pentest-probe`, posted 112
 * code-bearing workflows, probed `/v1/brands/%2e%2e%2f...` and read 740 tables through
 * `/internal/admin/*`. Nothing alerted for 7 days. This module watches every response the
 * gateway sends (mounted first, reads the request on `finish`, never slows or fails it) and:
 *
 *  - raises transactional-email-service's platform staff alert `security_alert`, EMAILED to
 *    the staff list, ONCE per incident: `eventId` = `api-service:<kind>:<subject>:<UTC day>`
 *    (transactional-email delivers an eventId once, ever; this process also skips a repeat);
 *  - writes a durable 90-day audit row (`security-audit-store.ts`) for every `/internal/admin/*`
 *    call, every API key mint and every detection.
 *
 * Triggers (thresholds measured on prod 2026-11-28 over crm-service `api_calls`, 42k user-key
 * calls since 2026-10-12, and key-service `user_auth_keys`; see each constant):
 *  - `code_write_refused`: a workflow / script write or run refused by the staff gate
 *    (RCE-WORKFLOWS-1127). Routes opt in with `markCodeBearing`.
 *  - `path_traversal`: a request path with a dot-segment, backslash or encoded slash.
 *  - `admin_not_staff_human`: any `/internal/admin/*` call the pinned-staff-human gate did not admit.
 *  - `key_mint_burst`: one non-staff account minting KEY_MINT_BURST keys within an hour.
 *  - `probe_burst`: one non-staff account answered 4xx on PROBE_DISTINCT_4XX distinct routes,
 *    or PROBE_4XX_COUNT times, within 10 minutes.
 *  - `platform_key_unexpected_source`: the VALID platform key arriving through the edge from
 *    an IP that is not the box itself (our apps call through the edge from the box; services
 *    call inside the docker network with no edge header).
 *  - `platform_key_guess`: PLATFORM_KEY_GUESSES wrong `x-api-key` values from one IP in 10 minutes.
 *  - `audit_store_unavailable`: an audit row could not be written.
 * Staff never alert on their own actions (a staff key user, a staff x-email, a pinned staff human).
 */

export type SecurityKind =
  | "code_write_refused"
  | "path_traversal"
  | "admin_not_staff_human"
  | "key_mint_burst"
  | "probe_burst"
  | "platform_key_unexpected_source"
  | "platform_key_guess"
  | "audit_store_unavailable";

/** 2026-11-20 attacker: 35-212 distinct 4xx routes per 10 min. Normal max (staff included): 6. */
export const PROBE_DISTINCT_4XX = 20;
/** Normal non-staff max: 20 4xx per 10 min (a test account retrying one route); staff max 87. */
export const PROBE_4XX_COUNT = 100;
export const PROBE_WINDOW_MS = 10 * 60_000;
/** Max keys ever minted by one user within 10 min since 2026-03: 2 (staff). */
export const KEY_MINT_BURST = 3;
export const KEY_MINT_WINDOW_MS = 60 * 60_000;
export const PLATFORM_KEY_GUESSES = 10;
export const PLATFORM_KEY_GUESS_WINDOW_MS = 10 * 60_000;

/** The box's own public addresses: our apps (dashboard, admin) call `api.distribute.you` from it. */
const BOX_IPS = ["62.83.93.230"];
const BOX_IPV6_PREFIXES = ["2a03:4000:13:1c77:"];

export function isTrustedSourceIp(ip: string): boolean {
  const extra = (process.env.SECURITY_TRUSTED_SOURCE_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (BOX_IPS.includes(v4) || extra.includes(v4)) return true;
  const lower = ip.toLowerCase();
  return BOX_IPV6_PREFIXES.some((p) => lower.startsWith(p));
}

// ── Alert delivery ──────────────────────────────────────────────────────────

export interface SecurityAlert {
  kind: SecurityKind;
  subject: string;
  eventId: string;
  summary: string;
  evidence: string;
  firstSeenAt: string;
}

export type AlertSender = (alert: SecurityAlert) => Promise<void>;

async function postSecurityAlert(alert: SecurityAlert): Promise<void> {
  await callExternalService(externalServices.transactionalEmail, "/platform-staff-alert", {
    method: "POST",
    body: {
      eventType: "security_alert",
      eventId: alert.eventId,
      metadata: {
        kind: alert.kind,
        summary: alert.summary,
        evidence: alert.evidence,
        firstSeenAt: alert.firstSeenAt,
      },
    },
  });
}

// Unit tests drive the real middleware everywhere; none of them may email staff.
let sender: AlertSender = process.env.VITEST ? async () => {} : postSecurityAlert;

/** Tests only: capture alerts instead of posting them. */
export function setAlertSender(next: AlertSender): void {
  sender = next;
}

const raised = new Map<string, number>();

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Raise one alert per (kind, subject, UTC day). A failed delivery forgets the key so the
 * next occurrence retries; transactional-email's eventId dedup keeps a retry from double-sending.
 */
export function raiseAlert(
  kind: SecurityKind,
  subject: string,
  summary: string,
  evidence: string[],
  now: number = Date.now(),
): SecurityAlert | null {
  const eventId = `api-service:${kind}:${subject}:${utcDay(now)}`.slice(0, 200);
  if (raised.has(eventId)) return null;
  raised.set(eventId, now);
  if (raised.size > 5_000) {
    for (const [key, at] of raised) if (now - at > 36 * 3_600_000) raised.delete(key);
  }
  const alert: SecurityAlert = {
    kind,
    subject,
    eventId,
    summary,
    evidence: evidence.filter(Boolean).join("\n"),
    firstSeenAt: new Date(now).toISOString(),
  };
  console.warn(`[security-alert] ${kind} ${subject}: ${summary}`);
  sender(alert).then(
    () => console.log(`[security-alert] delivered ${eventId}`),
    (err: Error) => {
      raised.delete(eventId);
      console.error(`[security-alert] NOT DELIVERED ${eventId}: ${err.message}`);
    },
  );
  return alert;
}

// ── Sliding-window counters ─────────────────────────────────────────────────

class WindowCounter<T> {
  private readonly events = new Map<string, { at: number; value: T }[]>();
  constructor(private readonly windowMs: number) {}

  add(subject: string, value: T, now: number): { at: number; value: T }[] {
    const kept = (this.events.get(subject) ?? []).filter((e) => now - e.at < this.windowMs);
    kept.push({ at: now, value });
    this.events.set(subject, kept);
    if (this.events.size > 10_000) this.sweep(now);
    return kept;
  }

  private sweep(now: number): void {
    for (const [subject, list] of this.events) {
      if (!list.some((e) => now - e.at < this.windowMs)) this.events.delete(subject);
    }
  }

  clear(): void {
    this.events.clear();
  }
}

const probe4xx = new WindowCounter<string>(PROBE_WINDOW_MS);
const keyMints = new WindowCounter<string>(KEY_MINT_WINDOW_MS);
const keyGuesses = new WindowCounter<string>(PLATFORM_KEY_GUESS_WINDOW_MS);

/** Tests only. */
export function resetSecurityWatch(): void {
  raised.clear();
  probe4xx.clear();
  keyMints.clear();
  keyGuesses.clear();
}

// ── Request facts ───────────────────────────────────────────────────────────

interface WatchedRequest extends Request {
  userId?: string;
  orgId?: string;
  authType?: "user_key" | "admin";
  staffEmail?: string;
  userKeyScope?: { isStaff: boolean; email?: string | null };
  securityCodeBearing?: boolean;
}

/** Route opt-in: this route stores or runs caller-written code (RCE-WORKFLOWS-1127). */
export function markCodeBearing(req: Request, _res: Response, next: NextFunction): void {
  (req as WatchedRequest).securityCodeBearing = true;
  next();
}

function header(req: Request, name: string): string | null {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim().slice(0, 300) : null;
}

export function rawPathOf(req: Request): string {
  const raw = req.originalUrl ?? req.url ?? "";
  const q = raw.indexOf("?");
  return (q === -1 ? raw : raw.slice(0, q)).slice(0, 500);
}

/** `/v1/brands/3f…/offers/12` → `/v1/brands/{id}/offers/{n}`: one route, many ids. */
export function routeTemplate(method: string, path: string): string {
  return `${method} ${path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{id}")
    .replace(/\/\d+(?=\/|$)/g, "/{n}")}`;
}

const KEY_MINT_ROUTES: RegExp[] = [
  /^POST \/v1\/api-keys\/?$/i,
  /^POST \/v1\/agent-signups\/complete\/?$/i,
  /^POST \/v1\/orgs\/[^/]+\/members\/?$/i,
];

function isStaffCaller(req: WatchedRequest): boolean {
  if (req.staffEmail) return true;
  if (req.authType === "user_key") return !!req.userKeyScope?.isStaff;
  if (req.authType === "admin") {
    return isStaffEmail(header(req, "x-email")) || isStaffHuman(header(req, "x-external-user-id"), header(req, "x-email"));
  }
  return false;
}

function bodyString(req: Request, key: string): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  const v = body && typeof body === "object" ? body[key] : undefined;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;
}

// ── The middleware ──────────────────────────────────────────────────────────

/**
 * Mounted FIRST in `src/index.ts` (before the path guard), so it sees refused paths too.
 * All work happens on `finish`, after the caller has its answer.
 */
export function securityWatch(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    try {
      observe(req as WatchedRequest, res.statusCode, Date.now());
    } catch (err) {
      console.error("[security-watch] observe failed:", (err as Error).message);
    }
  });
  next();
}

export function observe(req: WatchedRequest, status: number, now: number): void {
  const method = req.method.toUpperCase();
  const path = rawPathOf(req);
  const ip = edgeClientIp(req);
  const source = ip ?? "internal";
  const ua = header(req, "user-agent");
  const xEmail = header(req, "x-email");
  const externalUserId = header(req, "x-external-user-id");
  const staff = isStaffCaller(req);
  const who = req.userId ? `user ${req.userId}${req.orgId ? ` in org ${req.orgId}` : ""}` : "no signed-in user";
  const how =
    req.authType === "user_key" ? "a customer API key" : req.authType === "admin" ? "the platform key" : header(req, "x-api-key") ? "a wrong platform key" : header(req, "authorization") ? "an unverified bearer token" : "no key";
  const baseEvidence = [
    `When: ${new Date(now).toISOString()}`,
    `Request: ${method} ${path} -> ${status}`,
    `From IP: ${source}`,
    `User agent: ${ua ?? "none"}`,
    `Caller: ${who}, with ${how}${xEmail ? `, x-email ${xEmail}` : ""}${externalUserId ? `, x-external-user-id ${externalUserId}` : ""}`,
    header(req, "x-request-id") ? `Request id: ${header(req, "x-request-id")}` : "",
  ];

  const audit = (kind: string, extra: Partial<AuditRow> = {}) =>
    recordAudit({
      kind,
      method,
      path,
      status,
      ip: source,
      userAgent: ua,
      authType: req.authType ?? null,
      userId: req.userId ?? null,
      orgId: req.orgId ?? null,
      staffEmail: req.staffEmail ?? null,
      xEmail,
      externalUserId,
      keyName: null,
      requestId: header(req, "x-request-id"),
      ...extra,
    });

  // A per-request detection (one hostile request) is audited every time; a burst only when it alerts.
  const detect = (kind: SecurityKind, subject: string, summary: string, extra: string[] = [], perRequest = true) => {
    const alert = raiseAlert(kind, subject, summary, [...baseEvidence, ...extra], now);
    if (perRequest || alert) audit(kind);
  };

  // 1. Path traversal (refused 400 by the path guard, or anything that slipped past it).
  const traversal = pathRefusalReason(path);
  if (traversal) {
    detect("path_traversal", source, `Path traversal attempt on the API gateway from ${source} (${traversal})`);
    return;
  }

  // 2. /internal/admin/*: every call is audited; one the pinned-staff-human gate refused alerts.
  if (path.toLowerCase().startsWith("/internal/admin")) {
    audit("admin_call");
    if (!req.staffEmail) {
      detect("admin_not_staff_human", source, `Someone who is not a signed-in staff member called the raw-data admin API (${method} ${path}) from ${source}`);
    }
    return;
  }

  // 3. A refused code-bearing write or run.
  if (req.securityCodeBearing && (status === 401 || status === 403) && !staff) {
    detect("code_write_refused", req.userId ?? source, `A non-staff caller tried to store or run code (${method} ${path}), refused ${status}`);
  }

  // 4. The valid platform key from outside the box.
  if (req.authType === "admin" && ip && !isTrustedSourceIp(ip)) {
    detect(
      "platform_key_unexpected_source",
      ip,
      `The platform API key was used from ${ip}, an address outside our server`,
      ["Expected: our services (inside the server network) and our apps (from the server's own address)."],
    );
  }

  // 5. Wrong platform keys from one IP.
  if (status === 401 && header(req, "x-api-key") && req.authType !== "admin") {
    const guesses = keyGuesses.add(source, path, now);
    if (guesses.length >= PLATFORM_KEY_GUESSES) {
      detect("platform_key_guess", source, `${guesses.length} wrong platform keys from ${source} in 10 minutes`, [], false);
    }
  }

  // 6. API key mints: audited; a burst by one non-staff account alerts.
  const route = `${method} ${path}`;
  if (KEY_MINT_ROUTES.some((r) => r.test(route))) {
    const signupEmail = /agent-signups/i.test(path) ? bodyString(req, "email")?.toLowerCase() ?? null : null;
    audit("key_mint", { keyName: bodyString(req, "name") ?? bodyString(req, "keyName") });
    const mintSubject = req.userId ?? signupEmail;
    if (status >= 200 && status < 300 && mintSubject && !staff) {
      const mints = keyMints.add(mintSubject, path, now);
      if (mints.length >= KEY_MINT_BURST) {
        detect("key_mint_burst", mintSubject, `One account minted ${mints.length} API keys within an hour (${mintSubject})`, [
          `Mints: ${mints.map((m) => new Date(m.at).toISOString()).join(", ")}`,
        ], false);
      }
    }
  }

  // 7. Probing: many distinct routes answered 4xx for one non-staff account.
  // A route that does not exist never authenticates, so a sweep of made-up paths with a
  // customer key is counted under the key's one-way fingerprint (the 2026-11-20 sweep hit 212).
  const probeSubject =
    req.authType === "user_key"
      ? req.userId
      : req.authType === "admin"
        ? externalUserId
          ? (req.userId ?? externalUserId)
          : undefined
        : (() => {
            const fp = keyFingerprint(header(req, "authorization") ?? undefined);
            return fp ? `key:${fp}` : undefined;
          })();
  if (probeSubject && !staff && status >= 400 && status < 500 && status !== 402) {
    const events = probe4xx.add(probeSubject, routeTemplate(method, path), now);
    const distinct = new Set(events.map((e) => e.value));
    if (distinct.size >= PROBE_DISTINCT_4XX || events.length >= PROBE_4XX_COUNT) {
      detect(
        "probe_burst",
        probeSubject,
        `One account got ${events.length} refusals on ${distinct.size} different routes in 10 minutes: it looks like probing`,
        [`Routes refused: ${[...distinct].slice(0, 15).join(", ")}${distinct.size > 15 ? ", ..." : ""}`],
        false,
      );
    }
  }
}
