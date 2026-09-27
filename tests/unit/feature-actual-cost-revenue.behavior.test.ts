import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load, so set it before the imports.
const { FEATURES_BASE, BRAND_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  const BRAND_BASE = "http://brand.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { FEATURES_BASE, BRAND_BASE };
});

/**
 * GET /v1/features/:slug/revenue/actual-cost — reveals our margin, so it is STAFF ONLY.
 *
 * Deliberately NO auth mock: the real authenticatePlatform + requireStaff + authenticate
 * chain runs, so "a non-staff caller is refused" is a fact about the shipped gate. Every
 * refusal asserts ZERO outbound calls — a stubbed fetch that was hit means the request
 * got past the gate.
 */

// authenticate opens a request run in runs-service; stub it so `calls` holds only the
// proxied downstream request. createRun is asserted NOT called on every refusal: the
// staff gate runs before authenticate, so a non-staff caller reaches no service at all.
const { createRun } = vi.hoisted(() => ({ createRun: vi.fn() }));
vi.mock("@distribute/runs-client", () => ({
  createRun,
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

import featuresRouter from "../../src/routes/features.js";
import brandRouter from "../../src/routes/brand.js";
import { downstreamUrl } from "../../src/lib/service-client.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  app.use("/v1", brandRouter);
  return app;
}

const ORG = "2c2c1c9f-9a7b-4a0b-8b2f-8d2a3a4b5c6d";
const USER = "7d7d6c9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const BRAND = "4e4e3ebb-bbc9-4c2d-8d4b-af4c5c6d7e8f";

const STAFF = {
  "x-api-key": "platform-test-key",
  "x-email": "kevin@distribute.you",
  "x-org-id": ORG,
  "x-user-id": USER,
};

// A fixture, not a contract this repo owns — features-service names these fields.
const BODY = {
  featureSlug: "sales-cold-email-outreach",
  costBasis: "actual",
  workflow: "sales-email-cold-outreach-mintaka-v3",
  actualCostHistory: {
    daily: [{ date: "2026-09-01", actualCostUsd: 1.23 }],
    datedPipelineUsd: 10,
    undatedPipelineUsd: 0,
    unpricedBilledCostUsd: 0,
    unpricedFromDate: null,
  },
};

const PATH = `/v1/features/sales-cold-email-outreach/revenue/actual-cost?brandId=${BRAND}&workflow=sales-email-cold-outreach-mintaka-v3&cause=reply`;

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

describe("GET /v1/features/:slug/revenue/actual-cost — staff", () => {
  it("forwards to features-service's internal path with the viewed org's identity and returns the body verbatim", async () => {
    const res = await request(buildApp()).get(PATH).set(STAFF);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/internal/features/sales-cold-email-outreach/revenue/actual-cost?brandId=${BRAND}&workflow=sales-email-cold-outreach-mintaka-v3&cause=reply`,
    );
    expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe(ORG);
    expect(calls[0].options.headers["x-user-id"]).toBe(USER);
  });

  it("forwards features-service's error status and body field-for-field", async () => {
    stub(400, JSON.stringify({ error: "workflow is required", code: "missing_workflow" }));
    const res = await request(buildApp()).get(PATH).set(STAFF);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "workflow is required", code: "missing_workflow" });
  });
});

describe("GET /v1/features/:slug/revenue/actual-cost — refusal before any downstream call", () => {
  it("403s a platform-keyed caller whose email is not staff", async () => {
    const res = await request(buildApp())
      .get(PATH)
      .set({ ...STAFF, "x-email": "someone@customer.example" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Staff access required");
    expect(calls).toHaveLength(0);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("403s a platform-keyed caller with no email", async () => {
    const { "x-email": _omit, ...noEmail } = STAFF;
    const res = await request(buildApp()).get(PATH).set(noEmail);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("401s a staff email without the platform key (a user's bearer key is not enough)", async () => {
    const res = await request(buildApp())
      .get(PATH)
      .set({ authorization: "Bearer dist_somekey", "x-email": "kevin@distribute.you", "x-org-id": ORG, "x-user-id": USER });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("401s with no credentials", async () => {
    const res = await request(buildApp()).get(PATH);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("no other route can climb into /internal/.../actual-cost", () => {
  it("the customer revenue route still forwards to /features/:slug/revenue, not the internal curve", async () => {
    await request(buildApp())
      .get(`/v1/features/sales-cold-email-outreach/revenue?brandId=${BRAND}`)
      .set(STAFF);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/features/sales-cold-email-outreach/revenue?brandId=${BRAND}`);
  });

  it("a crafted slug on the customer revenue route stays encoded and never leaves /features/", async () => {
    await request(buildApp())
      .get(`/v1/features/..%2F..%2Finternal%2Ffeatures%2Fx%2Frevenue%2Factual-cost%3F/revenue`)
      .set(STAFF);
    // encodeURIComponent keeps the payload inside one segment under /features/.
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname.startsWith("/features/")).toBe(true);
    expect(calls[0].url).not.toContain("/internal/");
  });

  it("a route interpolating a decoded param refuses a dot-segment path with 400 and no downstream call", async () => {
    // Express decodes %2F in req.params; /v1/brands/:id builds `/internal/brands/${id}`.
    const res = await request(buildApp())
      .get(`/v1/brands/..%2F..%2Finternal%2Fsomething-private`)
      .set(STAFF);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("the same brand route still works for an ordinary id", async () => {
    stub(200, JSON.stringify({ brand: { id: BRAND } }));
    const res = await request(buildApp()).get(`/v1/brands/${BRAND}`).set(STAFF);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BRAND_BASE}/internal/brands/${BRAND}`);
  });
});

describe("downstreamUrl — dot-segment guard", () => {
  const refused = [
    "/internal/brands/../../internal/x",
    "/brands/./x",
    "/brands/%2e%2e/internal",
    "/brands/%2E./internal",
    "/brands/.%2e/internal",
    "/brands/..\\internal",
    "/brands/..",
  ];
  for (const path of refused) {
    it(`refuses ${path}`, () => {
      expect(() => downstreamUrl("http://svc", path)).toThrow(/dot-segments/);
    });
  }

  const allowed = [
    "/internal/brands/abc",
    "/features/..%2F..%2Finternal/revenue",
    "/features/x/revenue?note=../../etc",
    "/brands/v1.2/x",
    "/brands/.../x",
  ];
  for (const path of allowed) {
    it(`allows ${path}`, () => {
      expect(downstreamUrl("http://svc", path)).toBe(`http://svc${path}`);
    });
  }
});
