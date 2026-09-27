import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load, so set it before the imports.
const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { FEATURES_BASE };
});

/**
 * One workflow dynasty's fleet-wide return history, two tiers:
 *  - GET /v1/public/features/workflow-return-history  → public, billed basis, no identity
 *  - GET /v1/features/workflow-return-history/actual-cost → STAFF ONLY (reveals margin)
 *
 * Deliberately NO auth mock: the real authenticatePlatform + requireStaff run, so "a
 * non-staff caller is refused" is a fact about the shipped gate, and every refusal
 * asserts ZERO outbound calls.
 */

const { createRun } = vi.hoisted(() => ({ createRun: vi.fn() }));
vi.mock("@distribute/runs-client", () => ({
  createRun,
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const QS = "featureSlug=sales-cold-email-outreach&workflowDynastySlug=sales-email-cold-outreach-mintaka";

const STAFF = { "x-api-key": "platform-test-key", "x-email": "kevin@distribute.you" };

// A fixture, not a contract this repo owns — features-service names these fields.
const BODY = { costBasis: "billed", history: { points: [{ date: "2026-09-01", cumulativeSpendUsd: 1 }] } };

let calls: Array<{ url: string; options: any }>;

function stub(status: number, body: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  calls = [];
  createRun.mockReset().mockResolvedValue({ id: "run-1" });
  stub(200, JSON.stringify(BODY));
});

describe("GET /v1/public/features/workflow-return-history", () => {
  it("forwards the query verbatim to the public producer route with no identity and returns the body verbatim", async () => {
    const res = await request(buildApp()).get(`/v1/public/features/workflow-return-history?${QS}&extra=1`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/public/stats/workflow-return-history?${QS}&extra=1`);
    const h = calls[0].options.headers ?? {};
    expect(h["x-org-id"]).toBeUndefined();
    expect(h["x-user-id"]).toBeUndefined();
    expect(h["x-email"]).toBeUndefined();
  });

  it("forwards a downstream error status and body field-for-field", async () => {
    stub(404, JSON.stringify({ error: "Unknown workflow dynasty", code: "not_found" }));
    const res = await request(buildApp()).get(`/v1/public/features/workflow-return-history?${QS}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Unknown workflow dynasty", code: "not_found" });
  });
});

describe("GET /v1/features/workflow-return-history/actual-cost — staff", () => {
  const PATH = `/v1/features/workflow-return-history/actual-cost?${QS}`;

  it("forwards to the internal producer route with the service key and the staff email, body verbatim", async () => {
    const actual = { ...BODY, costBasis: "actual" };
    stub(200, JSON.stringify(actual));
    const res = await request(buildApp()).get(PATH).set(STAFF);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(actual);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/stats/workflow-return-history/actual-cost?${QS}`);
    expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
    expect(calls[0].options.headers["x-email"]).toBe("kevin@distribute.you");
  });

  it("forwards a downstream error status and body field-for-field", async () => {
    stub(400, JSON.stringify({ error: "workflowDynastySlug is required" }));
    const res = await request(buildApp()).get(PATH).set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "workflowDynastySlug is required" });
  });

  it("403s a platform-keyed caller whose email is not staff, before any downstream call", async () => {
    const res = await request(buildApp()).get(PATH).set({ ...STAFF, "x-email": "someone@customer.example" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("403s a platform-keyed caller with no email", async () => {
    const res = await request(buildApp()).get(PATH).set({ "x-api-key": "platform-test-key" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("401s a staff email with a user bearer key instead of the platform key", async () => {
    const res = await request(buildApp())
      .get(PATH)
      .set({ authorization: "Bearer dist_somekey", "x-email": "kevin@distribute.you" });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("401s with no credentials", async () => {
    const res = await request(buildApp()).get(PATH);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("the public route never reaches the internal actual-cost path", async () => {
    await request(buildApp()).get(`/v1/public/features/workflow-return-history?${QS}`);
    expect(calls[0].url).not.toContain("/internal/");
  });
});
