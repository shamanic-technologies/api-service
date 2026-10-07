import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load: set it before the router imports.
const { LEAD_BASE } = vi.hoisted(() => {
  const LEAD_BASE = "http://lead.test.local";
  process.env.LEAD_SERVICE_URL = LEAD_BASE;
  process.env.LEAD_SERVICE_API_KEY = "lead-test-key";
  return { LEAD_BASE };
});

/**
 * Qualification proxies (src/routes/qualification.ts), driven through the real router with a
 * stubbed fetch: each reaches lead-service's own path with org, user AND run (the spending
 * routes need the run), the path's brand rides as x-brand-id, bodies/queries/statuses/refusals
 * go over untouched.
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
      if (req.headers["x-brand-id"]) req.brandId = req.headers["x-brand-id"];
      next();
    },
  };
});

import qualificationRouter from "../../src/routes/qualification.js";
import leadsRouter from "../../src/routes/leads.js";
import brandRouter from "../../src/routes/brand.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  // Mounted in the same order as src/index.ts, so a sibling route cannot swallow these.
  app.use("/v1", brandRouter);
  app.use("/v1", leadsRouter);
  app.use("/v1", qualificationRouter);
  return app;
}

const BRAND_ID = "75d7e3e8-6926-4f85-a557-976895400666";
const OFFER_ID = "0d3d1f2c-8f4a-4a2e-9d1b-2f0f6a7c5b31";
const CRITERION_ID = "5b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const LEAD_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const OFFER = `/brands/${BRAND_ID}/offers/${OFFER_ID}/qualification`;

describe("qualification proxies", () => {
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

  const cases: Array<{ method: "get" | "post" | "patch" | "delete"; path: string; body?: unknown; brand: boolean }> = [
    { method: "get", path: "/qualification/catalog", brand: false },
    { method: "post", path: `${OFFER}/suggestions`, body: {}, brand: true },
    { method: "post", path: `${OFFER}/criteria`, body: { question: "Is it B2B?", probe: { builtin: "x" }, mode: "gate", enabled: true, extra: 1 }, brand: true },
    { method: "get", path: `${OFFER}/criteria`, brand: true },
    { method: "patch", path: `${OFFER}/criteria/${CRITERION_ID}`, body: { enabled: false }, brand: true },
    { method: "delete", path: `${OFFER}/criteria/${CRITERION_ID}`, brand: true },
    { method: "post", path: `${OFFER}/criteria/${CRITERION_ID}/sample`, body: { limit: 5 }, brand: true },
    { method: "get", path: `/leads/${LEAD_ID}/qualification?brandId=${BRAND_ID}&offerId=${OFFER_ID}`, brand: true },
  ];

  for (const c of cases) {
    it(`${c.method.toUpperCase()} /v1${c.path} reaches lead-service /orgs${c.path} with full identity`, async () => {
      const upstream = { anything: [1, 2], nested: { a: "b" } };
      stub(c.method === "post" && c.path.endsWith("/criteria") ? 201 : 200, upstream);
      let r = request(buildApp())[c.method](`/v1${c.path}`);
      if (c.body !== undefined) r = r.send(c.body as object);
      const res = await r;
      expect(res.status).toBe(c.method === "post" && c.path.endsWith("/criteria") ? 201 : 200);
      expect(res.body).toEqual(upstream);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${LEAD_BASE}/orgs${c.path}`);
      expect(calls[0].options.method).toBe(c.method.toUpperCase());
      const h = calls[0].options.headers;
      expect(h["x-org-id"]).toBe("org_test456");
      expect(h["x-user-id"]).toBe("user_test123");
      expect(h["x-run-id"]).toBe("run_test789");
      if (c.brand) expect(h["x-brand-id"]).toBe(BRAND_ID);
      if (c.body !== undefined) expect(JSON.parse(calls[0].options.body)).toEqual(c.body);
      else expect(calls[0].options.body).toBeUndefined();
    });
  }

  it("forwards a 402 insufficient_credit refusal AS a 402 with its body", async () => {
    const refusal = { error: "Insufficient credit", code: "insufficient_credit", balanceCents: 3, requiredCents: 50 };
    stub(402, refusal);
    const res = await request(buildApp()).post(`/v1${OFFER}/criteria/${CRITERION_ID}/sample`).send({ limit: 5 });
    expect(res.status).toBe(402);
    expect(res.body).toEqual(refusal);
  });

  it("forwards a 404 criterion_not_found AS a 404 with its body", async () => {
    const refusal = { error: "No live criterion with that id on this offer", code: "criterion_not_found" };
    stub(404, refusal);
    const res = await request(buildApp()).delete(`/v1${OFFER}/criteria/${CRITERION_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(refusal);
  });

  it("refuses an x-brand-id that disagrees with the path brand, without calling lead-service", async () => {
    stub(200, {});
    const res = await request(buildApp()).get(`/v1${OFFER}/criteria`).set("x-brand-id", "another-brand");
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
