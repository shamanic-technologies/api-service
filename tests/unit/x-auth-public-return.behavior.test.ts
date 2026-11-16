import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/public/x/auth/return (X-ONE-CLICK-1116): the address X redirects the
 * X account owner's browser to after he authorizes a link an agent started with
 * POST /v1/orgs/x/auth/start. Public tier: he has no key and maybe no account.
 *
 * NOTHING is mocked here, `authenticate` included (CLAUDE.md rule #3): the real
 * router must answer with no credentials at all, forward the query verbatim to
 * social-service's own /public/x/auth/return with NO identity of any kind (the
 * `state` alone names the pending connection there), and hand the person the
 * page social-service wrote, under its status, whatever that status is.
 */
vi.hoisted(() => {
  process.env.SOCIAL_SERVICE_URL = "http://social.test.local";
  process.env.SOCIAL_SERVICE_API_KEY = "social-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
});

import xAccountsRouter from "../../src/routes/x-accounts.js";

const SOCIAL_BASE = "http://social.test.local";
const STATE = "ab".repeat(32);
const CONNECTED = "<!doctype html>\n<html lang=\"en\"><body><h1>@ResearchBrand is connected</h1><p>You can close this tab.</p></body></html>\n";
const DEAD = "<!doctype html>\n<html lang=\"en\"><body><h1>This link no longer works</h1></body></html>\n";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", xAccountsRouter);
  return app;
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[];

function stubFetch(answer: () => Response) {
  global.fetch = vi.fn(async (input: any, init: any) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body });
    return answer();
  }) as any;
}

const html = (status: number, page: string) => new Response(page, { status, headers: { "content-type": "text/html; charset=utf-8" } });

beforeEach(() => {
  calls = [];
});

describe("GET /v1/public/x/auth/return → social-service GET /public/x/auth/return", () => {
  it("needs no credentials; forwards code + state verbatim with no identity; the owner gets social-service's page", async () => {
    stubFetch(() => html(200, CONNECTED));
    const res = await request(buildApp()).get(`/v1/public/x/auth/return?state=${STATE}&code=a%2Bb%3D`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toBe(CONNECTED);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/public/x/auth/return?state=${STATE}&code=a%2Bb%3D`);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].headers["X-API-Key"]).toBe("social-test-key");
  });

  it("an org, brand or user the caller names never becomes an identity header", async () => {
    stubFetch(() => html(200, CONNECTED));
    const named = "99999999-1111-4111-8111-111111111111";
    await request(buildApp())
      .get(`/v1/public/x/auth/return?state=${STATE}&code=c&orgId=${named}&brandId=${named}`)
      .set({ "x-org-id": named, "x-user-id": named, "x-brand-id": named, "x-run-id": named });

    expect(calls).toHaveLength(1);
    const sent = Object.fromEntries(Object.entries(calls[0].headers).map(([k, v]) => [k.toLowerCase(), v]));
    for (const h of ["x-org-id", "x-user-id", "x-brand-id", "x-run-id", "x-campaign-id", "authorization"]) {
      expect(sent[h], h).toBeUndefined();
    }
    // The query is the caller's bytes; what social-service reads of it is its own contract (the state only).
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/public/x/auth/return?state=${STATE}&code=c&orgId=${named}&brandId=${named}`);
  });

  it.each([400, 402, 409, 502])("a %i page stays a page for the person, under social-service's status", async (status) => {
    stubFetch(() => html(status, DEAD));
    const res = await request(buildApp()).get(`/v1/public/x/auth/return?state=${STATE}&code=used`);
    expect(res.status).toBe(status);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toBe(DEAD);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("X's decline (`error`, no `code`) is forwarded as sent", async () => {
    stubFetch(() => html(400, DEAD));
    await request(buildApp()).get(`/v1/public/x/auth/return?error=access_denied&state=${STATE}`);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/public/x/auth/return?error=access_denied&state=${STATE}`);
  });

  it("a JSON refusal from social-service keeps its status and fields", async () => {
    const refusal = { type: "starting", error: "migrations not finished" };
    stubFetch(() => new Response(JSON.stringify(refusal), { status: 503, headers: { "content-type": "application/json" } }));
    const res = await request(buildApp()).get(`/v1/public/x/auth/return?state=${STATE}&code=c`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual(refusal);
  });

  it("is the only public X route: every other one still answers 401 with no outbound call", async () => {
    stubFetch(() => html(200, CONNECTED));
    const app = buildApp();
    expect((await request(app).post("/v1/orgs/x/auth/callback").send({ code: "c", state: STATE })).status).toBe(401);
    expect((await request(app).get("/v1/orgs/x/accounts")).status).toBe(401);
    expect((await request(app).post("/v1/public/x/auth/return")).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
