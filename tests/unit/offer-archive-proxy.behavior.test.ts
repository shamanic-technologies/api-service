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
 * POST /v1/brands/:id/offers/:offerId/archive|unarchive, and the list's includeArchived
 * query: BEHAVIOURAL cover over the real router with a stubbed fetch. Each reaches
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

describe("offer archive proxies", () => {
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

  for (const action of ["archive", "unarchive"]) {
    it(`POST .../${action} reaches brand-service's own path with the identity`, async () => {
      const body = { offer: { offerId: OFFER_ID, status: action === "archive" ? "archived" : "active" } };
      stub(200, body);
      const res = await request(buildApp()).post(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/${action}`).send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual(body);
      expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers/${OFFER_ID}/${action}`);
      expect(calls[0].options.method).toBe("POST");
      expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
      expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    });
  }

  it("forwards the 409 offer_has_ongoing_campaign refusal AS a 409 with its body", async () => {
    const refusal = { error: "This offer has 1 ongoing campaign(s).", reason: "offer_has_ongoing_campaign", campaignIds: ["c1"] };
    stub(409, refusal);
    const res = await request(buildApp()).post(`/v1/brands/${BRAND_ID}/offers/${OFFER_ID}/archive`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: "offer_has_ongoing_campaign", campaignIds: ["c1"] });
  });

  it("forwards includeArchived on the list", async () => {
    stub(200, { offers: [] });
    await request(buildApp()).get(`/v1/brands/${BRAND_ID}/offers?includeArchived=true`);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/offers?includeArchived=true`);
  });
});
