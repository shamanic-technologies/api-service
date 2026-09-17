import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { CLIENT_BASE } = vi.hoisted(() => {
  const CLIENT_BASE = "http://client.test.local";
  process.env.CLIENT_SERVICE_URL = CLIENT_BASE;
  process.env.CLIENT_SERVICE_API_KEY = "client-test-key";
  return { CLIENT_BASE };
});

/**
 * GET /v1/brands/:brandId/reward-tasks — behavioural cover for the proxy.
 *
 * A source-substring test cannot see what goes over the wire, and the two things that
 * matter here are exactly that: the org reaching client-service is the AUTHENTICATED
 * one (a caller-supplied header must not name someone else's org), and the upstream
 * body comes back untouched. Per CLAUDE.md #6/#8 the assertions are the forwarded path
 * + the byte-identical body, never client-service's field names — the payload below is
 * a fixture, not a contract this repo owns.
 */

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

import rewardTasksRouter from "../../src/routes/reward-tasks.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", rewardTasksRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";

const UPSTREAM_BODY = {
  brandId: BRAND_ID,
  orgId: "b645207b-d8e9-40b0-9391-072b777cd9a9",
  status: "ok",
  rewardCentsPerTask: 100,
  tasks: [
    {
      taskKey: "sales_funnel_refresh",
      scope: {
        type: "sales_funnel",
        brandId: BRAND_ID,
        offerId: "d5ecba00-783a-4939-b5bd-f85b9e6b7d9e",
        funnelKey: "website_purchases",
      },
      rewardCents: 100,
      due: true,
      dueAt: "2026-08-18T09:00:00.000Z",
      lastCompletedAt: null,
      completedCount: 0,
      contentChangedAt: "2026-07-19T09:00:00.000Z",
      contentChangedProvenance: "producer_ts",
      // A field the gateway has never heard of: it must still arrive (AC5).
      somethingClientServiceAddsLater: { nested: true },
    },
  ],
  rollup: {
    brand: { dueCount: 1, taskCount: 1 },
    offers: [
      { offerId: "d5ecba00-783a-4939-b5bd-f85b9e6b7d9e", dueCount: 1, taskCount: 1 },
    ],
  },
};

let captured: { url: string; init: any } | null = null;

describe("GET /v1/brands/:brandId/reward-tasks — behaviour", () => {
  beforeEach(() => {
    captured = null;
    global.fetch = vi.fn().mockImplementation(async (url: any, init: any) => {
      captured = { url: String(url), init };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => UPSTREAM_BODY,
        text: async () => JSON.stringify(UPSTREAM_BODY),
      };
    });
  });

  it("forwards to client-service on the downstream path", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/reward-tasks`);
    expect(res.status).toBe(200);
    expect(captured?.url).toBe(
      `${CLIENT_BASE}/internal/brands/${BRAND_ID}/reward-tasks`,
    );
  });

  it("sends the AUTHENTICATED org, not one the caller named", async () => {
    await request(buildApp())
      .get(`/v1/brands/${BRAND_ID}/reward-tasks`)
      .set("x-org-id", "org_someone_else");

    const headers = captured?.init?.headers ?? {};
    const orgHeader = headers["x-org-id"] ?? headers["X-Org-Id"];
    expect(orgHeader).toBe("org_test456");
    expect(orgHeader).not.toBe("org_someone_else");
  });

  it("returns the upstream body byte-identical, unknown fields included", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/reward-tasks`);
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("forwards an upstream refusal field-for-field with its own status", async () => {
    const upstreamError = { error: "Brand is not claimed by this org", code: "FORBIDDEN" };
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 403,
      headers: { get: () => "application/json" },
      json: async () => upstreamError,
      text: async () => JSON.stringify(upstreamError),
    }));

    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/reward-tasks`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(upstreamError);
  });

  it("surfaces an upstream 502 as a 502, never a defaulted nothing-is-due", async () => {
    const upstreamError = { error: "brand-service unavailable" };
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 502,
      headers: { get: () => "application/json" },
      json: async () => upstreamError,
      text: async () => JSON.stringify(upstreamError),
    }));

    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/reward-tasks`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual(upstreamError);
  });
});
