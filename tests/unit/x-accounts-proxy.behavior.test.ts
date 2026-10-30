import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/x/* must forward to social-service's own /orgs/x/* — path preserved,
 * query string byte-copied, body forwarded verbatim, upstream STATUS and body
 * relayed untransformed (the dashboard branches on 400/402/409/502 and
 * `details.provider`).
 *
 * Every assertion drives the real router and reads the captured `fetch` call.
 */

// externalServices reads its env at import: set social-service's before the router loads.
vi.hoisted(() => {
  process.env.SOCIAL_SERVICE_URL = "http://social.test.local";
  process.env.SOCIAL_SERVICE_API_KEY = "social-test-key";
});

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

import xAccountsRouter from "../../src/routes/x-accounts.js";

const SOCIAL_BASE = "http://social.test.local";
const ACCOUNT_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const BRAND_ID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", xAccountsRouter);
  return app;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("/v1/orgs/x/* → social-service", () => {
  let calls: Array<{ url: string; options: any }>;
  let next: { status: number; body: unknown };

  beforeEach(() => {
    calls = [];
    next = { status: 200, body: { ok: true } };
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return jsonResponse(next.status, next.body);
    });
  });

  it("POST auth/start forwards the body + identity (brandId promoted), returns the upstream body", async () => {
    next.body = { authorizationUrl: "https://x.com/i/oauth2/authorize?x=1", state: "s1", expiresAt: "2026-10-30T14:00:00Z" };
    const body = { brandId: BRAND_ID, accountType: "pro_ai", redirectUri: "https://dashboard.distribute.you/connections/x/callback" };
    const res = await request(buildApp()).post("/v1/orgs/x/auth/start").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/orgs/x/auth/start`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["X-API-Key"]).toBe("social-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
  });

  it("POST auth/callback forwards { code, state } verbatim", async () => {
    next.body = { account: { id: ACCOUNT_ID }, created: true };
    const res = await request(buildApp()).post("/v1/orgs/x/auth/callback").send({ code: "c", state: "s" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/orgs/x/auth/callback`);
    expect(JSON.parse(calls[0].options.body)).toEqual({ code: "c", state: "s" });
  });

  it("GET accounts byte-copies the query and promotes brandId to x-brand-id", async () => {
    next.body = { accounts: [] };
    const res = await request(buildApp()).get(`/v1/orgs/x/accounts?brandId=${BRAND_ID}&future=x%2By`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accounts: [] });
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/orgs/x/accounts?brandId=${BRAND_ID}&future=x%2By`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[0].options.headers["x-brand-id"]).toBe(BRAND_ID);
  });

  it("PATCH accounts/:id forwards the body to the account path", async () => {
    next.body = { account: { id: ACCOUNT_ID, accountType: "pro_human" } };
    const res = await request(buildApp()).patch(`/v1/orgs/x/accounts/${ACCOUNT_ID}`).send({ accountType: "pro_human" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/orgs/x/accounts/${ACCOUNT_ID}`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ accountType: "pro_human" });
  });

  it("DELETE accounts/:id forwards with no body", async () => {
    next.body = { message: "X account disconnected" };
    const res = await request(buildApp()).delete(`/v1/orgs/x/accounts/${ACCOUNT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/orgs/x/accounts/${ACCOUNT_ID}`);
    expect(calls[0].options.method).toBe("DELETE");
    expect(calls[0].options.body).toBeUndefined();
  });

  it.each([
    [400, { type: "x_login_invalid", error: "X refused the login" }],
    [402, { type: "insufficient_balance", error: "Insufficient balance", balance_cents: 0, required_cents: 5 }],
    [409, { type: "needs_reconnect", error: "X no longer accepts this login", accountId: ACCOUNT_ID }],
    [502, { type: "x_not_configured", error: "X_OAUTH_CLIENT_ID is not configured", details: { provider: "X_OAUTH_CLIENT_ID" } }],
    [502, { type: "upstream", error: "X answered 503" }],
  ])("relays %i with its body field-for-field", async (status, body) => {
    next = { status, body };
    const res = await request(buildApp()).post("/v1/orgs/x/auth/callback").send({ code: "c", state: "s" });
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
  });

  it("relays 404 on an unknown account", async () => {
    next = { status: 404, body: { type: "not_found", error: "X account not found" } };
    const res = await request(buildApp()).delete(`/v1/orgs/x/accounts/${ACCOUNT_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(next.body);
  });

  it("keeps a smuggled traversal inside one encoded segment", async () => {
    await request(buildApp()).delete("/v1/orgs/x/accounts/..%2F..%2Finternal%2Fx-accounts%2Frefresh");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/orgs/x/accounts/..%2F..%2Finternal%2Fx-accounts%2Frefresh`);
  });
});
