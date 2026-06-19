import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/audiences/* must forward to HUMAN-SERVICE /orgs/audiences/*
 * (transparent proxy: path preserved, body forwarded verbatim, response
 * returned untransformed, identity org+user headers + x-api-key forwarded).
 * Per CLAUDE.md rules #6/#8 we assert (a) the proxy hit the correct downstream
 * path, (b) the body was forwarded byte-identical, (c) the right headers were
 * sent — NOT the downstream response shape. The human-service base/key are read
 * lazily from env at request time, so setting/deleting them per-test is enough.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "user_key";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import audiencesRouter from "../../src/routes/audiences.js";

const HUMAN_BASE = "http://human.test.local";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", audiencesRouter);
  return app;
}

describe("/v1/orgs/audiences/* → human-service", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    process.env.HUMAN_SERVICE_URL = HUMAN_BASE;
    process.env.HUMAN_SERVICE_API_KEY = "human-test-key";
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
    });
  });

  afterEach(() => {
    delete process.env.HUMAN_SERVICE_URL;
    delete process.env.HUMAN_SERVICE_API_KEY;
  });

  it("POST /suggest forwards body verbatim + identity + api-key headers", async () => {
    const body = { nlPrompt: "founders in FR", brandId: "brand-uuid-1" };
    const res = await request(buildApp()).post("/v1/orgs/audiences/suggest").send(body);
    expect(res.status).toBe(200);
    const call = calls[0];
    expect(call.url).toBe(`${HUMAN_BASE}/orgs/audiences/suggest`);
    expect(call.options.method).toBe("POST");
    expect(JSON.parse(call.options.body)).toEqual(body);
    expect(call.options.headers["X-API-Key"]).toBe("human-test-key");
    expect(call.options.headers["x-org-id"]).toBe("org_test456");
    expect(call.options.headers["x-user-id"]).toBe("user_test123");
  });

  it("GET list forwards brandId + pagination query", async () => {
    const res = await request(buildApp()).get("/v1/orgs/audiences?brandId=b1&limit=50&offset=10");
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences?limit=50&offset=10&brandId=b1`);
  });

  it("GET list forwards status (lifecycle) filter", async () => {
    const res = await request(buildApp()).get("/v1/orgs/audiences?brandId=b1&status=active");
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences?brandId=b1&status=active`);
  });

  it("GET /:id forwards to the by-id path", async () => {
    await request(buildApp()).get("/v1/orgs/audiences/aud-1");
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/aud-1`);
  });

  it("GET /:id/members forwards pagination", async () => {
    await request(buildApp()).get("/v1/orgs/audiences/aud-1/members?limit=100");
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/aud-1/members?limit=100`);
  });

  it("POST /:id/refresh-count forwards", async () => {
    await request(buildApp()).post("/v1/orgs/audiences/aud-1/refresh-count").send({});
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/aud-1/refresh-count`);
    expect(calls[0].options.method).toBe("POST");
  });

  it("PATCH /:id forwards body verbatim", async () => {
    await request(buildApp()).patch("/v1/orgs/audiences/aud-1").send({ name: "renamed" });
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/aud-1`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ name: "renamed" });
  });

  it("PATCH /:id/status forwards body verbatim to the status path", async () => {
    await request(buildApp()).patch("/v1/orgs/audiences/aud-1/status").send({ status: "paused" });
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/aud-1/status`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ status: "paused" });
  });

  it("DELETE /:id forwards", async () => {
    await request(buildApp()).delete("/v1/orgs/audiences/aud-1");
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/aud-1`);
    expect(calls[0].options.method).toBe("DELETE");
  });

  it("POST /stats forwards body verbatim", async () => {
    const body = { emails: ["a@b.com"], personIds: [] };
    await request(buildApp()).post("/v1/orgs/audiences/stats").send(body);
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/stats`);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it("returns the human-service body verbatim", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ candidates: [{ provider: "apollo", count: 42 }] }),
    });
    const res = await request(buildApp()).post("/v1/orgs/audiences/suggest").send({ nlPrompt: "x", brandId: "b" });
    expect(res.body).toEqual({ candidates: [{ provider: "apollo", count: 42 }] });
  });
});

describe("/v1/orgs/audiences/* boot-safety: 502 when human-service env unset", () => {
  beforeEach(() => {
    delete process.env.HUMAN_SERVICE_URL;
    delete process.env.HUMAN_SERVICE_API_KEY;
    global.fetch = vi.fn();
  });

  it("returns 502 (not 500, not a boot crash) when HUMAN_SERVICE_URL is missing", async () => {
    const res = await request(buildApp()).get("/v1/orgs/audiences?brandId=b1");
    expect(res.status).toBe(502);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
