import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { BRAND_BASE } = vi.hoisted(() => {
  const BRAND_BASE = "http://brand.test.local";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { BRAND_BASE };
});

/**
 * GET /v1/brands/:id/offers/:offerId/steps and PUT|DELETE .../steps/:stepKey (owner 2026-10-12):
 * BEHAVIOURAL cover over the real router with a stubbed fetch. Each reaches brand-service's own
 * path with the authenticated identity, the body comes back byte-identical, and brand-service's
 * 400 unknown_step comes back AS a 400 with its body.
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

import brandRouter from "../../src/routes/brand.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";
const OFFER_ID = "0d3d1f2c-8f4a-4a2e-9d1b-2f0f6a7c5b31";

describe("offer steps proxies", () => {
  let calls: Array<{ url: string; options: any }>;

  function stub(status: number, body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      };
    });
  }

  beforeEach(() => {
    calls = [];
  });

  it("GET .../steps reaches brand-service's own path with the identity", async () => {
    const body = { offerId: OFFER_ID, stated: true, steps: ["conversation", "booking_call"], statedAt: "2026-10-08T17:18:58.221Z" };
    stub(200, body);
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/steps`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}/steps`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  for (const method of ["put", "delete"] as const) {
    it(`${method.toUpperCase()} .../steps/:stepKey reaches brand-service's own path with the step`, async () => {
      const body = { offerId: OFFER_ID, stated: true, steps: ["purchase"], statedAt: "x", changed: true };
      stub(200, body);
      const res = await request(buildApp())[method](`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/steps/purchase`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(body);
      expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}/steps/purchase`);
      expect(calls[0].options.method).toBe(method.toUpperCase());
      expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    });
  }

  it("encodes the step key into the downstream path", async () => {
    stub(400, { reason: "unknown_step" });
    await request(buildApp()).put(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/steps/a%2Fb`);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}/steps/a%2Fb`);
  });

  it("forwards the 400 unknown_step refusal AS a 400 with its body", async () => {
    const refusal = { error: '"teleport" is not a step of the platform.', reason: "unknown_step", stepKey: "teleport", knownSteps: ["purchase"] };
    stub(400, refusal);
    const res = await request(buildApp()).put(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/steps/teleport`);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ reason: "unknown_step", stepKey: "teleport", knownSteps: ["purchase"] });
  });
});
