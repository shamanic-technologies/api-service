import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/** OUTCOME-FINEST-1106: the brand Outcome page of one published outcome → features-service, pass-through. */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "user_key";
    next();
  },
  authenticatePlatform: (_req: any, _res: any, next: any) => next(),
  requireStaff: (_req: any, _res: any, next: any) => next(),
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import featuresRouter from "../../src/routes/features.js";
import { buildDocument } from "../../src/openapi/document.js";

const BRAND = "933d4abb-9695-4fcb-b3aa-354d61565798";
const BODY = {
  brandId: BRAND,
  pricing: "gross",
  targets: [{ salesFunnelCampaignId: "c1", outcomesToDate: 3, costPerOutcomeUsd: 41.5, measuredReturn: null, measuredReturnUnavailableReason: "nothing_spent_yet", past: [], projection: null }],
  brandNew: 1,
};

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", featuresRouter);
  return a;
}

describe("published-units proxy", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(BODY), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  it("forwards to the exact features-service path, query verbatim, authenticated identity, body byte-equal", async () => {
    const q = "?pricing=gross&x=1&x=2";
    const res = await request(app()).get(`/v1/features/brands/${BRAND}/published-units/x_post_published${q}`).set("x-org-id", "org_other");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.pathname + u.search).toBe(`/brands/${BRAND}/published-units/x_post_published${q}`);
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[0].init.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].init.headers["x-run-id"]).toBe("run_test789");
  });

  it("no query: none invented", async () => {
    await request(app()).get(`/v1/features/brands/${BRAND}/published-units/x_post_published`);
    const u = new URL(calls[0].url);
    expect(u.pathname + u.search).toBe(`/brands/${BRAND}/published-units/x_post_published`);
  });

  it("relays refusals field-for-field with their status", async () => {
    global.fetch = vi.fn().mockImplementation(async () => new Response('{"error":"Bad pricing","reason":"pricing_unrecognised"}', { status: 400, headers: { "content-type": "application/json" } }));
    const bad = await request(app()).get(`/v1/features/brands/${BRAND}/published-units/x_post_published?pricing=nope`);
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "Bad pricing", reason: "pricing_unrecognised" });

    global.fetch = vi.fn().mockImplementation(async () => new Response('{"error":"Brand not found"}', { status: 404, headers: { "content-type": "application/json" } }));
    const nf = await request(app()).get(`/v1/features/brands/${BRAND}/published-units/x_post_published`);
    expect(nf.status).toBe(404);
    expect(nf.body).toEqual({ error: "Brand not found" });
  });

  it("is in the published customer document with the producer's answer", () => {
    const doc: any = buildDocument();
    const op = doc.paths["/v1/features/brands/{brandId}/published-units/{outcomeKey}"]?.get;
    expect(op).toBeDefined();
    expect(JSON.stringify(op.responses["200"])).toContain("costPerSignupUsd");
  });
});
