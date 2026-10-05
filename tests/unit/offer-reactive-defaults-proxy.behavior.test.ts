import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { CAMPAIGN_BASE } = vi.hoisted(() => {
  const CAMPAIGN_BASE = "http://campaign.test.local";
  process.env.CAMPAIGN_SERVICE_URL = CAMPAIGN_BASE;
  process.env.CAMPAIGN_SERVICE_API_KEY = "campaign-test-key";
  return { CAMPAIGN_BASE };
});

/**
 * Offer reactive defaults: BEHAVIOURAL cover over the real router with a stubbed fetch.
 * The body reaches campaign-service untouched, its brandId also rides x-brand-id, and
 * campaign-service's status reaches the caller.
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

import campaignsRouter from "../../src/routes/campaigns.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignsRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";
const OFFER_ID = "0d3d1f2c-8f4a-4a2e-9d1b-2f0f6a7c5b31";
const PATH = `/v1/offers/${OFFER_ID}/reactive-defaults`;

describe("offer reactive defaults proxy", () => {
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

  it("forwards the body untouched, promotes brandId to x-brand-id, carries the identity", async () => {
    const answer = {
      offerId: OFFER_ID,
      basis: "stated",
      tickedCombinationKeys: ["k"],
      started: [],
      alreadyOn: ["c1"],
      keptOff: [],
      skipped: [],
    };
    stub(200, answer);
    const res = await request(buildApp()).post(PATH).send({ brandId: BRAND_ID });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(answer);
    expect(calls[0].url).toBe(`${CAMPAIGN_BASE}/offers/${OFFER_ID}/reactive-defaults`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual({ brandId: BRAND_ID });
    expect(calls[0].options.headers["x-brand-id"]).toBe(BRAND_ID);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
  });

  it("refuses a body brandId that contradicts the query brandId, without calling downstream", async () => {
    stub(200, {});
    const res = await request(buildApp())
      .post(`${PATH}?brandId=11111111-1111-4111-8111-111111111111`)
      .send({ brandId: BRAND_ID });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [400, { error: "brandId required" }],
    [409, { error: "Payment on hold", reason: "payment_declined" }],
    [502, { error: "Sales paths unavailable", reason: "sales_paths_unavailable" }],
  ])("forwards campaign-service's %i with its body", async (status, body) => {
    stub(status, body);
    const res = await request(buildApp()).post(PATH).send({});
    expect(res.status).toBe(status);
    expect(res.body.reason ?? res.body.error).toBe((body as any).reason ?? body.error);
  });
});
