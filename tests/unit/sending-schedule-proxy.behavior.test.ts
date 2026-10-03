import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/conversations — pass-through to instantly-service GET /orgs/conversations.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes over
 * the wire: the downstream path, the identity headers, the query string, and — the point
 * of this route — that the three downstream refusals stay distinguishable (CLAUDE.md
 * rule #7 corollaries 2 and 3: a source-substring test can see none of that).
 */

vi.hoisted(() => {
  process.env.INSTANTLY_SERVICE_URL = "http://instantly.test.local";
  process.env.INSTANTLY_SERVICE_API_KEY = "instantly-test-key";
});

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "admin";
    // Mirrors the real authenticate: an x-brand-id header becomes req.brandId.
    if (req.headers["x-brand-id"]) req.brandId = req.headers["x-brand-id"];
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import conversationsRouter from "../../src/routes/conversations.js";

/**
 * GET /v1/sending-schedule — pass-through to instantly-service GET /orgs/sending-schedule.
 * Driven through the real router with a stubbed `fetch` (CLAUDE.md rule #7 corollary 3).
 */

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", conversationsRouter);
  return app;
}

const EMAIL = "prospect@example.com";
const BRAND = "44444444-4444-4444-4444-444444444444";

const SCHEDULE_BODY = JSON.stringify({
  success: true,
  schedule: {
    weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    startHour: 9,
    endHour: 17,
    timezone: "Europe/Paris",
    timezoneIsDefault: false,
    hasSequence: true,
    unknownDownstreamField: 7,
  },
});

describe("GET /v1/sending-schedule — sending schedule pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  function stubUpstream(body: string, status: number) {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
  }

  beforeEach(() => stubUpstream(SCHEDULE_BODY, 200));

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("forwards to instantly-service GET /orgs/sending-schedule with the query verbatim", async () => {
    const res = await request(buildApp()).get(
      `/v1/sending-schedule?brand_id=${BRAND}&email=${encodeURIComponent(EMAIL)}&zzz=keep+me`,
    );
    expect(res.status).toBe(200);
    const { url, init } = upstream();
    expect(url).toBe(
      `http://instantly.test.local/orgs/sending-schedule?brand_id=${BRAND}&email=${encodeURIComponent(EMAIL)}&zzz=keep+me`,
    );
    expect(init.method ?? "GET").toBe("GET");
  });

  it("sends the AUTHENTICATED org and promotes brand_id to x-brand-id", async () => {
    await request(buildApp())
      .get(`/v1/sending-schedule?email=${encodeURIComponent(EMAIL)}&brand_id=${BRAND}`)
      .set("x-org-id", "someone-elses-org");
    const { init } = upstream();
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
    expect(init.headers["x-user-id"]).toBe("user_test123");
    expect(init.headers["x-brand-id"]).toBe(BRAND);
    expect(init.headers["X-API-Key"]).toBe("instantly-test-key");
  });

  it("sends no x-brand-id when no brand is named", async () => {
    await request(buildApp()).get(`/v1/sending-schedule?email=${encodeURIComponent(EMAIL)}`);
    expect(upstream().init.headers["x-brand-id"]).toBeUndefined();
  });

  it("returns the upstream body field-for-field", async () => {
    const res = await request(buildApp()).get(`/v1/sending-schedule?email=${encodeURIComponent(EMAIL)}`);
    expect(res.body).toEqual(JSON.parse(SCHEDULE_BODY));
  });

  it("forwards a downstream 400 verbatim", async () => {
    stubUpstream(JSON.stringify({ error: "email must be a valid email", code: "bad_email" }), 400);
    const res = await request(buildApp()).get(`/v1/sending-schedule?email=nope`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "email must be a valid email", code: "bad_email" });
  });

  it("400s locally when email is absent, without calling downstream", async () => {
    const res = await request(buildApp()).get(`/v1/sending-schedule?brand_id=${BRAND}`);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("400s when brand_id conflicts with the x-brand-id header", async () => {
    const res = await request(buildApp())
      .get(`/v1/sending-schedule?email=${encodeURIComponent(EMAIL)}&brand_id=${BRAND}`)
      .set("x-brand-id", "55555555-5555-5555-5555-555555555555");
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
