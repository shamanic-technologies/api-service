import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { BRAND_BASE } = vi.hoisted(() => {
  const BRAND_BASE = "http://brand.test.local";
  process.env.BRAND_SERVICE_URL = BRAND_BASE;
  process.env.BRAND_SERVICE_API_KEY = "brand-test-key";
  return { BRAND_BASE };
});

/**
 * The four sales-funnels proxies, driven over the wire.
 *
 * A source-substring test cannot see what actually goes downstream (CLAUDE.md #7
 * corollary 3), and three of this feature's acceptance criteria are about exactly
 * that: the full downstream path literal, the org identity being the AUTHENTICATED
 * one, and brand-service's body reaching the caller untouched — `declared`
 * included, because collapsing it turns "the brand has said nothing" into "the
 * brand sells through nothing", which is a lie about user data.
 *
 * Per CLAUDE.md #6/#8 the payloads below are fixtures, not a contract this repo
 * owns: what is asserted is the forwarded path, the forwarded identity, and
 * byte-identical bodies — never brand-service's field names as a shape.
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

import brandRouter from "../../src/routes/brand.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

const BRAND_ID = "7f1c2a3b-4d5e-4f60-8a91-b2c3d4e5f607";

// A brand that has stated a set of one, priced end to end.
const DECLARED_SET = {
  declared: true,
  funnels: [
    {
      funnelKey: "reply_meeting",
      name: "Positive reply → Meeting booked → Meeting attended → Paid client",
      steps: ["Positive reply", "Meeting booked", "Meeting attended", "Paid client"],
      goal: "booked_meetings",
      currentGoal: "meetingBooked",
      rates: {
        replyToMeetingPct: 30,
        meetingBookedToAttendedPct: 70,
        meetingToClosePct: 20,
      },
      lifetimeRevenueUsd: 4800,
      destinationUrl: null,
      bookingUrl: "https://cal.com/acme/intro",
      updatedAt: "2026-07-31T09:00:00.000Z",
    },
  ],
};

describe("GET /v1/brands/:id/sales-funnels — over the wire", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(DECLARED_SET) };
    }) as unknown as typeof fetch;
  });

  it("forwards to brand-service's real path, carrying the resolved org identity", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/sales-funnels`);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/sales-funnels`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["X-API-Key"]).toBe("brand-test-key");
  });

  it("returns brand-service's body unchanged", async () => {
    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/sales-funnels`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(DECLARED_SET);
  });

  it("keeps `declared: true` with an empty list distinct from `declared: false`", async () => {
    // The two answers a caller must never see collapsed: "sells through none"
    // and "has never said". Only the flag separates them, so it has to survive
    // the hop for both.
    for (const declared of [true, false]) {
      calls = [];
      global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
        calls.push({ url, options });
        return { ok: true, status: 200, json: () => Promise.resolve({ declared, funnels: [] }) };
      }) as unknown as typeof fetch;

      const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/sales-funnels`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ declared, funnels: [] });
      expect(res.body.declared).toBe(declared);
    }
  });

  it("ignores a caller-supplied org — only the authenticated org reaches brand-service", async () => {
    const res = await request(buildApp())
      .get(`/v1/brands/${BRAND_ID}/sales-funnels?orgId=someone-elses-org`)
      .set("x-org-id", "someone-elses-org");

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/sales-funnels`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("propagates brand-service's 403 for a brand outside the caller's org", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 403,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: "Brand does not belong to your organization", code: "FORBIDDEN" }),
          ),
        json: () => Promise.resolve({}),
      };
    }) as unknown as typeof fetch;

    const res = await request(buildApp()).get(`/v1/brands/${BRAND_ID}/sales-funnels`);

    // Refused exactly as the sibling sales-economics routes refuse it, with the
    // machine-readable fields intact rather than flattened (CLAUDE.md #7).
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "Brand does not belong to your organization",
      code: "FORBIDDEN",
    });
  });
});

describe("PUT /v1/brands/:id/sales-funnels — stating the whole set", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve(DECLARED_SET) };
    }) as unknown as typeof fetch;
  });

  it("forwards the set verbatim and returns the stated set unchanged", async () => {
    const res = await request(buildApp())
      .put(`/v1/brands/${BRAND_ID}/sales-funnels`)
      .send({ funnelKeys: ["reply_meeting"] });

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/sales-funnels`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual({ funnelKeys: ["reply_meeting"] });
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(res.body).toEqual(DECLARED_SET);
  });

  it("forwards an empty set — the only way to state 'we sell through none'", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve({ declared: true, funnels: [] }) };
    }) as unknown as typeof fetch;

    const res = await request(buildApp())
      .put(`/v1/brands/${BRAND_ID}/sales-funnels`)
      .send({ funnelKeys: [] });

    expect(res.status).toBe(200);
    // Not dropped as "empty body": an empty array is the statement.
    expect(JSON.parse(calls[0].options.body)).toEqual({ funnelKeys: [] });
    expect(res.body).toEqual({ declared: true, funnels: [] });
  });

  it("propagates brand-service's 400 with status and body intact", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: "visit_signup needs a website; this brand has none",
              code: "FUNNEL_REQUIRES_WEBSITE",
            }),
          ),
        json: () => Promise.resolve({}),
      };
    }) as unknown as typeof fetch;

    const res = await request(buildApp())
      .put(`/v1/brands/${BRAND_ID}/sales-funnels`)
      .send({ funnelKeys: ["visit_signup"] });

    // The gateway adds no validation of its own, so this 400 can only be
    // brand-service's — and it must arrive branchable, not stringified.
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "visit_signup needs a website; this brand has none",
      code: "FUNNEL_REQUIRES_WEBSITE",
    });
  });
});

describe("PUT /v1/brands/:id/sales-funnels/:funnelKey — declaring one funnel", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ funnel: DECLARED_SET.funnels[0] }),
      };
    }) as unknown as typeof fetch;
  });

  it("forwards the funnel key in the path and the economics verbatim", async () => {
    const body = {
      rates: { replyToMeetingPct: 30, meetingToClosePct: 20 },
      lifetimeRevenueUsd: 4800,
      bookingUrl: "https://cal.com/acme/intro",
    };

    const res = await request(buildApp())
      .put(`/v1/brands/${BRAND_ID}/sales-funnels/reply_meeting`)
      .send(body);

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/sales-funnels/reply_meeting`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(res.body).toEqual({ funnel: DECLARED_SET.funnels[0] });
  });

  it("forwards an explicit null rather than stripping it", async () => {
    // An omitted field leaves the stored value alone; an explicit null CLEARS it
    // back to never-declared. Stripping nulls here would make the second
    // impossible to express through the gateway.
    await request(buildApp())
      .put(`/v1/brands/${BRAND_ID}/sales-funnels/reply_meeting`)
      .send({ lifetimeRevenueUsd: null, bookingUrl: null });

    expect(JSON.parse(calls[0].options.body)).toEqual({
      lifetimeRevenueUsd: null,
      bookingUrl: null,
    });
  });

  it("forwards an empty body — declaring a funnel without pricing it yet", async () => {
    await request(buildApp()).put(`/v1/brands/${BRAND_ID}/sales-funnels/visit_form`).send({});

    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/sales-funnels/visit_form`);
    expect(JSON.parse(calls[0].options.body)).toEqual({});
  });

  it("propagates brand-service's 400 on a rate outside this funnel's chain", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: "visitToSignupPct is not a leg of reply_meeting",
              code: "RATE_NOT_IN_CHAIN",
            }),
          ),
        json: () => Promise.resolve({}),
      };
    }) as unknown as typeof fetch;

    const res = await request(buildApp())
      .put(`/v1/brands/${BRAND_ID}/sales-funnels/reply_meeting`)
      .send({ rates: { visitToSignupPct: 5 } });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "visitToSignupPct is not a leg of reply_meeting",
      code: "RATE_NOT_IN_CHAIN",
    });
  });

  it("sends an unknown funnel key downstream instead of rejecting it here", async () => {
    // No gateway re-validation: the catalogue is brand-service's, and a second
    // opinion on it would be a second source of truth for one 400.
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ error: "Unknown funnel key" })),
        json: () => Promise.resolve({}),
      };
    }) as unknown as typeof fetch;

    const res = await request(buildApp())
      .put(`/v1/brands/${BRAND_ID}/sales-funnels/not_a_funnel`)
      .send({});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/sales-funnels/not_a_funnel`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown funnel key" });
  });
});

describe("DELETE /v1/brands/:id/sales-funnels/:funnelKey — undeclaring one funnel", () => {
  let calls: Array<{ url: string; options: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: () => Promise.resolve({ declared: true, funnels: [] }) };
    }) as unknown as typeof fetch;
  });

  it("forwards to the funnel's own path and returns the set that is left", async () => {
    const res = await request(buildApp()).delete(
      `/v1/brands/${BRAND_ID}/sales-funnels/reply_meeting`,
    );

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${BRAND_BASE}/orgs/brands/${BRAND_ID}/sales-funnels/reply_meeting`);
    expect(calls[0].options.method).toBe("DELETE");
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    // Removing the last funnel leaves `declared: true` — the brand has stated it
    // sells through none, which is not the same as never having said.
    expect(res.body).toEqual({ declared: true, funnels: [] });
  });
});
