import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { FEATURES_BASE };
});

/**
 * PUT /v1/catalogue/pipes/:pipeId/default-play → features-service
 * PUT /internal/catalogue/pipes/{pipeId}/default-play. Staff only through the REAL
 * `requireStaffActor` (a staff key, or the platform key + staff x-email); only
 * `authenticateUser` is stubbed to stand in for each identity. `decidedBy` is the
 * authenticated staff email, never the body's.
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
const PIPE = "sourcing-crm-contacts|start_to_lead_found";
const RAW = '{"pipeId":"sourcing-crm-contacts|start_to_lead_found","strategyId":"s1","someNewField":true}';

let calls: Array<{ url: string; init: any }>;
function upstream(status: number, raw: string) {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(raw, { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => upstream(200, RAW));

describe("PUT /v1/catalogue/pipes/:pipeId/default-play", () => {
  it("a STAFF key sets it: exact path, decidedBy = the staff email (body value ignored), bytes back", async () => {
    identity.current = STAFF_KEY;
    const res = await request(app())
      .put(`/v1/catalogue/pipes/${encodeURIComponent(PIPE)}/default-play`)
      .send({ strategyId: "s1", decidedBy: "someone-else@evil.com" });
    expect(res.status).toBe(200);
    expect(res.text).toBe(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/pipes/${encodeURIComponent(PIPE)}/default-play`);
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(calls[0].init.body)).toEqual({ strategyId: "s1", decidedBy: "kevin@distribute.you" });
  });

  it("a CLIENT key is refused 403 staff_only; features-service never called", async () => {
    identity.current = CLIENT_KEY;
    const res = await request(app())
      .put(`/v1/catalogue/pipes/${encodeURIComponent(PIPE)}/default-play`)
      .set("x-email", "kevin@distribute.you")
      .send({ strategyId: "s1" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("staff_only");
    expect(calls).toHaveLength(0);
  });

  it("the platform key needs a staff x-email", async () => {
    identity.current = { authType: "admin", userKeyScope: undefined };
    const refused = await request(app())
      .put(`/v1/catalogue/pipes/${encodeURIComponent(PIPE)}/default-play`)
      .set("x-email", "client@acme.com")
      .send({ strategyId: "s1" });
    expect(refused.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("features-service's 409 default_play_runs_nothing passes through verbatim", async () => {
    identity.current = STAFF_KEY;
    upstream(409, '{"error":"default_play_runs_nothing","detail":"no workflow"}');
    const res = await request(app())
      .put(`/v1/catalogue/pipes/${encodeURIComponent(PIPE)}/default-play`)
      .send({ strategyId: "s1" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "default_play_runs_nothing", detail: "no workflow" });
  });
});
