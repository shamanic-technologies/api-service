import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { LEAD_BASE } = vi.hoisted(() => {
  const LEAD_BASE = "http://lead.test.local";
  process.env.LEAD_SERVICE_URL = LEAD_BASE;
  process.env.LEAD_SERVICE_API_KEY = "lead-test-key";
  return { LEAD_BASE };
});

/**
 * GET /v1/leads/stats — behavioural cover.
 *
 * The point of the route is that a caller learns a brand's lead counts WITHOUT
 * receiving leads, so the assertions that matter are over the wire: the downstream
 * path lead-service actually serves, the query forwarded verbatim, the org taken from
 * the authenticated identity rather than from the caller, and the body returned
 * byte-identical. A source-substring test can see none of those.
 *
 * Per CLAUDE.md #6/#8 the upstream payload below is a fixture, not a contract this
 * repo owns — nothing here asserts lead-service's field names beyond echoing them back.
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
      req.authType = "user_key";
      next();
    },
  };
});

import leadsRouter from "../../src/routes/leads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", leadsRouter);
  return app;
}

// The counts for a brand with tens of thousands of leads. This whole object is
// ~700 bytes serialized — the point of the route.
const UPSTREAM_BODY = {
  totalLeads: 57622,
  byOutreachStatus: {
    contacted: 41003,
    sent: 41003,
    delivered: 39880,
    opened: 12044,
    bounced: 1123,
    clicked: 903,
    unsubscribed: 211,
    repliesPositive: 318,
    repliesNegative: 902,
    repliesNeutral: 140,
    repliesAutoReply: 2201,
    repliesDetail: {
      interested: 240,
      meetingBooked: 61,
      closed: 17,
      notInterested: 902,
      wrongPerson: 44,
      unsubscribe: 211,
      neutral: 140,
      autoReply: 2201,
      outOfOffice: 388,
    },
  },
  repliesDetail: {
    interested: 240,
    meetingBooked: 61,
    closed: 17,
    notInterested: 902,
    wrongPerson: 44,
    unsubscribe: 211,
    neutral: 140,
    autoReply: 2201,
    outOfOffice: 388,
  },
  buffered: 4820,
  skipped: 47210,
  claimed: 1204,
};

describe("GET /v1/leads/stats — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(UPSTREAM_BODY) };
    });
  });

  it("forwards to lead-service's real path, carrying the resolved org identity", async () => {
    const res = await request(buildApp()).get("/v1/leads/stats?brandId=brand-1");

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${LEAD_BASE}/orgs/stats?brandId=brand-1`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["X-API-Key"]).toBe("lead-test-key");
  });

  it("returns lead-service's counts unchanged, and no leads", async () => {
    const res = await request(buildApp()).get("/v1/leads/stats?brandId=brand-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM_BODY);
    // The whole reason the route exists: a count comes back, a lead list does not.
    expect(res.body.leads).toBeUndefined();
    expect(JSON.stringify(res.body).length).toBeLessThan(2000);
  });

  it("forwards the caller's query verbatim, including filters this gateway never declared", async () => {
    await request(buildApp()).get(
      "/v1/leads/stats?brandId=brand-1&groupBy=campaignId&status=skipped&audienceId=aud-9",
    );

    expect(calls[0].url).toBe(
      `${LEAD_BASE}/orgs/stats?brandId=brand-1&groupBy=campaignId&status=skipped&audienceId=aud-9`,
    );
  });

  it("sends no query string at all when the caller sent none", async () => {
    await request(buildApp()).get("/v1/leads/stats");

    expect(calls[0].url).toBe(`${LEAD_BASE}/orgs/stats`);
  });

  it("ignores a caller-supplied org — only the authenticated org reaches lead-service", async () => {
    const res = await request(buildApp())
      .get("/v1/leads/stats?brandId=brand-1")
      .set("x-org-id", "someone-elses-org");

    expect(res.status).toBe(200);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("propagates an upstream failure with its status AND its body intact", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(JSON.stringify({ error: "unknown groupBy dimension", code: "BAD_GROUP_BY" })),
        json: () => Promise.resolve({}),
      };
    });

    const res = await request(buildApp()).get("/v1/leads/stats?groupBy=nope");

    // Not flattened into { error: "<the whole JSON body>" } — the fields survive (CLAUDE.md #7).
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "unknown groupBy dimension", code: "BAD_GROUP_BY" });
  });

  it("leaves GET /v1/leads alone — it still pipes to /orgs/leads", async () => {
    // /leads/stats is registered before /leads/search and after /leads; a mount-order
    // slip that swallowed the list route would be silent otherwise. The list route
    // pipes rather than parses, so its stub needs a real body stream.
    const { Readable } = await import("node:stream");
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        body: Readable.toWeb(Readable.from([Buffer.from(JSON.stringify({ leads: [] }))])),
      };
    });

    await request(buildApp()).get("/v1/leads?brandId=brand-1");

    expect(calls[0].url).toBe(`${LEAD_BASE}/orgs/leads?brandId=brand-1`);
  });
});
