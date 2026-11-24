import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * REELS-1124: the existing /v1/orgs/social/* passthroughs carry Instagram with no
 * gateway change of shape: `network=instagram` reaches social-service byte-copied
 * on the account and publication reads, and a Reel publish body (`media` with one
 * video, `outcomeKey: instagram_reel_published`) is forwarded field-for-field.
 * Drives the real router and reads the captured `fetch` call.
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

import socialBrandRouter from "../../src/routes/social-brand.js";

const SOCIAL_BASE = "http://social.test.local";
const BRAND_ID = "a6b5fdad-b31d-4fa2-b34b-1cec4cb21ce5";
const ACCOUNT_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", socialBrandRouter);
  return app;
}

let calls: Array<{ url: string; options: any }>;
let next: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  next = { status: 200, body: { ok: true } };
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  });
});

describe("/v1/orgs/social/* carries Instagram untouched", () => {
  it("GET accounts forwards network=instagram verbatim", async () => {
    next.body = { accounts: [] };
    const res = await request(buildApp()).get(`/v1/orgs/social/accounts?brandId=${BRAND_ID}&network=instagram`);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/orgs/social/accounts?brandId=${BRAND_ID}&network=instagram`);
  });

  it("GET publications forwards network=instagram verbatim", async () => {
    next.body = { publications: [] };
    const res = await request(buildApp()).get(`/v1/orgs/social/publications?brandId=${BRAND_ID}&network=instagram&since=2026-11-01T00%3A00%3A00Z`);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/orgs/social/publications?brandId=${BRAND_ID}&network=instagram&since=2026-11-01T00%3A00%3A00Z`);
  });

  it("POST posts forwards a Reel body (media video) field-for-field and relays the answer", async () => {
    next.body = { publication: { id: "p1", status: "published", permalink: "https://www.instagram.com/reel/abc/" }, created: true };
    const body = {
      text: "Polarity in 30 seconds #polarity",
      idempotencyKey: "reel-2026-11-24-clip-01",
      outcomeKey: "instagram_reel_published",
      media: [{ url: "https://media.example.com/clip-01.mp4", type: "video" }],
    };
    const res = await request(buildApp()).post(`/v1/orgs/social/accounts/${ACCOUNT_ID}/posts?campaignId=c1`).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(next.body);
    expect(calls[0].url).toBe(`${SOCIAL_BASE}/orgs/social/accounts/${ACCOUNT_ID}/posts?campaignId=c1`);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it.each([
    [409, { type: "instagram_publish_permission_missing", error: "The login lacks publish permission" }],
    [502, { type: "instagram_processing_timeout", error: "Instagram did not finish processing the video" }],
  ])("relays a Reel refusal %i field-for-field", async (status, body) => {
    next = { status, body };
    const res = await request(buildApp())
      .post(`/v1/orgs/social/accounts/${ACCOUNT_ID}/posts`)
      .send({ text: "t", idempotencyKey: "reel-key-0001", media: [{ url: "https://m.example.com/v.mp4", type: "video" }] });
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
  });
});
