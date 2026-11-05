import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/conversations/index and GET /v1/conversations/messages — the two-step read
 * of a long conversation (AGENT-READS-THREAD-1105), pass-throughs to instantly-service
 * GET /orgs/conversations/index and /orgs/conversations/messages. Driven through the
 * real router with a stubbed `fetch`: full downstream path, authenticated identity,
 * verbatim query, upstream refusals field-for-field.
 */

vi.hoisted(() => {
  process.env.INSTANTLY_SERVICE_URL = "http://instantly.test.local";
  process.env.INSTANTLY_SERVICE_API_KEY = "instantly-test-key";
});

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import conversationsRouter from "../../src/routes/conversations.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", conversationsRouter);
  return app;
}

const EMAIL = "prospect@example.com";
const Q = `email=${encodeURIComponent(EMAIL)}`;

let calls: Array<{ url: string; init: any }>;
function stubUpstream(body: unknown, status = 200) {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

const INDEX_BODY = {
  success: true,
  conversation: {
    order: "newest_first",
    inboundCount: 1,
    outboundCount: 1,
    messages: [
      { id: "m2", at: "2026-11-02T10:00:00.000Z", direction: "outbound", preview: "Our answer", chars: 400 },
      { id: "m1", at: "2026-11-01T10:00:00.000Z", direction: "inbound", preview: "His reply", chars: 120 },
    ],
    unknownDownstreamField: 7,
  },
};

describe("GET /v1/conversations/index", () => {
  beforeEach(() => stubUpstream(INDEX_BODY));

  it("forwards to instantly-service GET /orgs/conversations/index with the query verbatim", async () => {
    const res = await request(buildApp()).get(`/v1/conversations/index?${Q}&zzz=keep+me`);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`http://instantly.test.local/orgs/conversations/index?${Q}&zzz=keep+me`);
    expect(calls[0].init.method ?? "GET").toBe("GET");
  });

  it("does not need campaign_id (optional downstream)", async () => {
    const res = await request(buildApp()).get(`/v1/conversations/index?${Q}`);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("sends the AUTHENTICATED org, not one the caller named", async () => {
    await request(buildApp()).get(`/v1/conversations/index?${Q}`).set("x-org-id", "someone-elses-org");
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[0].init.headers["x-user-id"]).toBe("user_test123");
  });

  it("returns the upstream body byte-identical", async () => {
    const res = await request(buildApp()).get(`/v1/conversations/index?${Q}`);
    expect(res.body).toEqual(INDEX_BODY);
  });

  it("forwards 404 campaign_not_found and 502 thread_unavailable field-for-field", async () => {
    stubUpstream({ error: "No campaign", code: "campaign_not_found" }, 404);
    let res = await request(buildApp()).get(`/v1/conversations/index?${Q}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No campaign", code: "campaign_not_found" });

    stubUpstream({ error: "Thread could not be read", code: "thread_unavailable" }, 502);
    res = await request(buildApp()).get(`/v1/conversations/index?${Q}`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Thread could not be read", code: "thread_unavailable" });
  });

  it("400s locally without email, never calling downstream", async () => {
    const res = await request(buildApp()).get(`/v1/conversations/index`);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("GET /v1/conversations/messages", () => {
  const BODY = { success: true, campaignId: "c1", leadEmail: EMAIL, messages: [{ id: "m2", text: "Full answer" }] };
  beforeEach(() => stubUpstream(BODY));

  it("forwards to instantly-service GET /orgs/conversations/messages with ids verbatim", async () => {
    const res = await request(buildApp()).get(`/v1/conversations/messages?${Q}&ids=m2,m1`);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`http://instantly.test.local/orgs/conversations/messages?${Q}&ids=m2,m1`);
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
    expect(res.body).toEqual(BODY);
  });

  it("forwards 404 message_not_found with missingIds field-for-field", async () => {
    const refusal = { error: "No message zz in this conversation", code: "message_not_found", missingIds: ["zz"] };
    stubUpstream(refusal, 404);
    const res = await request(buildApp()).get(`/v1/conversations/messages?${Q}&ids=zz`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(refusal);
  });

  it("400s locally without ids or email, never calling downstream", async () => {
    expect((await request(buildApp()).get(`/v1/conversations/messages?${Q}`)).status).toBe(400);
    expect((await request(buildApp()).get(`/v1/conversations/messages?ids=m1`)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("leaves GET /v1/conversations on its own downstream path", async () => {
    await request(buildApp()).get(`/v1/conversations?campaign_id=c1&${Q}`);
    expect(calls[0].url).toBe(`http://instantly.test.local/orgs/conversations?campaign_id=c1&${Q}`);
  });
});
