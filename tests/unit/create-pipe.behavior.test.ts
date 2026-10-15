import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { FEATURES_BASE };
});

/**
 * POST /v1/catalogue/pipes → features-service POST /internal/catalogue/pipes, and the catalogue
 * reads opened to a staff member's own key (the distribute MCP). Staff only through the REAL
 * `requireStaffActor` / `requireStaff`; only `authenticateUser` is stubbed to stand in for each
 * identity. `createdBy` is the authenticated staff email, never the body's.
 */
const identity = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  return {
    ...actual,
    authenticateUser: (req: any, _res: any, next: any) => {
      Object.assign(req, { userId: "user-1", runId: "run-1" }, identity.current);
      next();
    },
  };
});

import router from "../../src/routes/catalogue-staff.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(router);
  return a;
}

const STAFF_KEY = { authType: "user_key", userKeyScope: { isStaff: true, email: "Kevin@Distribute.you", memberships: [] } };
const CLIENT_KEY = { authType: "user_key", userKeyScope: { isStaff: false, email: "client@acme.com", memberships: [] } };
const BODY = { channelSlug: "ai-instant-call", fromStep: "form_submitted", toStep: "booking_call", mode: "reactive", triggerId: "form-submitted", requestedByOrgId: "org-1" };
const RAW = '{"object":"pipe","id":"ai-instant-call|form_submitted_to_booking_call","someNewField":true}';

let calls: Array<{ url: string; init: any }>;
function upstream(status: number, raw: string) {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(raw, { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => upstream(201, RAW));

describe("POST /v1/catalogue/pipes", () => {
  it("a STAFF key creates it: exact path, body verbatim, createdBy = the staff email, 201 + bytes back", async () => {
    identity.current = STAFF_KEY;
    const res = await request(app())
      .post("/v1/catalogue/pipes")
      .set("authorization", "Bearer distrib.usr_x")
      .send({ ...BODY, createdBy: "someone-else@evil.com" });
    expect(res.status).toBe(201);
    expect(res.text).toBe(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/pipes`);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ ...BODY, createdBy: "kevin@distribute.you" });
  });

  it("a CLIENT key is refused 403 staff_only; features-service never called", async () => {
    identity.current = CLIENT_KEY;
    const res = await request(app()).post("/v1/catalogue/pipes").set("x-email", "kevin@distribute.you").send(BODY);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("staff_only");
    expect(calls).toHaveLength(0);
  });

  it("the platform key needs a staff x-email", async () => {
    identity.current = { authType: "admin", userKeyScope: undefined };
    const refused = await request(app()).post("/v1/catalogue/pipes").set("x-email", "client@acme.com").send(BODY);
    expect(refused.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("features-service's 409 leg_exists passes through verbatim", async () => {
    identity.current = STAFF_KEY;
    upstream(409, '{"error":"ai-instant-call already performs form_submitted_to_booking_call","reason":"leg_exists"}');
    const res = await request(app()).post("/v1/catalogue/pipes").send(BODY);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "ai-instant-call already performs form_submitted_to_booking_call", reason: "leg_exists" });
  });
});

describe("POST /v1/catalogue/sales-funnels", () => {
  const FUNNEL = { pipeIds: ["ai-instant-call|form_submitted_to_booking_call", "your-team-closing-calls|booking_call_to_paid_client"] };

  it("a STAFF key declares it: exact path, createdBy = the staff email, the producer's 200 (already declared) back", async () => {
    identity.current = STAFF_KEY;
    upstream(200, '{"created":false,"id":"f1"}');
    const res = await request(app()).post("/v1/catalogue/sales-funnels").send({ ...FUNNEL, createdBy: "x@evil.com" });
    expect(res.status).toBe(200);
    expect(res.text).toBe('{"created":false,"id":"f1"}');
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/sales-funnels`);
    expect(JSON.parse(calls[0].init.body)).toEqual({ ...FUNNEL, createdBy: "kevin@distribute.you" });
  });

  it("a CLIENT key is refused 403 staff_only; features-service never called", async () => {
    identity.current = CLIENT_KEY;
    const res = await request(app()).post("/v1/catalogue/sales-funnels").send(FUNNEL);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe("GET /v1/catalogue/pipes/:id with a person's own key", () => {
  const PIPE = "ai-instant-call|form_submitted_to_booking_call";

  it("a STAFF key reads it back: exact encoded path, bytes back", async () => {
    identity.current = STAFF_KEY;
    upstream(200, RAW);
    const res = await request(app()).get(`/v1/catalogue/pipes/${encodeURIComponent(PIPE)}`).set("authorization", "Bearer distrib.usr_x");
    expect(res.status).toBe(200);
    expect(res.text).toBe(RAW);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/pipes/${encodeURIComponent(PIPE)}`);
  });

  it("a CLIENT key is refused 403 staff_only", async () => {
    identity.current = CLIENT_KEY;
    const res = await request(app()).get("/v1/catalogue/triggers").set("authorization", "Bearer distrib.usr_x");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("staff_only");
    expect(calls).toHaveLength(0);
  });

  it("the dashboard path is unchanged: platform key + staff x-email reads, a wrong key is 401", async () => {
    upstream(200, RAW);
    const ok = await request(app()).get("/v1/catalogue/channels?q=call").set("x-api-key", "platform-test-key").set("x-email", "kevin@distribute.you");
    expect(ok.status).toBe(200);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/channels?q=call`);
    const bad = await request(app()).get("/v1/catalogue/channels").set("x-api-key", "nope");
    expect(bad.status).toBe(401);
  });
});
