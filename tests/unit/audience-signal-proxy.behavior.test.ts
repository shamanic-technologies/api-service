import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/orgs/audiences/signal → human-service POST /orgs/audiences/signal.
 * Drives the real router with a stubbed fetch and asserts the wire: the full
 * downstream path, the byte-identical body, the identity headers (the body's
 * brandId also rides x-brand-id), and the upstream status + body forwarded
 * field for field on success and on the producer's named 4xx.
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

describe("POST /v1/orgs/audiences/signal → human-service", () => {
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

  const body = {
    brandId: "brand-1",
    offerId: "offer-1",
    nlPrompt: "People engaging with competitor posts",
    signal: { type: "linkedin_engagement", windowDays: 30, competitorPages: ["https://www.linkedin.com/company/acme"] },
  };

  it("forwards 201 + body verbatim, the path, the byte-identical body and identity incl. x-brand-id", async () => {
    const upstream = { audience: { id: "a1", name: "Acme engagers", signal: { type: "linkedin_engagement" } } };
    stubFetch(201, upstream);

    const res = await request(buildApp()).post("/v1/orgs/audiences/signal").send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/signal`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["X-API-Key"]).toBe("human-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-brand-id"]).toBe("brand-1");
  });

  it.each([
    [
      422,
      {
        error: "competitorPages[0] is not a LinkedIn company page URL",
        provider: "apollo",
        upstreamStatus: 422,
        upstream: { error: "competitorPages[0] is not a LinkedIn company page URL", code: "INVALID_COMPETITOR_PAGE" },
      },
    ],
    [400, { error: "Apollo filters cannot be combined with a signal", provider: "apollo", upstreamStatus: 400 }],
    [409, { error: "An audience with this name already exists for this brand and offer." }],
  ])("forwards upstream %i with its body field for field", async (status, upstream) => {
    stubFetch(status, upstream);
    const res = await request(buildApp()).post("/v1/orgs/audiences/signal").send(body);
    expect(res.status).toBe(status);
    expect(res.body).toEqual(upstream);
  });

  it("400 without calling out when x-brand-id conflicts with the body brandId", async () => {
    stubFetch(201, {});
    const res = await request(buildApp())
      .post("/v1/orgs/audiences/signal?brandId=brand-other")
      .send(body);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
