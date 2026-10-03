import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/orgs/audiences/signal → human-service POST /orgs/audiences/signal.
 * Drives the real router with a stubbed fetch and asserts the wire: the full
 * downstream path, the byte-identical body, the identity headers, and the
 * upstream status + body forwarded field for field (201 and the named 400s).
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

  it("forwards path, body, identity and api key; returns the 201 body verbatim", async () => {
    const upstream = { audience: { id: "a1", kind: "apollo", signalType: "linkedin_engagement" } };
    stubFetch(201, upstream);
    const body = {
      brandId: "b1",
      offerId: "o1",
      name: "Engaged with competitors",
      competitorLinkedinUrls: ["https://www.linkedin.com/company/acme"],
    };

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
  });

  it.each([
    [400, { error: "competitor page is not a LinkedIn company URL", provider: "apollo", upstreamStatus: 400, upstream: { error: "bad url" } }],
    [409, { error: "An audience with this name already exists" }],
    [502, { error: "apollo-service failed" }],
  ])("forwards upstream %i with its body field for field", async (status, body) => {
    stubFetch(status, body);
    const res = await request(buildApp()).post("/v1/orgs/audiences/signal").send({});
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
  });

  it("is not swallowed by an /orgs/audiences/:id route", async () => {
    stubFetch(201, { audience: { id: "a1" } });
    await request(buildApp()).post("/v1/orgs/audiences/signal").send({});
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/signal`);
    expect(calls[0].url).not.toContain("/refresh-count");
  });
});
