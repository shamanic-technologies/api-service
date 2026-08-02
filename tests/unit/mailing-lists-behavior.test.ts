import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { TE_BASE } = vi.hoisted(() => {
  const TE_BASE = "http://transactional-email.test.local";
  process.env.TRANSACTIONAL_EMAIL_SERVICE_URL = TE_BASE;
  process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY = "te-test-key";
  return { TE_BASE };
});

/**
 * /v1/mailing-lists/:slug/{subscribers,updates} — BEHAVIOURAL cover.
 *
 * Per CLAUDE.md #7 corollary 2/3, a test that reads the route file as TEXT cannot see
 * what goes over the wire: a path substring is satisfied by every wrong path built from
 * the right pieces, and `requireStaff` appearing in the source proves nothing about the
 * identity actually forwarded. So this file drives the real router with supertest and a
 * stubbed `fetch`, and asserts the forwarded URL, the forwarded identity headers, and the
 * byte-identical body.
 *
 * `authenticate` is stubbed here (a staff caller); the REAL gate — that a non-staff
 * caller is refused — is exercised without any auth mock in mailing-lists-auth.test.ts.
 *
 * What is asserted is the downstream path + the byte-identical body, NOT
 * transactional-email-service's field names: the payloads below are fixtures, not a
 * contract this repo owns (CLAUDE.md #6/#8).
 */

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "admin";
      // requireStaff (unmocked, running for real below) matches this against the
      // hardcoded STAFF_EMAILS allowlist.
      req.headers["x-email"] = "kevin.lourd@gmail.com";
      next();
    },
  };
});

import mailingListsRouter from "../../src/routes/mailing-lists.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", mailingListsRouter);
  return app;
}

const SUBSCRIBERS_BODY = {
  slug: "investors",
  count: 2,
  subscribers: [
    {
      email: "partner@fund.example",
      optedOut: false,
      optedOutReason: null,
      addedAt: "2026-07-30T10:00:00.000Z",
    },
    {
      email: "angel@example.com",
      optedOut: true,
      optedOutReason: "ManualSuppression",
      addedAt: "2026-07-31T09:00:00.000Z",
    },
  ],
};

const UPDATES_BODY = {
  slug: "investors",
  count: 1,
  updates: [
    {
      id: "1b1b0b8e-8f6a-4f9a-9a1e-7c1f2f3a4b5c",
      subject: "July update",
      body: "## July\n\nRevenue up.",
      htmlBody: "<h2>July</h2><p>Revenue up.</p>",
      status: "partial",
      recipientCount: 41,
      failures: [{ email: "bounced@example.com", reason: "HardBounce" }],
      sentAt: "2026-07-31T09:00:00.000Z",
    },
  ],
};

describe("/v1/mailing-lists — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  function stubFetch(body: unknown) {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(body) };
    });
  }

  beforeEach(() => {
    stubFetch(SUBSCRIBERS_BODY);
  });

  it("reads subscribers from the path transactional-email-service actually serves", async () => {
    const res = await request(buildApp()).get("/v1/mailing-lists/investors/subscribers");

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    // Full literal, not a prefix: a substring assertion passes for every wrong path
    // built from the right pieces.
    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/investors/subscribers`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["x-email"]).toBe("kevin.lourd@gmail.com");
    expect(calls[0].options.headers["X-API-Key"]).toBe("te-test-key");
  });

  it("returns the subscriber list unchanged, suppression state included", async () => {
    const res = await request(buildApp()).get("/v1/mailing-lists/investors/subscribers");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(SUBSCRIBERS_BODY);
  });

  it("ignores a caller-supplied org — only the authenticated org reaches downstream", async () => {
    const res = await request(buildApp())
      .get("/v1/mailing-lists/investors/subscribers?orgId=someone-elses-org")
      .set("x-org-id", "someone-elses-org");

    expect(res.status).toBe(200);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("forwards the add-subscribers body as-is, including a field this gateway knows nothing about", async () => {
    stubFetch({ slug: "investors", added: ["new@example.com"], skipped: [], rejected: [] });

    const body = {
      raw: "new@example.com, Someone <someone@example.com>",
      // A field transactional-email-service may add later. A whitelist here would strip
      // it silently; passthrough must carry it through untouched (AC #4).
      sourceNote: "pasted from the June cap table",
    };
    const res = await request(buildApp())
      .post("/v1/mailing-lists/investors/subscribers")
      .send(body);

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/investors/subscribers`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(res.body).toEqual({ slug: "investors", added: ["new@example.com"], skipped: [], rejected: [] });
  });

  it("forwards the DELETE query string byte-for-byte", async () => {
    stubFetch({ slug: "investors", email: "angel@example.com", removed: true });

    const res = await request(buildApp()).delete(
      "/v1/mailing-lists/investors/subscribers?email=angel%2Btag%40example.com",
    );

    expect(res.status).toBe(200);
    // Not re-serialized from req.query — the caller's exact encoding survives.
    expect(calls[0].url).toBe(
      `${TE_BASE}/mailing-lists/investors/subscribers?email=angel%2Btag%40example.com`,
    );
    expect(calls[0].options.method).toBe("DELETE");
  });

  it("forwards an unknown query param the gateway has never heard of", async () => {
    stubFetch(SUBSCRIBERS_BODY);

    await request(buildApp()).get("/v1/mailing-lists/investors/subscribers?includeRemoved=true");

    expect(calls[0].url).toBe(
      `${TE_BASE}/mailing-lists/investors/subscribers?includeRemoved=true`,
    );
  });

  it("sends a written update through the updates path, body untouched", async () => {
    stubFetch({
      updateId: "u1",
      slug: "investors",
      subject: "July update",
      status: "sent",
      recipientCount: 42,
      skippedOptedOut: [],
      failures: [],
    });

    const body = { subject: "July update", body: "## July\n\nRevenue up." };
    const res = await request(buildApp()).post("/v1/mailing-lists/investors/updates").send(body);

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/investors/updates`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-email"]).toBe("kevin.lourd@gmail.com");
  });

  it("reads the update history unchanged, partial status and failures intact", async () => {
    stubFetch(UPDATES_BODY);

    const res = await request(buildApp()).get("/v1/mailing-lists/investors/updates");

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/investors/updates`);
    expect(calls[0].options.method).toBe("GET");
    expect(res.body).toEqual(UPDATES_BODY);
  });

  it("percent-encodes the slug into the downstream path", async () => {
    stubFetch(SUBSCRIBERS_BODY);

    await request(buildApp()).get("/v1/mailing-lists/investors%2Fseed/subscribers");

    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/investors%2Fseed/subscribers`);
  });

  it("propagates a downstream 404 with its status AND its body intact", async () => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 404,
        text: () =>
          Promise.resolve(JSON.stringify({ error: "No such list", code: "LIST_NOT_FOUND" })),
        json: () => Promise.resolve({}),
      };
    });

    const res = await request(buildApp()).get("/v1/mailing-lists/nope/subscribers");

    // Not flattened into { error: "<the whole JSON body>" } — `code` survives (CLAUDE.md #7).
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No such list", code: "LIST_NOT_FOUND" });
  });

  it("propagates a downstream 502 when provider suppression state is unavailable", async () => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 502,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: "Provider suppression state unavailable",
            code: "SUPPRESSION_UNAVAILABLE",
            details: { provider: "postmark" },
          }),
        ),
      json: () => Promise.resolve({}),
    }));

    const res = await request(buildApp()).get("/v1/mailing-lists/investors/subscribers");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: "Provider suppression state unavailable",
      code: "SUPPRESSION_UNAVAILABLE",
      details: { provider: "postmark" },
    });
  });
});
