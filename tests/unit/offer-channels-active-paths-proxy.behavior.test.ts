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
 * Offer channels + active sales paths: BEHAVIOURAL cover over the real router with a
 * stubbed fetch. Each route reaches brand-service's own path with the authenticated
 * identity; the 201 on activate and the 409 SALES_PATH_ENTRY_TAKEN come back as sent,
 * body included (the dashboard offers "replace" off that body).
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

describe("offer channels + active sales paths proxies", () => {
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

  it.each([
    ["get", "/channels"],
    ["get", "/active-sales-paths"],
    ["get", "/active-sales-paths/history"],
  ] as const)("%s %s reaches brand-service's own path with the identity", async (_m, suffix) => {
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

  it("POST activate forwards the body and returns brand-service's 201", async () => {
    const sent = { combinationKey: "a@b+c", entryChannelSlug: "b", entryLegKey: "a", replace: true };
    const body = { activated: true, activeSalesPath: { combinationKey: "a@b+c" }, replaced: null };
    stub(201, body);
    const res = await request(buildApp()).post(`/v1${OFFER}/active-sales-paths`).send(sent);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs${OFFER}/active-sales-paths`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(sent);
  });

  it("forwards the 409 SALES_PATH_ENTRY_TAKEN with its body", async () => {
    const body = { error: "taken", code: "SALES_PATH_ENTRY_TAKEN", activeSalesPath: { combinationKey: "x" } };
    stub(409, body);
    const res = await request(buildApp())
      .post(`/v1${OFFER}/active-sales-paths`)
      .send({ combinationKey: "y", entryChannelSlug: "b", entryLegKey: "a" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(body);
  });

  it("POST deactivate reaches its own path, not the activate one", async () => {
    stub(200, { deactivated: { combinationKey: "x" } });
    const res = await request(buildApp()).post(`/v1${OFFER}/active-sales-paths/deactivate`).send({ combinationKey: "x" });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs${OFFER}/active-sales-paths/deactivate`);
    expect(JSON.parse(calls[0].options.body)).toEqual({ combinationKey: "x" });
  });
});
