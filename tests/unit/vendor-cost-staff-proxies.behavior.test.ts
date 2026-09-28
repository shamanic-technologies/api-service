import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load, so set it before the imports.
const { FEATURES_BASE, RUNS_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  const RUNS_BASE = "http://runs.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.RUNS_SERVICE_URL = RUNS_BASE;
  process.env.RUNS_SERVICE_API_KEY = "runs-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { FEATURES_BASE, RUNS_BASE };
});

/**
 * The two vendor-basis reads reveal our margin, so they are STAFF ONLY:
 *   GET /v1/features/:slug/workflow-projection/actual-cost → features-service /internal/.../workflow-projection/actual-cost
 *   GET /v1/runs/vendor                                    → runs-service /internal/runs/vendor?orgId=<authenticated org>
 *
 * No auth mock: the real authenticatePlatform + requireStaff + authenticate chain runs, and
 * every refusal asserts ZERO outbound calls and no request run opened.
 */
const { createRun } = vi.hoisted(() => ({ createRun: vi.fn() }));
vi.mock("@distribute/runs-client", () => ({
  createRun,
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

import featuresRouter from "../../src/routes/features.js";
import runsRouter from "../../src/routes/runs.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  app.use("/v1", runsRouter);
  return app;
}

const ORG = "2c2c1c9f-9a7b-4a0b-8b2f-8d2a3a4b5c6d";
const OTHER_ORG = "9f9f9f9f-9a7b-4a0b-8b2f-8d2a3a4b5c6d";
const USER = "7d7d6c9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const BRAND = "4e4e3ebb-bbc9-4c2d-8d4b-af4c5c6d7e8f";

const STAFF = {
  "x-api-key": "platform-test-key",
  "x-email": "kevin@distribute.you",
  "x-org-id": ORG,
  "x-user-id": USER,
};

// Fixtures, not contracts this repo owns.
const PROJECTION = { costBasis: "actual", rows: [{ workflowDynastySlug: "w", costPerOutcomeUsd: 1.5 }] };
const RUNS = { runs: [{ id: "r1", ownTotalCostInUsdCents: "10", vendorOwnTotalCostInUsdCents: "2" }], limit: 50, offset: 0 };

const PROJECTION_PATH = `/v1/features/sales-cold-email-outreach/workflow-projection/actual-cost?brandId=${BRAND}&goal=meetingBooked`;
const RUNS_PATH = `/v1/runs/vendor?brandId=${BRAND}&status=completed&limit=20`;

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
});

describe("GET /v1/features/:slug/workflow-projection/actual-cost — staff", () => {
  it("forwards to features-service's internal path with the viewed org's identity and returns the body verbatim", async () => {
    stub(200, JSON.stringify(PROJECTION));
    const res = await request(buildApp()).get(PROJECTION_PATH).set(STAFF);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(PROJECTION);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/internal/features/sales-cold-email-outreach/workflow-projection/actual-cost?brandId=${BRAND}&goal=meetingBooked`,
    );
    expect(calls[0].options.headers["X-API-Key"]).toBe("features-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe(ORG);
    expect(calls[0].options.headers["x-user-id"]).toBe(USER);
  });

  it("forwards features-service's error status and body field-for-field", async () => {
    stub(400, JSON.stringify({ error: "brandId is required", code: "missing_brand" }));
    const res = await request(buildApp()).get(PROJECTION_PATH).set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "brandId is required", code: "missing_brand" });
  });

  it("leaves the customer projection route on the customer path", async () => {
    stub(200, JSON.stringify(PROJECTION));
    await request(buildApp())
      .get(`/v1/features/sales-cold-email-outreach/workflow-projection?brandId=${BRAND}`)
      .set(STAFF);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/features/sales-cold-email-outreach/workflow-projection?brandId=${BRAND}`);
  });
});

describe("GET /v1/runs/vendor — staff", () => {
  it("forwards to runs-service /internal/runs/vendor with the authenticated org as orgId and the rest of the query verbatim", async () => {
    stub(200, JSON.stringify(RUNS));
    const res = await request(buildApp()).get(RUNS_PATH).set(STAFF);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(RUNS);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${RUNS_BASE}/internal/runs/vendor?brandId=${BRAND}&status=completed&limit=20&orgId=${ORG}`);
    expect(calls[0].options.headers["x-org-id"]).toBe(ORG);
  });

  it("a caller-supplied orgId never chooses the org", async () => {
    stub(200, JSON.stringify(RUNS));
    await request(buildApp())
      .get(`/v1/runs/vendor?orgId=${OTHER_ORG}&limit=5&org%49d=${OTHER_ORG}`)
      .set(STAFF);
    expect(calls[0].url).toBe(`${RUNS_BASE}/internal/runs/vendor?limit=5&orgId=${ORG}`);
    expect(calls[0].url).not.toContain(OTHER_ORG);
  });

  it("with no query, still sends the authenticated org", async () => {
    stub(200, JSON.stringify(RUNS));
    await request(buildApp()).get("/v1/runs/vendor").set(STAFF);
    expect(calls[0].url).toBe(`${RUNS_BASE}/internal/runs/vendor?orgId=${ORG}`);
  });

  it("forwards runs-service's error status and body field-for-field", async () => {
    stub(400, JSON.stringify({ error: "Invalid status" }));
    const res = await request(buildApp()).get(RUNS_PATH).set(STAFF);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid status" });
  });

  it("`vendor` is not bound as a run id: GET /v1/runs/:id is untouched", async () => {
    stub(200, JSON.stringify({ id: "abc", organizationId: ORG }));
    await request(buildApp()).get("/v1/runs/abc").set(STAFF);
    expect(calls[0].url).toBe(`${RUNS_BASE}/v1/runs/abc`);
  });
});

for (const [name, path] of [
  ["workflow-projection/actual-cost", PROJECTION_PATH],
  ["runs/vendor", RUNS_PATH],
] as const) {
  describe(`${name} — refusal before any downstream call`, () => {
    beforeEach(() => stub(200, "{}"));

    it("403s a platform-keyed caller whose email is not staff", async () => {
      const res = await request(buildApp()).get(path).set({ ...STAFF, "x-email": "someone@customer.example" });
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
      expect(createRun).not.toHaveBeenCalled();
    });

    it("403s a platform-keyed caller with no email", async () => {
      const { "x-email": _omit, ...noEmail } = STAFF;
      const res = await request(buildApp()).get(path).set(noEmail);
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it("401s a staff email on a user bearer key", async () => {
      const res = await request(buildApp())
        .get(path)
        .set({ authorization: "Bearer dist_somekey", "x-email": "kevin@distribute.you", "x-org-id": ORG, "x-user-id": USER });
      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    it("401s with no credentials", async () => {
      const res = await request(buildApp()).get(path);
      expect(res.status).toBe(401);
      expect(calls).toHaveLength(0);
    });
  });
}
