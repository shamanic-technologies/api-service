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
 * PATCH /v1/campaigns/:id — campaign-service refuses a restart for an org whose card was
 * declined (409 payment_declined) or when it cannot read billing (502 billing_unavailable).
 * The dashboard renders `error` verbatim and branches on `reason`, so the refusal must reach
 * the caller under campaign-service's status with its body forwarded field-for-field.
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

const CAMPAIGN_ID = "3c1f7a2e-9b4d-4e8a-a1c2-5d6e7f8a9b0c";
let calls: Array<{ url: string; options: any }>;

function stubFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    if (status >= 200 && status < 300) {
      return { ok: true, status, json: () => Promise.resolve(body) };
    }
    return { ok: false, status, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) };
  });
}

beforeEach(() => {
  calls = [];
});

describe("PATCH /v1/campaigns/:id", () => {
  it("forwards a 409 payment_declined refusal field-for-field", async () => {
    const refusal = {
      error: "Your card was declined. Update your payment method to restart this campaign.",
      reason: "payment_declined",
      blockedReason: "payment_declined",
    };
    stubFetch(409, refusal);
    const res = await request(buildApp()).patch(`/v1/campaigns/${CAMPAIGN_ID}`).send({ status: "activate" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(refusal);
    expect(calls[0].url).toBe(`${CAMPAIGN_BASE}/campaigns/${CAMPAIGN_ID}`);
    expect(calls[0].options.method).toBe("PATCH");
  });

  it("forwards a 502 billing_unavailable refusal field-for-field", async () => {
    const refusal = { error: "We could not check your billing right now. Try again shortly.", reason: "billing_unavailable" };
    stubFetch(502, refusal);
    const res = await request(buildApp()).patch(`/v1/campaigns/${CAMPAIGN_ID}`).send({ status: "activate" });
    expect(res.status).toBe(502);
    expect(res.body).toEqual(refusal);
  });

  it("success path unchanged: body forwarded both ways", async () => {
    const upstream = { campaign: { id: CAMPAIGN_ID, status: "ongoing" } };
    stubFetch(200, upstream);
    const body = { status: "activate" };
    const res = await request(buildApp()).patch(`/v1/campaigns/${CAMPAIGN_ID}`).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });
});
