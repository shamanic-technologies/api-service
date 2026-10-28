import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/threads/* must forward to meta-service's own /orgs/threads/* — path
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

import threadsRouter from "../../src/routes/threads.js";

const META_BASE = "http://meta.test.local";
const ACCOUNT_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", threadsRouter);
  return app;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("/v1/orgs/threads/* → meta-service", () => {
  let calls: Array<{ url: string; options: any }>;
  let next: { status: number; body: unknown };

  beforeEach(() => {
    process.env.META_SERVICE_URL = META_BASE;
    process.env.META_SERVICE_API_KEY = "meta-test-key";
    calls = [];
    next = { status: 200, body: { ok: true } };
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return jsonResponse(next.status, next.body);
    });
  });

  afterEach(() => {
    process.env.META_SERVICE_URL = "http://localhost:3034";
    process.env.META_SERVICE_API_KEY = "test-meta-service-api-key";
  });

  it("POST auth/start forwards the body + identity, returns the upstream body", async () => {
    next.body = { authorizationUrl: "https://threads.net/oauth/authorize?x=1", state: "s1", expiresAt: "2026-10-28T14:00:00Z" };
    const body = { brandId: "brand-1", accountType: "pro_ai", redirectUri: "https://dashboard.distribute.you/threads/callback" };
    const res = await request(buildApp()).post("/v1/orgs/threads/auth/start").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${META_BASE}/orgs/threads/auth/start`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["X-API-Key"]).toBe("meta-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
  });

  it("POST auth/callback forwards { code, state } verbatim", async () => {
    next.body = { account: { id: ACCOUNT_ID }, created: true };
    const res = await request(buildApp()).post("/v1/orgs/threads/auth/callback").send({ code: "c", state: "s" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls[0].url).toBe(`${META_BASE}/orgs/threads/auth/callback`);
    expect(JSON.parse(calls[0].options.body)).toEqual({ code: "c", state: "s" });
  });

  it("GET accounts byte-copies the query and promotes brandId to x-brand-id", async () => {
    next.body = { accounts: [] };
    const res = await request(buildApp()).get("/v1/orgs/threads/accounts?brandId=brand-1&future=x%2By");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accounts: [] });
    expect(calls[0].url).toBe(`${META_BASE}/orgs/threads/accounts?brandId=brand-1&future=x%2By`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[0].options.headers["x-brand-id"]).toBe("brand-1");
  });

  it("PATCH accounts/:id forwards the body to the account path", async () => {
    next.body = { account: { id: ACCOUNT_ID, accountType: "pro_human" } };
    const res = await request(buildApp()).patch(`/v1/orgs/threads/accounts/${ACCOUNT_ID}`).send({ accountType: "pro_human" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls[0].url).toBe(`${META_BASE}/orgs/threads/accounts/${ACCOUNT_ID}`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ accountType: "pro_human" });
  });

  it("DELETE accounts/:id forwards with no body", async () => {
    next.body = { message: "Threads account disconnected" };
    const res = await request(buildApp()).delete(`/v1/orgs/threads/accounts/${ACCOUNT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls[0].url).toBe(`${META_BASE}/orgs/threads/accounts/${ACCOUNT_ID}`);
    expect(calls[0].options.method).toBe("DELETE");
    expect(calls[0].options.body).toBeUndefined();
  });

  it("POST accounts/:id/posts relays the 201, not a normalised 200", async () => {
    next = { status: 201, body: { accountId: ACCOUNT_ID, postId: "p1", permalink: null, replyToPostId: "p0" } };
    const res = await request(buildApp())
      .post(`/v1/orgs/threads/accounts/${ACCOUNT_ID}/posts`)
      .send({ text: "hello", replyToPostId: "p0" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(next.body);
    expect(calls[0].url).toBe(`${META_BASE}/orgs/threads/accounts/${ACCOUNT_ID}/posts`);
    expect(JSON.parse(calls[0].options.body)).toEqual({ text: "hello", replyToPostId: "p0" });
  });

  it.each([
    [409, { error: "Threads no longer accepts this login", reason: "needs_reconnect", accountId: ACCOUNT_ID }],
    [502, { error: "THREADS_APP_SECRET is not configured" }],
    [502, { error: "Threads refused", details: { operation: "publish", threads: { code: 190 } } }],
    [404, { error: "Threads account not found" }],
    [400, { error: "Invalid request", details: { fieldErrors: { text: ["Required"] } } }],
  ])("relays %i with its body field-for-field", async (status, body) => {
    next = { status, body };
    const res = await request(buildApp()).post(`/v1/orgs/threads/accounts/${ACCOUNT_ID}/posts`).send({ text: "x" });
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
  });

  it("keeps a smuggled traversal inside one encoded segment", async () => {
    await request(buildApp()).delete("/v1/orgs/threads/accounts/..%2F..%2Finternal%2Fthreads%2Ftoken-refresh");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${META_BASE}/orgs/threads/accounts/..%2F..%2Finternal%2Fthreads%2Ftoken-refresh`);
  });
});
