import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE };
});

/**
 * DISTRY-CALL-IS-CAMPAIGN-1121: a sales funnel campaign may name NO offer. billing-service serves its caps on
 * an offer-less mirror of the funnel caps route; the gateway passes it through exactly like the offer route
 * (same auth, same identity headers, same body, billing's status + body verbatim), and never sends an
 * `/offers/...` segment for it. The offer route is pinned unchanged beside it.
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

import billingRouter from "../../src/routes/billing.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", billingRouter);
  return app;
}

let calls: Array<{ url: string; options: any }>;
function stubUpstream(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    };
  });
}

const header = (options: any, name: string) => {
  const h = options?.headers ?? {};
  return h instanceof Headers ? h.get(name) : h[name];
};

const FUNNEL = "cold-email@lead-found+reply";
const ENC = encodeURIComponent(FUNNEL);
const CAPS = { offerId: null, salesFunnelId: FUNNEL, maxBudget: { amountCents: 5000, period: "monthly" }, maxVolume: null, reached: false };

beforeEach(() => {
  calls = [];
});

describe("offer-less sales funnel caps → billing's offer-less path", () => {
  for (const method of ["get", "put", "delete"] as const) {
    it(`${method.toUpperCase()} proxies with no offer segment, identity headers and billing's body verbatim`, async () => {
      stubUpstream(200, CAPS);
      const body = { maxBudget: { amountCents: 5000, period: "monthly" }, maxVolume: null };
      const req = request(buildApp())[method](`/v1/brands/brand-1/sales-funnels/${ENC}/caps`);
      const res = method === "put" ? await req.send(body) : await req;

      expect(res.status).toBe(200);
      expect(res.body).toEqual(CAPS);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/brand-1/sales-funnels/${ENC}/caps`);
      expect(calls[0].url).not.toContain("/offers/");
      expect(calls[0].options.method ?? "GET").toBe(method.toUpperCase());
      expect(header(calls[0].options, "x-org-id")).toBe("org_test456");
      expect(header(calls[0].options, "x-user-id")).toBe("user_test123");
      expect(header(calls[0].options, "x-run-id")).toBe("run_test789");
      if (method === "put") expect(JSON.parse(calls[0].options.body)).toEqual(body);
    });
  }

  it("forwards billing's refusal status and body verbatim", async () => {
    const refusal = { error: "Sales funnel not found", code: "sales_funnel_not_found" };
    stubUpstream(404, refusal);
    const res = await request(buildApp()).get(`/v1/brands/brand-1/sales-funnels/${ENC}/caps`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject(refusal);
  });

  it("offer route unchanged: still proxies to billing's /offers/{offerId} path", async () => {
    stubUpstream(200, { ...CAPS, offerId: "offer-9" });
    const res = await request(buildApp()).get(`/v1/brands/brand-1/offers/offer-9/sales-funnels/${ENC}/caps`);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/brand-1/offers/offer-9/sales-funnels/${ENC}/caps`);
  });
});
