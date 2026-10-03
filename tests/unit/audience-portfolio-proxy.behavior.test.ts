import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/orgs/audiences/portfolio → human-service POST /orgs/audiences/portfolio.
 * Drives the real router with a stubbed fetch and asserts the wire: the full
 * downstream path, the byte-identical body, the identity headers, the 10-minute
 * dispatcher (a first call takes 3-4 minutes, the default undici timeout is 300s),
 * and the upstream status + body forwarded field for field on success and error.
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
import { LONG_CALL_DISPATCHER } from "../../src/lib/service-client.js";

const HUMAN_BASE = "http://human.test.local";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", audiencesRouter);
  return app;
}

describe("POST /v1/orgs/audiences/portfolio → human-service", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    process.env.HUMAN_SERVICE_URL = HUMAN_BASE;
    process.env.HUMAN_SERVICE_API_KEY = "human-test-key";
    calls = [];
  });

  afterEach(() => {
    delete process.env.HUMAN_SERVICE_URL;
    delete process.env.HUMAN_SERVICE_API_KEY;
  });

  function stubFetch(status: number, body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      };
    });
  }

  it("forwards path, body, identity, api key and the long-call dispatcher; returns the body verbatim", async () => {
    const upstream = { portfolioId: "p1", replayed: false, target: "CFOs", audiences: [{ id: "a1" }], signals: [] };
    stubFetch(200, upstream);
    const body = { brandId: "b1", offerId: "o1", targetAudience: "CFOs at French SaaS" };

    const res = await request(buildApp()).post("/v1/orgs/audiences/portfolio").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/portfolio`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["X-API-Key"]).toBe("human-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.dispatcher).toBe(LONG_CALL_DISPATCHER);
  });

  it("does not put the long dispatcher on the sibling audience routes", async () => {
    stubFetch(200, { ok: true });
    await request(buildApp()).post("/v1/orgs/audiences/split").send({});
    expect(calls[0].options.dispatcher).toBeUndefined();
  });

  it.each([
    [400, { error: "brandId is required", details: [{ path: ["brandId"] }] }],
    [409, { error: "A portfolio is being built for this offer", code: "IN_FLIGHT" }],
    [502, { error: "Apollo exploration failed" }],
  ])("forwards upstream %i with its body field for field", async (status, body) => {
    stubFetch(status, body);
    const res = await request(buildApp()).post("/v1/orgs/audiences/portfolio").send({});
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
  });

  it("502 without calling out when human-service env is unset", async () => {
    delete process.env.HUMAN_SERVICE_URL;
    global.fetch = vi.fn();
    const res = await request(buildApp()).post("/v1/orgs/audiences/portfolio").send({});
    expect(res.status).toBe(502);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
