/**
 * Rate-limit policy + counter store for the gateway.
 *
 * Design notes (why it is shaped this way):
 *
 * - **In-process store, no external dependency.** The counters live in a plain
 *   `Map` in this process. That is a deliberate choice, not a shortcut: the
 *   alternative (Redis/Postgres) introduces a store that can be unavailable,
 *   and a limiter whose store is down has only two behaviours — fail open
 *   (silently stop enforcing, while still advertising `RateLimit` headers, i.e.
 *   lying to callers) or fail closed (429 the whole API because a cache blinked).
 *   Neither is acceptable here. With an in-process counter there is no third
 *   party to be unavailable: the limiter is exactly as available as the process
 *   it protects, so the headers it emits are always true statements about the
 *   instance answering the request.
 *
 * - **Fixed window.** `RateLimit-Reset` is a delta-seconds field; a fixed window
 *   gives an honest, computable value for it. A sliding window would either need
 *   per-request timestamp arrays (unbounded memory under the exact abuse the
 *   limiter exists to stop) or an approximation that makes `Reset` a guess.
 *
 * - **Scopes.** Three, resolved without any network call (see
 *   `src/middleware/rate-limit.ts`): platform/internal callers are exempt,
 *   Bearer API keys get a per-key budget, everything else gets a per-IP budget.
 */

/** A named budget: `limit` requests per `windowSeconds`. */
export interface RateLimitPolicy {
  /** Policy name, surfaced in the `RateLimit-Policy` header. */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Per-API-key budget for authenticated callers (`Authorization: Bearer distrib.usr_*`).
 *
 * Sized off the shape of real integration traffic rather than off a round number:
 * the heaviest legitimate client pattern on this gateway is a dashboard-style
 * poller refreshing several resources every few seconds, which sits an order of
 * magnitude under this. 600/min is ~10 req/s sustained per key, which no
 * single-user integration reaches without a runaway loop.
 */
export const AUTHENTICATED_POLICY: RateLimitPolicy = {
  name: "authenticated",
  limit: 600,
  windowSeconds: 60,
};

/**
 * Per-IP budget for callers with no API key — the public read surface
 * (`/health`, `/public/*`, `/v1/public/*`, `/v1/costs/platform-prices`, the
 * OpenAPI document and the docs UI). Lower than the authenticated budget
 * because the caller is unidentified and the endpoints are cacheable reads.
 */
export const ANONYMOUS_POLICY: RateLimitPolicy = {
  name: "anonymous",
  limit: 120,
  windowSeconds: 60,
};

export const POLICIES = [AUTHENTICATED_POLICY, ANONYMOUS_POLICY];

/**
 * Value of the `RateLimit-Policy` header — the full, static policy list, so an
 * agent can learn every budget this API applies from a single response instead
 * of discovering them one 429 at a time.
 *
 * Format follows the IETF `ratelimit-headers` draft quoted-name form:
 *   `"authenticated";q=600;w=60, "anonymous";q=120;w=60`
 */
export const RATE_LIMIT_POLICY_HEADER = POLICIES.map(
  (p) => `"${p.name}";q=${p.limit};w=${p.windowSeconds}`,
).join(", ");

export interface RateLimitDecision {
  /** Whether the request is allowed through. */
  allowed: boolean;
  /** The policy that was applied. */
  policy: RateLimitPolicy;
  /** Requests allowed in the current window. */
  limit: number;
  /** Requests still available in the current window (never negative). */
  remaining: number;
  /** Seconds until the current window resets. Always >= 1. */
  resetSeconds: number;
}

interface WindowCounter {
  /** Window index — `floor(nowMs / windowMs)`. */
  window: number;
  /** Requests counted in that window. */
  count: number;
  /** Epoch ms at which this entry can be dropped. */
  expiresAtMs: number;
}

/**
 * Fixed-window counter store.
 *
 * Bounded by a lazy sweep rather than a timer: a `setInterval` would keep a
 * handle alive for the life of the process purely to delete map entries, and
 * this repo's convention is to reap on read instead of on a schedule.
 */
export class RateLimitStore {
  private counters = new Map<string, WindowCounter>();
  private nextSweepMs = 0;

  /** Sweep expired entries at most this often. */
  private static readonly SWEEP_INTERVAL_MS = 60_000;

  /**
   * Count one request against `key` under `policy` and return the resulting
   * rate-limit state. A request that exceeds the budget is still counted, so a
   * client that keeps hammering keeps seeing `remaining: 0` until the window
   * rolls over.
   */
  hit(key: string, policy: RateLimitPolicy, nowMs: number): RateLimitDecision {
    this.sweep(nowMs);

    const windowMs = policy.windowSeconds * 1000;
    const window = Math.floor(nowMs / windowMs);
    const windowEndsAtMs = (window + 1) * windowMs;

    const storeKey = `${policy.name}:${key}`;
    const existing = this.counters.get(storeKey);

    let count: number;
    if (existing && existing.window === window) {
      count = existing.count + 1;
      existing.count = count;
      existing.expiresAtMs = windowEndsAtMs;
    } else {
      count = 1;
      this.counters.set(storeKey, {
        window,
        count,
        expiresAtMs: windowEndsAtMs,
      });
    }

    return {
      allowed: count <= policy.limit,
      policy,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - count),
      // Ceil, and floor at 1: a `Retry-After: 0` tells an agent to retry
      // immediately, which is the one thing a throttled caller must not do.
      resetSeconds: Math.max(1, Math.ceil((windowEndsAtMs - nowMs) / 1000)),
    };
  }

  /** Drop entries whose window has passed. No-op unless the interval elapsed. */
  private sweep(nowMs: number): void {
    if (nowMs < this.nextSweepMs) return;
    this.nextSweepMs = nowMs + RateLimitStore.SWEEP_INTERVAL_MS;
    for (const [key, counter] of this.counters) {
      if (counter.expiresAtMs <= nowMs) this.counters.delete(key);
    }
  }

  /** Entry count — for tests and diagnostics. */
  get size(): number {
    return this.counters.size;
  }

  /** Drop every counter — for tests. */
  reset(): void {
    this.counters.clear();
    this.nextSweepMs = 0;
  }
}

/** Process-wide store used by the middleware. */
export const rateLimitStore = new RateLimitStore();
