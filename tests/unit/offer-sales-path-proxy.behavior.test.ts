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
 * GET|PUT /v1/brands/:id/offers/:offerId/sales-path: BEHAVIOURAL cover over the real router with a stubbed fetch. Each reaches
 * brand-service's own path with the authenticated identity, and brand-service's 409
 * (reason offer_has_ongoing_campaign) comes back AS a 409 with its body, which the
 * dashboard keys its plain-words explanation on.
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

describe("offer sales-path proxies", () => {
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

  it("GET reaches brand-service's own path with the identity and returns its body", async () => {
    const body = { offerId: OFFER_ID, stated: false, steps: null, legKeys: null, statedAt: null };
    stub(200, body);
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/sales-path`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}/sales-path`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("PUT forwards the body and the identity", async () => {
    const sent = { steps: ["website_visit", "signup"], legKeys: ["website_visit_to_signup"] };
    stub(200, { offerId: OFFER_ID, stated: true, ...sent, statedAt: "2026-09-29T00:00:00Z" });
    const res = await request(buildApp()).put(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/sales-path`).send(sent);
    expect(res.status).toBe(200);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual(sent);
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it("forwards brand-service's 404 AS a 404", async () => {
    stub(404, { error: "Offer not found", code: "OFFER_NOT_FOUND" });
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/sales-path`);
    expect(res.status).toBe(404);
  });
});
