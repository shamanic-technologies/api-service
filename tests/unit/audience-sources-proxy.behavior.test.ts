import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/orgs/audiences/:id/sources and PATCH /v1/orgs/audiences/:id/sources/:sourceId
 * → human-service (HIRING-TITLES-1102). Real router, stubbed fetch: method, full
 * path, byte-identical body, identity, and the upstream status + body (201, the
 * 409 naming the existing sourceId, a 400) forwarded field for field.
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

describe("audience sources → human-service", () => {
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

  const addBody = { type: "hiring", windowDays: 30, jobTitles: ["QA", "SDET", "Test Automation"] };

  it("POST forwards 201 + body, the path, the body and identity", async () => {
    const upstream = { audience: { id: "a1" }, sourceId: "s1", changed: true };
    stubFetch(201, upstream);
    const res = await request(buildApp()).post("/v1/orgs/audiences/a1/sources").send(addBody);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/a1/sources`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(addBody);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it("POST relays the 409 carrying the existing sourceId unchanged", async () => {
    const upstream = { error: "This audience already has a hiring source", reason: "source_exists", sourceId: "s-existing" };
    stubFetch(409, upstream);
    const res = await request(buildApp()).post("/v1/orgs/audiences/a1/sources").send(addBody);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(upstream);
  });

  it("POST relays a 400 unchanged", async () => {
    const upstream = { error: "jobTitles is for a hiring source only", reason: "job_titles_need_hiring" };
    stubFetch(400, upstream);
    const res = await request(buildApp()).post("/v1/orgs/audiences/a1/sources").send({ type: "funding", jobTitles: ["QA"] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(upstream);
  });

  it("PATCH forwards 200 + body, the path, the body and identity", async () => {
    const upstream = { audience: { id: "a1" }, sourceId: "s1", changed: false };
    stubFetch(200, upstream);
    const res = await request(buildApp()).patch("/v1/orgs/audiences/a1/sources/s1").send({ jobTitles: null });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${HUMAN_BASE}/orgs/audiences/a1/sources/s1`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ jobTitles: null });
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it("PATCH relays a 400 and a 404 unchanged", async () => {
    const bad = { error: "Not a hiring source", reason: "not_hiring" };
    stubFetch(400, bad);
    let res = await request(buildApp()).patch("/v1/orgs/audiences/a1/sources/s1").send({ jobTitles: ["QA"] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(bad);
    const missing = { error: "Source not found" };
    stubFetch(404, missing);
    res = await request(buildApp()).patch("/v1/orgs/audiences/a1/sources/nope").send({ jobTitles: ["QA"] });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(missing);
  });
});
