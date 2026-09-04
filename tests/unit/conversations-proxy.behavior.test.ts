import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/conversations — pass-through to instantly-service GET /orgs/conversations.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes over
 * the wire: the downstream path, the identity headers, the query string, and — the point
 * of this route — that the three downstream refusals stay distinguishable (CLAUDE.md
 * rule #7 corollaries 2 and 3: a source-substring test can see none of that).
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

const CAMPAIGN = "33333333-3333-3333-3333-333333333333";
const EMAIL = "prospect@example.com";
const QUERY = `?campaign_id=${CAMPAIGN}&email=${encodeURIComponent(EMAIL)}`;

const CONVERSATION_BODY = JSON.stringify({
  success: true,
  conversation: {
    campaignId: CAMPAIGN,
    instantlyCampaignId: "inst-1",
    leadEmail: "Prospect@Example.com",
    accountEmail: "us@sender.example",
    transport: "smtp",
    messageCount: 2,
    messages: [
      {
        direction: "outbound",
        from: "us@sender.example",
        to: EMAIL,
        at: "2026-09-01T10:00:00.000Z",
        subject: "Hello",
        text: "We wrote this.",
      },
      {
        direction: "inbound",
        from: EMAIL,
        to: "us@sender.example",
        at: "2026-09-01T12:00:00.000Z",
        subject: "Re: Hello",
        text: "They wrote this.",
      },
    ],
    unknownDownstreamField: 7,
  },
});

describe("GET /v1/conversations — conversation pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  function stubUpstream(body: string, status: number) {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      });
    });
  }

  beforeEach(() => {
    stubUpstream(CONVERSATION_BODY, 200);
  });

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("forwards to instantly-service GET /orgs/conversations", async () => {
    const res = await request(buildApp()).get(`/v1/conversations${QUERY}`);
    expect(res.status).toBe(200);

    const { url, init } = upstream();
    expect(url).toContain("/orgs/conversations?");
    expect(url).not.toContain("/internal/");
    expect(url.startsWith("http://instantly.test.local/orgs/conversations")).toBe(true);
    expect(init.method ?? "GET").toBe("GET");
  });

  it("forwards the caller's query string verbatim, order and encoding intact", async () => {
    await request(buildApp()).get(
      `/v1/conversations?email=${encodeURIComponent(EMAIL)}&campaign_id=${CAMPAIGN}&zzz=keep+me`,
    );
    const { url } = upstream();
    expect(url).toContain(
      `/orgs/conversations?email=${encodeURIComponent(EMAIL)}&campaign_id=${CAMPAIGN}&zzz=keep+me`,
    );
  });

  it("sends the AUTHENTICATED org, not one the caller named", async () => {
    await request(buildApp())
      .get(`/v1/conversations${QUERY}`)
      .set("x-org-id", "someone-elses-org");

    const { init } = upstream();
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
    expect(init.headers["x-user-id"]).toBe("user_test123");
    expect(init.headers["X-API-Key"]).toBe("instantly-test-key");
  });

  it("returns the upstream body field-for-field", async () => {
    const res = await request(buildApp()).get(`/v1/conversations${QUERY}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(CONVERSATION_BODY));
    // A field this gateway has never heard of survives the hop.
    expect(res.body.conversation.unknownDownstreamField).toBe(7);
    expect(res.body.conversation.messages).toHaveLength(2);
  });

  it("keeps a 200 with no messages as a 200 with no messages", async () => {
    stubUpstream(
      JSON.stringify({
        success: true,
        conversation: { campaignId: CAMPAIGN, messageCount: 0, messages: [] },
      }),
      200,
    );
    const res = await request(buildApp()).get(`/v1/conversations${QUERY}`);
    expect(res.status).toBe(200);
    expect(res.body.conversation.messages).toEqual([]);
    expect(res.body.error).toBeUndefined();
  });

  it("forwards a 404 campaign_not_found with its code, never as an empty conversation", async () => {
    stubUpstream(
      JSON.stringify({ error: "No campaign for that email", code: "campaign_not_found" }),
      404,
    );
    const res = await request(buildApp()).get(`/v1/conversations${QUERY}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No campaign for that email", code: "campaign_not_found" });
    expect(res.body.conversation).toBeUndefined();
  });

  it("forwards a 502 thread_unavailable with its code, never as an empty conversation", async () => {
    stubUpstream(
      JSON.stringify({ error: "Thread could not be read", code: "thread_unavailable" }),
      502,
    );
    const res = await request(buildApp()).get(`/v1/conversations${QUERY}`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Thread could not be read", code: "thread_unavailable" });
    expect(res.body.conversation).toBeUndefined();
  });

  it("forwards a downstream 400 verbatim rather than raising its own", async () => {
    stubUpstream(JSON.stringify({ error: "email must be a valid email" }), 400);
    const res = await request(buildApp()).get(`/v1/conversations?campaign_id=${CAMPAIGN}&email=nope`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "email must be a valid email" });
  });

  it("400s locally when a required parameter is absent, without calling downstream", async () => {
    const missingEmail = await request(buildApp()).get(`/v1/conversations?campaign_id=${CAMPAIGN}`);
    expect(missingEmail.status).toBe(400);

    const missingCampaign = await request(buildApp()).get(
      `/v1/conversations?email=${encodeURIComponent(EMAIL)}`,
    );
    expect(missingCampaign.status).toBe(400);

    expect(calls).toHaveLength(0);
  });
});
