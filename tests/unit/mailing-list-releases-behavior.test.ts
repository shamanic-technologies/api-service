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
 * /v1/mailing-lists/{:slug/releases, releases/:releaseId/*} — BEHAVIOURAL cover.
 *
 * A source-substring test cannot see what goes over the wire (CLAUDE.md #7 corollaries
 * 2/3): a path prefix is satisfied by every wrong path built from the right pieces, and
 * `requireStaff` appearing in the source proves nothing about the identity forwarded. So
 * this file drives the real router with supertest and a stubbed `fetch`, and asserts the
 * forwarded URL, the forwarded identity headers, the byte-identical body, and — the
 * reason these routes pipe rather than parse — the upstream STATUS.
 *
 * `authenticate` is stubbed here (a staff caller); the real gate is exercised without any
 * auth mock in mailing-lists-auth.test.ts, which covers all seven release routes too.
 *
 * The payloads below are fixtures, not a contract this repo owns (CLAUDE.md #6/#8).
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

const RELEASE = {
  id: "9d0f7f2c-8a1b-4c2d-9e3f-0a1b2c3d4e5f",
  slug: "newsletter",
  subject: "The September letter",
  status: "sending",
  recipientCount: 30013,
  dailyLimit: 2000,
  sentCount: 4000,
  remainingCount: 26013,
};

describe("/v1/mailing-lists releases — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  // pipeExternalService copies the upstream status and streams the upstream bytes, so the
  // stub must be a real Response — a hand-rolled `{ json: () => ... }` has no body stream
  // and would not exercise the path that makes a 201 stay a 201.
  function stubFetch(body: unknown, status = 200) {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    });
  }

  beforeEach(() => {
    stubFetch(RELEASE, 200);
  });

  it("starts a release on the path transactional-email-service actually serves, body untouched, 201 intact", async () => {
    stubFetch({ created: true, estimatedDays: 16, ...RELEASE }, 201);

    const body = {
      subject: "The September letter",
      body: "## September\n\nWe shipped.",
      dailyLimit: 2000,
      // A field transactional-email-service may add later: a whitelist here would strip it
      // silently, passthrough must carry it through untouched.
      startAt: "2026-09-19T08:00:00.000Z",
    };
    const res = await request(buildApp())
      .post("/v1/mailing-lists/newsletter/releases")
      .send(body);

    // 201 means a release was CREATED, and it is contract — callExternalService + res.json
    // would have flattened it to 200.
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    // Full literal, not a prefix.
    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/newsletter/releases`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["x-email"]).toBe("kevin.lourd@gmail.com");
    expect(calls[0].options.headers["X-API-Key"]).toBe("te-test-key");
    expect(res.body).toEqual({ created: true, estimatedDays: 16, ...RELEASE });
  });

  it("keeps a 200 a 200 when an identical release was already running", async () => {
    stubFetch({ created: false, estimatedDays: 16, ...RELEASE }, 200);

    const res = await request(buildApp())
      .post("/v1/mailing-lists/newsletter/releases")
      .send({ subject: "The September letter", body: "## September", dailyLimit: 2000 });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
  });

  it("ignores a caller-supplied org — only the authenticated org reaches downstream", async () => {
    await request(buildApp())
      .get("/v1/mailing-lists/newsletter/releases?orgId=someone-elses-org")
      .set("x-org-id", "someone-elses-org");

    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("reads a list's releases, query string forwarded byte-for-byte", async () => {
    stubFetch({ slug: "newsletter", count: 1, releases: [RELEASE] });

    const res = await request(buildApp()).get(
      "/v1/mailing-lists/newsletter/releases?status=sending&includeDone=false",
    );

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(
      `${TE_BASE}/mailing-lists/newsletter/releases?status=sending&includeDone=false`,
    );
    expect(calls[0].options.method).toBe("GET");
    expect(res.body).toEqual({ slug: "newsletter", count: 1, releases: [RELEASE] });
  });

  it("watches one release by id", async () => {
    const res = await request(buildApp()).get(`/v1/mailing-lists/releases/${RELEASE.id}`);

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/releases/${RELEASE.id}`);
    expect(calls[0].options.method).toBe("GET");
    expect(res.body).toEqual(RELEASE);
  });

  it.each([
    ["pause", "post"],
    ["resume", "post"],
    ["cancel", "post"],
  ])("drives %s through its own downstream path", async (action, method) => {
    stubFetch({ ...RELEASE, status: action === "cancel" ? "cancelled" : action });

    const res = await (request(buildApp()) as any)[method](
      `/v1/mailing-lists/releases/${RELEASE.id}/${action}`,
    );

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/releases/${RELEASE.id}/${action}`);
    expect(calls[0].options.method).toBe("POST");
  });

  it("re-paces through PATCH, body untouched", async () => {
    stubFetch({ ...RELEASE, dailyLimit: 500 });

    const res = await request(buildApp())
      .patch(`/v1/mailing-lists/releases/${RELEASE.id}/pace`)
      .send({ dailyLimit: 500 });

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/releases/${RELEASE.id}/pace`);
    expect(calls[0].options.method).toBe("PATCH");
    expect(JSON.parse(calls[0].options.body)).toEqual({ dailyLimit: 500 });
  });

  it("propagates a 409 refusal with its status AND its words intact", async () => {
    // The whole point of the pace route: a staff member has to be able to read WHY the
    // release refused. Flattening the body into one `error` string would destroy `code`.
    stubFetch(
      {
        error:
          "Release 'completed' cannot be re-paced: it has already finished sending to every subscriber",
        code: "RELEASE_NOT_PACEABLE",
        details: { status: "completed" },
      },
      409,
    );

    const res = await request(buildApp())
      .patch(`/v1/mailing-lists/releases/${RELEASE.id}/pace`)
      .send({ dailyLimit: 500 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error:
        "Release 'completed' cannot be re-paced: it has already finished sending to every subscriber",
      code: "RELEASE_NOT_PACEABLE",
      details: { status: "completed" },
    });
  });

  it("propagates a 404 for an unknown release id, body intact", async () => {
    stubFetch({ error: "No release 'nope'" }, 404);

    const res = await request(buildApp()).get("/v1/mailing-lists/releases/nope");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No release 'nope'" });
  });

  it("percent-encodes both the slug and the release id into the downstream path", async () => {
    await request(buildApp()).get("/v1/mailing-lists/news%2Fletter/releases");
    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/news%2Fletter/releases`);

    stubFetch(RELEASE);
    await request(buildApp()).get("/v1/mailing-lists/releases/a%2Fb");
    expect(calls[0].url).toBe(`${TE_BASE}/mailing-lists/releases/a%2Fb`);
  });

  it("does not let the release routes swallow their literal siblings", async () => {
    // Express matches a path parameter against any single segment, so each of these could
    // be taken by a neighbouring pattern. Every one must still reach its own downstream path.
    for (const [path, expected] of [
      ["/v1/mailing-lists/investors/subscribers", "/mailing-lists/investors/subscribers"],
      ["/v1/mailing-lists/investors/updates", "/mailing-lists/investors/updates"],
      ["/v1/mailing-lists/investors/releases", "/mailing-lists/investors/releases"],
      // A list literally named "releases" still gets its own releases listed, rather than
      // being read as release id "releases".
      ["/v1/mailing-lists/releases/releases", "/mailing-lists/releases/releases"],
    ]) {
      stubFetch(RELEASE);
      await request(buildApp()).get(path);
      expect(calls[0].url).toBe(`${TE_BASE}${expected}`);
    }
  });

  it("does not expose the internal tick route", async () => {
    stubFetch({});

    const res = await request(buildApp()).post("/v1/internal/mailing-lists/releases/tick");

    // Service-to-service only (CLAUDE.md rule #3) — no handler here, and nothing forwarded.
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
