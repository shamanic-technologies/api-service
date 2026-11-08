import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/orgs/social/* (INDUSTRY-NEWS-ENGINE-1108) forwards to social-service's own /orgs/social/*: path preserved, query
 * byte-copied (brandId / campaignId promoted to identity headers: a hand post's Unit lands on the named campaign),
 * body verbatim, upstream status + body relayed. The scan door and /internal/* are not exposed.
 */
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

import router from "../../src/routes/social-brand.js";

const BASE = "http://social.test.local";
const ACCOUNT = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const BRAND = "f4d73dab-1f9d-49b2-b16e-63ecde76a5eb";
const CAMPAIGN = "0cf650d2-0904-4f46-a4c9-038eb27873a6";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", router);
  return a;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("/v1/orgs/social/* → social-service", () => {
  let calls: Array<{ url: string; options: any }>;
  let next: { status: number; body: unknown };
  beforeEach(() => {
    calls = [];
    next = { status: 200, body: { ok: true } };
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return json(next.status, next.body);
    });
  });

  it("POST a post forwards the body verbatim and names the campaign from the query", async () => {
    next.body = { publication: { id: "p1" }, created: true };
    const body = { text: "Cold email is not dead.", reply: "Data: distribute.you/research", idempotencyKey: "hand:x:2026-11-08:1", outcomeKey: "x_post_published" };
    const res = await request(app()).post(`/v1/orgs/social/accounts/${ACCOUNT}/posts?campaignId=${CAMPAIGN}&brandId=${BRAND}`).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/orgs/social/accounts/${ACCOUNT}/posts?campaignId=${CAMPAIGN}&brandId=${BRAND}`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-campaign-id"]).toBe(CAMPAIGN);
    expect(calls[0].options.headers["x-brand-id"]).toBe(BRAND);
  });

  it("relays a refusal's status and body untransformed", async () => {
    next = { status: 409, body: { type: "needs_reconnect", error: "reconnect" } };
    const res = await request(app()).post(`/v1/orgs/social/accounts/${ACCOUNT}/posts`).send({ text: "t" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(next.body);
  });

  it("GET reads forward to their exact social-service paths with the query byte-copied", async () => {
    for (const [path, q] of [
      ["/orgs/social/industry-news", `?brandId=${BRAND}&since=2026-11-08T00:00:00Z&limit=50`],
      ["/orgs/social/accounts", `?brandId=${BRAND}&network=x`],
      ["/orgs/social/publications", `?brandId=${BRAND}&network=linkedin&since=2026-11-01T00:00:00Z`],
    ]) {
      calls = [];
      const res = await request(app()).get(`/v1${path}${q}`);
      expect(res.status).toBe(200);
      expect(calls[0].url).toBe(`${BASE}${path}${q}`);
      expect(calls[0].options.method ?? "GET").toBe("GET");
      expect(calls[0].options.headers["x-brand-id"]).toBe(BRAND);
    }
  });

  it("POST replies and DELETE a publication forward to their exact social-service paths", async () => {
    const body = { target: "https://x.com/jdoe/status/1888000000000000001", text: "Same.", idempotencyKey: "reply:x:1", outcomeKey: "x_reply_published" };
    const r = await request(app()).post(`/v1/orgs/social/accounts/${ACCOUNT}/replies?campaignId=${CAMPAIGN}`).send(body);
    expect(r.status).toBe(200);
    expect(calls[0].url).toBe(`${BASE}/orgs/social/accounts/${ACCOUNT}/replies?campaignId=${CAMPAIGN}`);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-campaign-id"]).toBe(CAMPAIGN);
    calls = [];
    const POST_ID = "11111111-2222-4333-8444-555555555555";
    const d = await request(app()).delete(`/v1/orgs/social/accounts/${ACCOUNT}/posts/${POST_ID}`);
    expect(d.status).toBe(200);
    expect(calls[0].url).toBe(`${BASE}/orgs/social/accounts/${ACCOUNT}/posts/${POST_ID}`);
    expect(calls[0].options.method).toBe("DELETE");
  });

  it("does not expose the scan door nor /internal routes", async () => {
    expect((await request(app()).post("/v1/orgs/social/industry-news/scans").send({})).status).toBe(404);
    expect((await request(app()).post("/v1/internal/industry-news/scans").send({})).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
