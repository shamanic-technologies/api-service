import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE };
});

/**
 * Per-funnel daily budgets — BEHAVIOURAL cover for the three proxies.
 *
 * These routes ship dormant (the dashboard consumer lands after this), so nothing in
 * production would report a wrong downstream path for us — CLAUDE.md #7 corollary 2:
 * a route with no live caller gets a behavioural test, not a lighter one. Source-substring
 * assertions cannot see a template literal's interpolated value, so the real router is
 * driven with supertest and a stubbed fetch, asserting the FULL forwarded URL, the
 * forwarded identity, and the byte-identical body in both directions.
 *
 * Per CLAUDE.md #6/#8 the payloads below are fixtures, not a contract this repo owns.
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

import billingRouter from "../../src/routes/billing.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", billingRouter);
  return app;
}

const BRAND_ID = "7f9c2b1e-3d4a-4c5b-9e6f-0a1b2c3d4e5f";

const UPSTREAM_BODY = {
  brandId: BRAND_ID,
  orgId: "org_test456",
  dailyBudgetCents: "2500",
  funnels: [
    { funnelKey: "visit_signup", dailyBudgetCents: "100", updatedAt: "2026-08-01T10:00:00.000Z" },
    { funnelKey: "reply_meeting", dailyBudgetCents: "2400", updatedAt: "2026-08-01T10:00:00.000Z" },
  ],
};

let calls: Array<{ url: string; options: any }>;

function stubFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    if (status >= 200 && status < 300) {
      return { ok: true, status, json: () => Promise.resolve(body) };
    }
    return {
      ok: false,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    };
  });
}

beforeEach(() => {
  calls = [];
  stubFetch(200, UPSTREAM_BODY);
});

describe("GET /v1/brands/:brandId/funnel-budgets — over the wire", () => {
  it("forwards to billing's real path, carrying the resolved org identity", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/funnel-budgets`);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/funnel-budgets`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["X-API-Key"]).toBe("billing-test-key");
  });

  it("returns billing's body unchanged", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/funnel-budgets`);
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("ignores a caller-supplied org — only the authenticated org reaches billing", async () => {
    await request(buildApp())
      .get(`/v1/brands/${BRAND_ID}/funnel-budgets`)
      .set("x-org-id", "someone-elses-org");

    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("rejects a non-UUID brand id without calling billing", async () => {
    const res = await request(buildApp()).get("/v1/brands/not-a-uuid/funnel-budgets");
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("PUT /v1/brands/:brandId/funnel-budgets — over the wire", () => {
  const BODY = {
    funnels: [
      { funnelKey: "visit_signup", dailyBudgetCents: 100 },
      { funnelKey: "reply_meeting", dailyBudgetCents: "2400" },
    ],
  };

  it("forwards the whole-set write byte-identically", async () => {
    const res = await request(buildApp()).put(`/v1/brands/${BRAND_ID}/funnel-budgets`).send(BODY);

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/funnel-budgets`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual(BODY);
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("does not validate the payload itself — an empty funnel set still reaches billing", async () => {
    // The gateway declares no minimum, no cap, no funnel vocabulary (CLAUDE.md #4/#8):
    // billing owns the rules, so its 400 is the answer the caller must see.
    stubFetch(400, { error: "funnels must contain at least 1 element", code: "INVALID_FUNNEL_SET" });

    const res = await request(buildApp())
      .put(`/v1/brands/${BRAND_ID}/funnel-budgets`)
      .send({ funnels: [] });

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].options.body)).toEqual({ funnels: [] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "funnels must contain at least 1 element",
      code: "INVALID_FUNNEL_SET",
    });
  });

  it("propagates a below-minimum refusal with its status AND its fields intact", async () => {
    stubFetch(400, {
      error: "reply_meeting must be at least $24/day when funded",
      code: "FUNNEL_BELOW_MINIMUM",
      details: { funnelKey: "reply_meeting", minimumCents: "2400" },
    });

    const res = await request(buildApp())
      .put(`/v1/brands/${BRAND_ID}/funnel-budgets`)
      .send({ funnels: [{ funnelKey: "reply_meeting", dailyBudgetCents: 100 }] });

    // Not flattened into { error: "<the whole JSON body>" } — the fields survive (CLAUDE.md #7).
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "reply_meeting must be at least $24/day when funded",
      code: "FUNNEL_BELOW_MINIMUM",
      details: { funnelKey: "reply_meeting", minimumCents: "2400" },
    });
  });
});

describe("PATCH /v1/brands/:brandId/funnel-budgets/:funnelKey — over the wire", () => {
  it("forwards the single-funnel write to the keyed path", async () => {
    const res = await request(buildApp())
      .patch(`/v1/brands/${BRAND_ID}/funnel-budgets/visit_signup`)
      .send({ dailyBudgetCents: 500 });

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/funnel-budgets/visit_signup`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ dailyBudgetCents: 500 });
    expect(res.body).toEqual(UPSTREAM_BODY);
  });

  it("forwards an unknown funnel key rather than inventing its own 400", async () => {
    stubFetch(400, { error: "Unknown funnel key: not_a_funnel", code: "UNKNOWN_FUNNEL_KEY" });

    const res = await request(buildApp())
      .patch(`/v1/brands/${BRAND_ID}/funnel-budgets/not_a_funnel`)
      .send({ dailyBudgetCents: 500 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/funnel-budgets/not_a_funnel`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown funnel key: not_a_funnel", code: "UNKNOWN_FUNNEL_KEY" });
  });

  it("accepts a zero ceiling — 'not funding that funnel' is billing's business, not the gateway's", async () => {
    await request(buildApp())
      .patch(`/v1/brands/${BRAND_ID}/funnel-budgets/visit_form`)
      .send({ dailyBudgetCents: 0 });

    expect(JSON.parse(calls[0].options.body)).toEqual({ dailyBudgetCents: 0 });
  });
});

describe("PATCH /v1/brands/:brandId/daily-budget — the legacy brand-level write", () => {
  it("still forwards to billing's brand-level path unchanged", async () => {
    const res = await request(buildApp())
      .patch(`/v1/brands/${BRAND_ID}/daily-budget`)
      .send({ dailyBudgetCents: 2500 });

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/brands/${BRAND_ID}/daily-budget`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ dailyBudgetCents: 2500 });
  });

  it("propagates the 409 refusal for a brand already funded per funnel, body field-for-field", async () => {
    stubFetch(409, {
      error: "This brand is funded per funnel — set the funnel ceilings instead",
      code: "FUNNEL_BUDGETS_PRESENT",
      details: { brandId: BRAND_ID },
    });

    const res = await request(buildApp())
      .patch(`/v1/brands/${BRAND_ID}/daily-budget`)
      .send({ dailyBudgetCents: 2500 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: "This brand is funded per funnel — set the funnel ceilings instead",
      code: "FUNNEL_BUDGETS_PRESENT",
      details: { brandId: BRAND_ID },
    });
  });
});
