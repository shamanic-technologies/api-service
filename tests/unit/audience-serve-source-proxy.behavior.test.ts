import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * PATCH /v1/orgs/audiences/:id/serve-source → human-service PATCH
 * /orgs/audiences/{id}/serve-source (QE-CHIRO-1102). Real router, stubbed fetch:
 * path, byte-identical body, identity, and the upstream status + body (the 422
 * reasons included) forwarded field for field.
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

describe("PATCH /v1/orgs/audiences/:id/serve-source → human-service", () => {
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

  it("forwards 200 + body, the path, the body and identity", async () => {
    const upstream = { audience: { id: "a1" }, serveSource: "quickenrich", quickenrich: { expressible: true, reasons: [] } };
    stubFetch(200, upstream);
    const res = await request(buildApp()).patch("/v1/orgs/audiences/a1/serve-source").send({ serveSource: "quickenrich" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/a1/serve-source`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ serveSource: "quickenrich" });
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it("forwards the 422 with every reason", async () => {
    const upstream = { error: "QuickEnrich cannot enforce this audience's filters faithfully", reasons: ["q_organization_keyword_tags: not expressible"], provider: "apollo" };
    stubFetch(422, upstream);
    const res = await request(buildApp()).patch("/v1/orgs/audiences/a1/serve-source").send({ serveSource: "quickenrich" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual(upstream);
  });
});
