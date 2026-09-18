import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { INSTANTLY_BASE } = vi.hoisted(() => {
  const INSTANTLY_BASE = "http://instantly.test.local";
  process.env.INSTANTLY_SERVICE_URL = INSTANTLY_BASE;
  process.env.INSTANTLY_SERVICE_API_KEY = "instantly-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { INSTANTLY_BASE };
});

/**
 * /v1/instantly/ops/* — BEHAVIOURAL cover for the unified-model staff reads.
 *
 * A source-substring test cannot see what goes over the wire (CLAUDE.md rule #7,
 * corollary 3), and everything these routes owe their caller IS what goes over the
 * wire: the downstream path, the caller's query string verbatim, and
 * instantly-service's own status AND body coming back field-for-field — including
 * the 400 it raises when `limit` is missing and the 404 on an unknown message.
 *
 * The real staff gate runs here (no auth mock): the platform key + a staff x-email
 * are what the requests below carry. `instantly-ops-auth.test.ts` covers refusal.
 */

import instantlyRouter from "../../src/routes/instantly.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", instantlyRouter);
  return app;
}

const STAFF = {
  "x-api-key": "platform-test-key",
  "x-email": "kevin.lourd@gmail.com",
};

// gateway path → instantly-service path. The whole contract of these seven reads.
const READS: Array<[string, string]> = [
  ["lifecycle-rules", "lifecycle-rules"],
  ["domains", "domains"],
  ["mailboxes", "mailboxes"],
  ["addresses", "addresses"],
  ["infra", "infra"],
  ["threads", "threads"],
  ["messages", "messages"],
];

describe("/v1/instantly/ops/* — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  function stub(status: number, body: string | null, contentType = "application/json") {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return new Response(body, {
        status,
        headers: body === null ? {} : { "content-type": contentType },
      });
    });
  }

  beforeEach(() => {
    calls = [];
    stub(200, JSON.stringify({ ok: true }));
  });

  for (const [gatewaySegment, downstreamSegment] of READS) {
    it(`GET /v1/instantly/ops/${gatewaySegment} reaches /internal/ops/${downstreamSegment} with the staff email`, async () => {
      const res = await request(buildApp()).get(`/v1/instantly/ops/${gatewaySegment}`).set(STAFF);

      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${INSTANTLY_BASE}/internal/ops/${downstreamSegment}`);
      expect(calls[0].options.method).toBe("GET");
      expect(calls[0].options.headers["X-API-Key"]).toBe("instantly-test-key");
      expect(calls[0].options.headers["x-email"]).toBe("kevin.lourd@gmail.com");
      // Platform-wide staff data: no org identity is involved on this surface.
      expect(calls[0].options.headers["x-org-id"]).toBeUndefined();
      expect(calls[0].options.headers["x-user-id"]).toBeUndefined();
      expect(res.body).toEqual({ ok: true });
    });
  }

  it("forwards the threads query string verbatim, including a filter this gateway never declared", async () => {
    await request(buildApp())
      .get("/v1/instantly/ops/threads?limit=50&cursor=abc%3D%3D&kind=outreach&hasInbound=true&somethingNew=42")
      .set(STAFF);

    expect(calls[0].url).toBe(
      `${INSTANTLY_BASE}/internal/ops/threads?limit=50&cursor=abc%3D%3D&kind=outreach&hasInbound=true&somethingNew=42`,
    );
  });

  it("forwards the messages query string verbatim, threadId included", async () => {
    await request(buildApp())
      .get("/v1/instantly/ops/messages?limit=100&threadId=thr_1&mailbox=a%40b.com&direction=in")
      .set(STAFF);

    expect(calls[0].url).toBe(
      `${INSTANTLY_BASE}/internal/ops/messages?limit=100&threadId=thr_1&mailbox=a%40b.com&direction=in`,
    );
  });

  it("hands back instantly-service's 400 when `limit` is missing on threads, body intact", async () => {
    const upstream = { error: "limit is required", code: "invalid_query" };
    stub(400, JSON.stringify(upstream));

    const res = await request(buildApp()).get("/v1/instantly/ops/threads").set(STAFF);

    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/internal/ops/threads`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(upstream);
  });

  it("hands back instantly-service's 400 when `limit` is missing on messages, body intact", async () => {
    const upstream = { error: "limit is required", code: "invalid_query" };
    stub(400, JSON.stringify(upstream));

    const res = await request(buildApp()).get("/v1/instantly/ops/messages").set(STAFF);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(upstream);
  });

  it("reads one message body by id, with the id percent-encoded into the downstream path", async () => {
    const body = { text: "hello", html: null, source: "instantly_unibox_messages" };
    stub(200, JSON.stringify(body));

    const res = await request(buildApp()).get("/v1/instantly/ops/messages/msg%2F1/body").set(STAFF);

    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/internal/ops/messages/msg%2F1/body`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
  });

  it("hands back the 404 for an unknown message body unchanged", async () => {
    const upstream = { error: "message_not_found" };
    stub(404, JSON.stringify(upstream));

    const res = await request(buildApp()).get("/v1/instantly/ops/messages/nope/body").set(STAFF);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(upstream);
  });

  it("does not let /ops/messages/:id/body be served as the messages list", async () => {
    await request(buildApp()).get("/v1/instantly/ops/messages/abc/body").set(STAFF);
    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/internal/ops/messages/abc/body`);
  });

  it("leaves the pre-existing audit and infra proxies on their own downstream paths", async () => {
    await request(buildApp()).get("/v1/instantly/audit/sending-forecast").set(STAFF);
    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/internal/audit/sending-forecast`);

    calls = [];
    await request(buildApp()).get("/v1/instantly/infra/domains").set(STAFF);
    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/internal/infra/domains`);
  });

  it("does not flatten a non-JSON upstream error into a lost body", async () => {
    stub(500, "instantly-service exploded", "text/plain");

    const res = await request(buildApp()).get("/v1/instantly/ops/infra").set(STAFF);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "instantly-service exploded" });
  });
});
