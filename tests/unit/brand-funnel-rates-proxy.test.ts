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
 * The brand-grain funnel-rates proxies, driven over the wire.
 *
 * A source-substring test cannot see what actually goes downstream (CLAUDE.md #7
 * corollary 3), and three of this feature's acceptance criteria are about exactly
 * that: the full downstream path literal, the org identity being the AUTHENTICATED
 * one, and brand-service's body reaching the caller untouched — `declared`
 * included, because collapsing it turns "the brand has said nothing" into "the
 * brand sells through nothing", which is a lie about user data.
 *
 * Per CLAUDE.md #6/#8 the payloads below are fixtures, not a contract this repo
 * owns: what is asserted is the forwarded path, the forwarded identity, and
 * byte-identical bodies — never brand-service's field names as a shape.
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

const BRAND_ID = "7f1c2a3b-4d5e-4f60-8a91-b2c3d4e5f607";
const PAYLOAD = { funnels: [{ funnelKey: "sales_meetings_from_conversation", arrows: [{ fromStep: "Positive reply", toStep: "Meeting booked", ratePct: null, stated: false, statedAt: null }] }] };

describe("/v1/brands/:id/funnel-rates — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;
  let reply: { status: number; body: any };

  beforeEach(() => {
    calls = [];
    reply = { status: 200, body: PAYLOAD };
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: reply.status < 400, status: reply.status, json: () => Promise.resolve(reply.body), text: () => Promise.resolve(JSON.stringify(reply.body)) };
    }) as unknown as typeof fetch;
  });

  it("GET forwards the path and the query verbatim, and returns the body untouched", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/funnel-rates?funnelKey=sales_meetings_from_conversation`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(PAYLOAD);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/funnel-rates?funnelKey=sales_meetings_from_conversation`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("PUT forwards the body verbatim to the funnel's path", async () => {
    const body = { arrowRates: [{ fromStep: "Positive reply", toStep: "Meeting booked", ratePct: null }] };
    const res = await request(buildApp()).put(`/v1/brands/${BRAND_ID}/funnel-rates/sales_meetings_from_conversation`).send(body);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/funnel-rates/sales_meetings_from_conversation`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });
});
