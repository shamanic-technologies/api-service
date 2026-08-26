import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  ANONYMOUS_POLICY,
  AUTHENTICATED_POLICY,
  RATE_LIMIT_POLICY_HEADER,
  RateLimitStore,
  rateLimitStore,
} from "../../src/lib/rate-limit.js";
import { rateLimit, resolveScope, edgeClientIp } from "../../src/middleware/rate-limit.js";

/** Minimal app carrying only the limiter — no auth mock, nothing else in the way. */
function createApp() {
  const app = express();
  app.use(rateLimit);
  app.get("/anything", (_req, res) => res.json({ ok: true }));
  return app;
}

const ADMIN_KEY = "test-admin-distribute-key"; // set by tests/setup.ts

beforeEach(() => rateLimitStore.reset());

describe("RateLimitStore", () => {
  it("counts within a fixed window and reports remaining", () => {
    const store = new RateLimitStore();
    const policy = { name: "t", limit: 3, windowSeconds: 60 };
    const t0 = 1_000_000_000_000;

    expect(store.hit("k", policy, t0)).toMatchObject({ allowed: true, remaining: 2 });
    expect(store.hit("k", policy, t0 + 1)).toMatchObject({ allowed: true, remaining: 1 });
    expect(store.hit("k", policy, t0 + 2)).toMatchObject({ allowed: true, remaining: 0 });
    expect(store.hit("k", policy, t0 + 3)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("keeps counting a throttled caller, so remaining stays 0 until the window rolls", () => {
    const store = new RateLimitStore();
    const policy = { name: "t", limit: 1, windowSeconds: 60 };
    const t0 = 60_000; // start of a window
    store.hit("k", policy, t0);
    for (let i = 0; i < 5; i++) {
      expect(store.hit("k", policy, t0 + i).allowed).toBe(false);
    }
  });

  it("resets when the window rolls over", () => {
    const store = new RateLimitStore();
    const policy = { name: "t", limit: 1, windowSeconds: 60 };
    const t0 = 60_000;
    expect(store.hit("k", policy, t0).allowed).toBe(true);
    expect(store.hit("k", policy, t0 + 1_000).allowed).toBe(false);
    expect(store.hit("k", policy, t0 + 60_000).allowed).toBe(true);
  });

  it("never reports a reset of 0 — a throttled agent must not retry immediately", () => {
    const store = new RateLimitStore();
    const policy = { name: "t", limit: 1, windowSeconds: 60 };
    // 1ms before the window boundary.
    const decision = store.hit("k", policy, 119_999);
    expect(decision.resetSeconds).toBeGreaterThanOrEqual(1);
  });

  it("isolates keys and policies from each other", () => {
    const store = new RateLimitStore();
    const a = { name: "a", limit: 1, windowSeconds: 60 };
    const b = { name: "b", limit: 1, windowSeconds: 60 };
    expect(store.hit("k", a, 60_000).allowed).toBe(true);
    expect(store.hit("k2", a, 60_000).allowed).toBe(true);
    expect(store.hit("k", b, 60_000).allowed).toBe(true);
    expect(store.hit("k", a, 60_000).allowed).toBe(false);
  });

  it("drops expired entries so the map cannot grow without bound", () => {
    const store = new RateLimitStore();
    const policy = { name: "t", limit: 100, windowSeconds: 60 };
    for (let i = 0; i < 50; i++) store.hit(`ip-${i}`, policy, 60_000);
    expect(store.size).toBe(50);
    // Past the window AND past the sweep interval.
    store.hit("later", policy, 60_000 + 180_000);
    expect(store.size).toBe(1);
  });
});

describe("edgeClientIp", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as any;

  it("prefers cf-connecting-ip", () => {
    expect(edgeClientIp(req({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe("1.2.3.4");
  });

  it("takes the left-most x-forwarded-for entry", () => {
    expect(edgeClientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    expect(edgeClientIp(req({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
  });

  it("returns null when the request never crossed the edge", () => {
    expect(edgeClientIp(req({}))).toBeNull();
  });
});

describe("resolveScope — who is exempt", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as any;

  it("exempts the platform key (the whole internal fleet + first-party dashboards)", () => {
    expect(resolveScope(req({ "x-api-key": ADMIN_KEY, "cf-connecting-ip": "1.2.3.4" }))).toEqual({
      kind: "exempt",
      reason: "platform-key",
    });
  });

  it("exempts internal-network traffic (no forwarding header = never crossed the edge)", () => {
    expect(resolveScope(req({}))).toEqual({ kind: "exempt", reason: "internal-network" });
  });

  it("does NOT exempt a wrong x-api-key — a guess cannot buy a bypass", () => {
    const scope = resolveScope(req({ "x-api-key": "not-the-key", "cf-connecting-ip": "1.2.3.4" }));
    expect(scope.kind).toBe("anonymous");
  });

  it("buckets a Bearer caller per key, not per IP", () => {
    const a = resolveScope(req({ authorization: "Bearer distrib.usr_aaa", "cf-connecting-ip": "1.1.1.1" }));
    const b = resolveScope(req({ authorization: "Bearer distrib.usr_aaa", "cf-connecting-ip": "2.2.2.2" }));
    const c = resolveScope(req({ authorization: "Bearer distrib.usr_bbb", "cf-connecting-ip": "1.1.1.1" }));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.kind).toBe("authenticated");
  });

  it("never puts the raw API key in the bucket identity", () => {
    const scope = resolveScope(req({ authorization: "Bearer distrib.usr_secret", "cf-connecting-ip": "1.1.1.1" }));
    expect(scope.kind).toBe("authenticated");
    expect((scope as { key: string }).key).not.toContain("secret");
  });

  it("buckets an unauthenticated caller per client IP", () => {
    expect(resolveScope(req({ "cf-connecting-ip": "1.2.3.4" }))).toEqual({
      kind: "anonymous",
      key: "1.2.3.4",
    });
  });
});

describe("rateLimit middleware", () => {
  it("puts the caller's current state on an ordinary successful response", async () => {
    const res = await request(createApp()).get("/anything").set("cf-connecting-ip", "203.0.113.1");

    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBe(String(ANONYMOUS_POLICY.limit));
    expect(res.headers["ratelimit-remaining"]).toBe(String(ANONYMOUS_POLICY.limit - 1));
    expect(Number(res.headers["ratelimit-reset"])).toBeGreaterThan(0);
    expect(res.headers["ratelimit"]).toMatch(
      new RegExp(`^limit=${ANONYMOUS_POLICY.limit}, remaining=${ANONYMOUS_POLICY.limit - 1}, reset=\\d+$`),
    );
    expect(res.headers["ratelimit-policy"]).toBe(RATE_LIMIT_POLICY_HEADER);
  });

  it("advertises the authenticated budget to a Bearer caller", async () => {
    const res = await request(createApp())
      .get("/anything")
      .set("cf-connecting-ip", "203.0.113.2")
      .set("authorization", "Bearer distrib.usr_abc");

    expect(res.headers["ratelimit-limit"]).toBe(String(AUTHENTICATED_POLICY.limit));
  });

  it("answers 429 with Retry-After once the budget is spent", async () => {
    const app = createApp();
    const ip = "203.0.113.3";
    for (let i = 0; i < ANONYMOUS_POLICY.limit; i++) {
      await request(app).get("/anything").set("cf-connecting-ip", ip);
    }

    const res = await request(app).get("/anything").set("cf-connecting-ip", ip);
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(res.headers["ratelimit-remaining"]).toBe("0");
    expect(res.body).toMatchObject({
      error: "Rate limit exceeded",
      code: "RATE_LIMITED",
      policy: ANONYMOUS_POLICY.name,
      limit: ANONYMOUS_POLICY.limit,
    });
    expect(res.body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("does not throttle the internal fleet — the platform key is never limited", async () => {
    const app = createApp();
    // Far past the anonymous budget, from a single "IP".
    for (let i = 0; i < ANONYMOUS_POLICY.limit + 50; i++) {
      const res = await request(app)
        .get("/anything")
        .set("cf-connecting-ip", "203.0.113.4")
        .set("x-api-key", ADMIN_KEY);
      expect(res.status).toBe(200);
    }
  });

  it("does not throttle a request that never crossed the edge", async () => {
    const app = createApp();
    for (let i = 0; i < ANONYMOUS_POLICY.limit + 5; i++) {
      const res = await request(app).get("/anything");
      expect(res.status).toBe(200);
    }
  });

  it("emits no rate-limit headers for an exempt caller — it advertises only what it enforces", async () => {
    const res = await request(createApp()).get("/anything").set("x-api-key", ADMIN_KEY);
    expect(res.headers["ratelimit"]).toBeUndefined();
    expect(res.headers["ratelimit-limit"]).toBeUndefined();
  });

  it("keeps one throttled caller from affecting another", async () => {
    const app = createApp();
    for (let i = 0; i < ANONYMOUS_POLICY.limit + 1; i++) {
      await request(app).get("/anything").set("cf-connecting-ip", "203.0.113.5");
    }
    const other = await request(app).get("/anything").set("cf-connecting-ip", "203.0.113.6");
    expect(other.status).toBe(200);
  });
});
