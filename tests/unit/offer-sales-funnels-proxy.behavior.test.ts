import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { FEATURES_BASE };
});

/**
 * GET /v1/offers/:offerId/sales-funnels → features-service GET /internal/catalogue/sales-funnels
 * priced for the offer (owner 2026-10-10: the signup wall shows THIS offer's return). Asserted on
 * the wire: the offer is the path's, runnable is forced on, the rest of the query rides verbatim,
 * the org is the AUTHENTICATED one, and the body and refusals pass through unchanged.
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
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

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const OFFER = "d5ecba00-783a-4939-b5bd-f85b9e6b7d9e";
const BRAND = "75d7e3e8-6926-4f85-a557-976895400666";
let calls: Array<{ url: string; options: any }>;
function upstream(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}
beforeEach(() => {
  calls = [];
});

describe("GET /v1/offers/:offerId/sales-funnels", () => {
  it("prices for the path's offer, forces runnable, forwards the query and the authenticated org", async () => {
    const body = { object: "sales_funnel", offer: { offerId: OFFER, lifetimeRevenueUsd: 5000 }, rows: [{ id: "f", roi: 4.2 }], someNewField: 1 };
    upstream(200, body);
    const res = await request(buildApp()).get(`/v1/offers/${OFFER}/sales-funnels?brandId=${BRAND}&containsChannels=sales-cold-email-outreach&limit=25&runnable=false&offerId=other`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    const u = new URL(calls[0].url);
    expect(`${u.origin}${u.pathname}`).toBe(`${FEATURES_BASE}/internal/catalogue/sales-funnels`);
    expect(u.searchParams.getAll("offerId")).toEqual([OFFER]);
    expect(u.searchParams.getAll("runnable")).toEqual(["true"]);
    expect(u.searchParams.get("brandId")).toBe(BRAND);
    expect(u.searchParams.get("containsChannels")).toBe("sales-cold-email-outreach");
    expect(u.searchParams.get("limit")).toBe("25");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("forwards the producer's refusal field for field", async () => {
    upstream(404, { error: "no offer", reason: "offer_not_found" });
    const res = await request(buildApp()).get(`/v1/offers/${OFFER}/sales-funnels?brandId=${BRAND}`);
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("offer_not_found");
  });
});
