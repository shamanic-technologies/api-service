import { Request, Response, NextFunction } from "express";
import { timingSafeEqual, createHash } from "crypto";
import {
  ANONYMOUS_POLICY,
  AUTHENTICATED_POLICY,
  RATE_LIMIT_POLICY_HEADER,
  RateLimitDecision,
  rateLimitStore,
} from "../lib/rate-limit.js";

/** Timing-safe string comparison. Returns false on length mismatch. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * The client IP as seen by the edge, or `null` when the request did not come
 * through the edge at all.
 *
 * Every request from outside the box reaches this process through Cloudflare and
 * the box's reverse proxy, both of which set a forwarding header. A request with
 * NO forwarding header therefore originated inside the docker network — a
 * sibling service, the deploy health check, or a container-local probe.
 *
 * `x-real-ip` is included because the box's reverse proxy sets it; a request
 * that carries only `x-real-ip` is still an external one.
 */
export function edgeClientIp(req: Request): string | null {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();

  const xff = req.headers["x-forwarded-for"];
  const xffValue = Array.isArray(xff) ? xff[0] : xff;
  if (typeof xffValue === "string" && xffValue.trim()) {
    // Left-most entry is the original client.
    const first = xffValue.split(",")[0]?.trim();
    if (first) return first;
  }

  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();

  return null;
}

export type RateLimitScope =
  | { kind: "exempt"; reason: "platform-key" | "internal-network" }
  | { kind: "authenticated"; key: string }
  | { kind: "anonymous"; key: string };

/**
 * Decide which budget a request falls under, using only what is already on the
 * request. No network call: resolving the scope must not itself depend on
 * key-service or client-service being reachable.
 *
 * Two exemptions, both about not throttling the platform into an outage:
 *
 * 1. **Platform key.** `X-API-Key: <ADMIN_DISTRIBUTE_API_KEY>` is how every
 *    internal service and both first-party dashboards call this gateway
 *    (see `authenticate`, path 1). Those callers are the fleet; a limit on them
 *    would be a self-inflicted outage, and they are already bounded by the fact
 *    that we operate them. An INVALID `x-api-key` is not exempt — it falls
 *    through to the anonymous budget, so a wrong key cannot be used to bypass
 *    the limiter by guessing.
 * 2. **Internal network.** A request that arrives with no forwarding header at
 *    all never crossed the edge, so it came from inside the docker network:
 *    a sibling service or the deploy health check. Anything from a customer or
 *    an agent on the internet passes through Cloudflare and carries one.
 */
export function resolveScope(req: Request): RateLimitScope {
  const apiKey = req.headers["x-api-key"];
  const expected = process.env.ADMIN_DISTRIBUTE_API_KEY;
  if (typeof apiKey === "string" && expected && safeCompare(apiKey, expected)) {
    return { kind: "exempt", reason: "platform-key" };
  }

  const ip = edgeClientIp(req);
  if (!ip) return { kind: "exempt", reason: "internal-network" };

  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) {
      // Hash the key: the bucket identity must not put a live credential in a
      // process-resident map (or in anything that map is ever dumped into).
      const digest = createHash("sha256").update(token).digest("hex").slice(0, 32);
      return { kind: "authenticated", key: digest };
    }
  }

  return { kind: "anonymous", key: ip };
}

/** Write the RFC-style rate-limit headers for a decision onto the response. */
export function setRateLimitHeaders(res: Response, decision: RateLimitDecision): void {
  // Combined field (IETF `ratelimit-headers` draft, current form).
  res.setHeader(
    "RateLimit",
    `limit=${decision.limit}, remaining=${decision.remaining}, reset=${decision.resetSeconds}`,
  );
  res.setHeader("RateLimit-Policy", RATE_LIMIT_POLICY_HEADER);
  // Individual fields (earlier draft form) — still what most clients and
  // scanners read, and cheap to keep alongside the combined field.
  res.setHeader("RateLimit-Limit", String(decision.limit));
  res.setHeader("RateLimit-Remaining", String(decision.remaining));
  res.setHeader("RateLimit-Reset", String(decision.resetSeconds));
}

/**
 * Gateway rate limiter.
 *
 * Mounted before every route so that the headers describe the request the
 * caller actually made, including the ones this gateway proxies downstream.
 * A throttled request is answered here and never reaches the downstream fleet,
 * which is the point: the limiter protects the services behind it, not just
 * this process.
 */
export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const scope = resolveScope(req);
  if (scope.kind === "exempt") return next();

  const policy = scope.kind === "authenticated" ? AUTHENTICATED_POLICY : ANONYMOUS_POLICY;
  const decision = rateLimitStore.hit(scope.key, policy, Date.now());

  setRateLimitHeaders(res, decision);

  if (decision.allowed) return next();

  res.setHeader("Retry-After", String(decision.resetSeconds));
  return res.status(429).json({
    error: "Rate limit exceeded",
    code: "RATE_LIMITED",
    policy: policy.name,
    limit: decision.limit,
    windowSeconds: policy.windowSeconds,
    retryAfterSeconds: decision.resetSeconds,
  });
}
