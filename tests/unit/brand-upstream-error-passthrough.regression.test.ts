import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * Regression: a downstream structured error must reach the caller with its status
 * AND all its fields.
 *
 * Prod incident (2026-07-29): adding a website to an existing brand rendered
 *   Could not save: {"error":"A brand already exists for domain \"steadyrecruitment.com\"","code":"DOMAIN_CONFLICT"}
 * in the dashboard. The brand routes rebuilt their own envelope out of the thrown
 * error's message — `res.json({ error: err.message })` — and `err.message` IS the
 * upstream body verbatim (service-client, CLAUDE.md rule #7). So the whole JSON body
 * got stringified into the `error` string: `code` destroyed, raw body leaked to the
 * end user, and the routes' own doc-comments claiming "propagates verbatim" were false.
 *
 * These tests assert the class fix (src/lib/upstream-error.ts) across the brand
 * routers, not one call site.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  },
  authenticatePlatform: (req: any, _res: any, next: any) => {
    req.authType = "admin";
    req.staffEmail = "staff@distribute.you";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  requireStaff: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import brandRouter from "../../src/routes/brand.js";
import brandPauseRouter from "../../src/routes/brand-pause.js";
import adminBrandsRouter from "../../src/routes/admin-brands.js";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/v1", brandPauseRouter);
  app.use("/v1", brandRouter);
  app.use("/v1", adminBrandsRouter);
  return app;
}

function mockUpstream(status: number, body: string) {
  global.fetch = vi.fn().mockImplementation(async () => ({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  }));
}

describe("downstream structured errors reach the caller intact", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("PATCH /v1/brands/:id — the exact prod DOMAIN_CONFLICT body survives field-for-field", async () => {
    const upstream = {
      error: 'A brand already exists for domain "steadyrecruitment.com"',
      code: "DOMAIN_CONFLICT",
    };
    mockUpstream(409, JSON.stringify(upstream));

    const res = await request(app)
      .patch(`/v1/brands/${BRAND_ID}`)
      .send({ url: "https://steadyrecruitment.com" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(upstream);
    expect(res.body.code).toBe("DOMAIN_CONFLICT");
    // No raw stringified body inside the caller-visible message.
    expect(res.body.error).not.toContain("{");
    expect(res.body.error).not.toContain('"code"');
  });

  it("keeps every downstream field, not just error/code", async () => {
    const upstream = {
      error: "Invalid request",
      code: "VALIDATION_FAILED",
      details: { fieldErrors: { url: ["Invalid url"] } },
      requestId: "req_abc123",
    };
    mockUpstream(400, JSON.stringify(upstream));

    const res = await request(app).patch(`/v1/brands/${BRAND_ID}`).send({ url: "nope" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(upstream);
  });

  it("POST /v1/brands — upsert propagates the structured conflict too", async () => {
    const upstream = { error: "A brand already exists for that domain", code: "DOMAIN_CONFLICT" };
    mockUpstream(409, JSON.stringify(upstream));

    const res = await request(app).post("/v1/brands").send({ url: "https://taken.com" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(upstream);
  });

  it("PUT /v1/brands/:id/business-context — propagates the structured 400", async () => {
    const upstream = { error: "Business context too large", code: "CONTEXT_TOO_LARGE" };
    mockUpstream(400, JSON.stringify(upstream));

    const res = await request(app)
      .put(`/v1/brands/${BRAND_ID}/business-context`)
      .send({ content: "x" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(upstream);
  });

  it("GET /v1/brands/:id — propagates the structured 404", async () => {
    const upstream = { error: "Brand not found", code: "BRAND_NOT_FOUND" };
    mockUpstream(404, JSON.stringify(upstream));

    const res = await request(app).get(`/v1/brands/${BRAND_ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(upstream);
  });

  it("PATCH /v1/brands/:brandId/pause — campaign-service errors propagate too", async () => {
    const upstream = { error: "Brand is not owned by this org", code: "FORBIDDEN_BRAND" };
    mockUpstream(403, JSON.stringify(upstream));

    const res = await request(app).patch(`/v1/brands/${BRAND_ID}/pause`).send({ paused: true });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(upstream);
  });

  it("GET /v1/admin/brands — staff route propagates the structured error", async () => {
    const upstream = { error: "brand-service unavailable", code: "UPSTREAM_DOWN" };
    mockUpstream(502, JSON.stringify(upstream));

    const res = await request(app).get("/v1/admin/brands");

    expect(res.status).toBe(502);
    expect(res.body).toEqual(upstream);
  });

  it("wraps a non-JSON upstream body as { error } under the upstream status", async () => {
    mockUpstream(503, "upstream is down");

    const res = await request(app).get(`/v1/brands/${BRAND_ID}`);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "upstream is down" });
  });

  it("still answers under the upstream status when the upstream sent no body at all", async () => {
    // service-client already substitutes its own last-resort string for an empty
    // upstream body, so that is what reaches the caller here — the route's own
    // fallback message only applies to an error that never reached the upstream.
    mockUpstream(500, "");

    const res = await request(app).get(`/v1/brands/${BRAND_ID}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Service call failed: 500" });
  });
});
