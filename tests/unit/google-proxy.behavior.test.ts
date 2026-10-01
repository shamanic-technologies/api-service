import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/google/* must forward to google-service's own /orgs/google/* — path
 * preserved, query string byte-copied, body forwarded verbatim, upstream STATUS
 * and body relayed untransformed (CLAUDE.md rules #1/#4/#7/#11).
 *
 * Every assertion drives the real router and reads the captured `fetch` call.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.authType = "user_key";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import googleRouter from "../../src/routes/google.js";

const GOOGLE_BASE = "http://google.test.local";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", googleRouter);
  return app;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("/v1/orgs/google/* → google-service", () => {
  let calls: Array<{ url: string; options: any }>;
  let next: { status: number; body: unknown };

  beforeEach(() => {
    process.env.GOOGLE_SERVICE_URL = GOOGLE_BASE;
    process.env.GOOGLE_SERVICE_API_KEY = "google-test-key";
    calls = [];
    next = { status: 200, body: { ok: true } };
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return jsonResponse(next.status, next.body);
    });
  });

  afterEach(() => {
    process.env.GOOGLE_SERVICE_URL = "http://localhost:3033";
    process.env.GOOGLE_SERVICE_API_KEY = "test-google-service-api-key";
  });

  it("POST auth/start forwards the body + identity, returns the upstream body", async () => {
    next.body = { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", state: "s1" };
    const res = await request(buildApp())
      .post("/v1/orgs/google/auth/start")
      .send({ redirectUri: "https://dashboard.distribute.you/x" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GOOGLE_BASE}/orgs/google/auth/start`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual({ redirectUri: "https://dashboard.distribute.you/x" });
    expect(calls[0].options.headers["X-API-Key"]).toBe("google-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
  });

  it("GET auth/callback byte-copies the query string", async () => {
    await request(buildApp()).get("/v1/orgs/google/auth/callback?code=4%2F0Ab-x&state=abc");
    expect(calls[0].url).toBe(`${GOOGLE_BASE}/orgs/google/auth/callback?code=4%2F0Ab-x&state=abc`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
  });

  it("GET accounts returns the upstream body untouched", async () => {
    next.body = { accounts: [{ email: "a@b.com", extra: 1 }] };
    const res = await request(buildApp()).get("/v1/orgs/google/accounts");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls[0].url).toBe(`${GOOGLE_BASE}/orgs/google/accounts`);
  });

  it("DELETE accounts/:email forwards the email URL-encoded as one segment", async () => {
    next.body = { disconnected: true, email: "kevin+x@distribute.you" };
    const res = await request(buildApp()).delete("/v1/orgs/google/accounts/kevin%2Bx%40distribute.you");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls[0].url).toBe(`${GOOGLE_BASE}/orgs/google/accounts/kevin%2Bx%40distribute.you`);
    expect(calls[0].options.method).toBe("DELETE");
    expect(calls[0].options.body).toBeUndefined();
  });

  it("DELETE 404 reason reaches the caller field-for-field", async () => {
    next = { status: 404, body: { error: "Account not found", reason: "account_not_found" } };
    const res = await request(buildApp()).delete("/v1/orgs/google/accounts/nobody%40x.com");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Account not found", reason: "account_not_found" });
  });

  it("DELETE keeps a smuggled traversal inside one encoded segment", async () => {
    await request(buildApp()).delete("/v1/orgs/google/accounts/..%2F..%2Finternal%2Fx");
    // Express decodes the param; encodeURIComponent re-encodes every `/`, so the
    // downstream sees ONE opaque segment under /orgs/google/accounts/, never a traversal.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GOOGLE_BASE}/orgs/google/accounts/..%2F..%2Finternal%2Fx`);
  });

  it("POST sync relays the 202 status, not a normalised 200", async () => {
    next = { status: 202, body: { jobId: "j1", status: "running" } };
    const res = await request(buildApp()).post("/v1/orgs/google/sync").send({});
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ jobId: "j1", status: "running" });
    expect(calls[0].url).toBe(`${GOOGLE_BASE}/orgs/google/sync`);
    expect(calls[0].options.method).toBe("POST");
  });

  it("GET sync/:jobId hits the job path", async () => {
    await request(buildApp()).get("/v1/orgs/google/sync/job-123");
    expect(calls[0].url).toBe(`${GOOGLE_BASE}/orgs/google/sync/job-123`);
  });

  it.each([
    ["messages", "?limit=50&cursor=abc&participant=a%40b.com&future=1"],
    ["contacts", "?query=acme&limit=10"],
    ["conversation", "?email=alice%40acme.com&limit=200"],
    ["correspondents", "?limit=20&offset=40"],
  ])("GET %s byte-copies the whole query string", async (segment, qs) => {
    await request(buildApp()).get(`/v1/orgs/google/${segment}${qs}`);
    expect(calls[0].url).toBe(`${GOOGLE_BASE}/orgs/google/${segment}${qs}`);
  });

  it("GET conversation 404 reason is forwarded verbatim", async () => {
    next = { status: 404, body: { error: "No messages", reason: "no_messages" } };
    const res = await request(buildApp()).get("/v1/orgs/google/conversation?email=x%40y.com");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No messages", reason: "no_messages" });
  });

  it("PUT contact-links forwards the body verbatim", async () => {
    const body = { resourceName: "people/c123", orgIds: ["o"], brandIds: [], featureSlugs: [], status: null, extra: 1 };
    next.body = { ...body };
    const res = await request(buildApp()).put("/v1/orgs/google/contact-links").send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(calls[0].url).toBe(`${GOOGLE_BASE}/orgs/google/contact-links`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it("a missing GOOGLE_SERVICE_URL degrades to a 502 on the route", async () => {
    delete process.env.GOOGLE_SERVICE_URL;
    const res = await request(buildApp()).get("/v1/orgs/google/accounts");
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(0);
  });
});
