import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BRAND_BASE } = vi.hoisted(() => {
  const BRAND_BASE = "http://brand.test.local";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { BRAND_BASE };
});

/**
 * Offer channels: BEHAVIOURAL cover over the real router with a stubbed fetch. Each
 * route reaches brand-service's own path with the authenticated identity. The per-offer
 * active-sales-paths routes were withdrawn (owner 2026-10-04) and must stay unrouted.
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
const OFFER = `/brands/${BRAND_ID}/offers/${OFFER_ID}`;

describe("offer channels proxies", () => {
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

  it.each([["get", "/channels"]] as const)("%s %s reaches brand-service's own path with the identity", async (_m, suffix) => {
    const body = { offerId: OFFER_ID, marker: suffix };
    stub(200, body);
    const res = await request(buildApp()).get(`/v1${OFFER}${suffix}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs${OFFER}${suffix}`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("PUT channels forwards the body and the user", async () => {
    const sent = { channelSlugs: ["sales-cold-email-outreach", "meta-ads"] };
    stub(200, { offerId: OFFER_ID, stated: true, ...sent });
    const res = await request(buildApp()).put(`/v1${OFFER}/channels`).send(sent);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs${OFFER}/channels`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual(sent);
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it.each([
    ["get", "/active-sales-paths"],
    ["get", "/active-sales-paths/history"],
    ["post", "/active-sales-paths"],
    ["post", "/active-sales-paths/deactivate"],
  ] as const)("%s %s is no longer routed", async (method, suffix) => {
    stub(200, {});
    const res = await (request(buildApp()) as any)[method](`/v1${OFFER}${suffix}`).send({});
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
