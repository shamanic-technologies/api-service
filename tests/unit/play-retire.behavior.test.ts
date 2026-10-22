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
 * POST /v1/catalogue/plays/:playId/retire → features-service
 * POST /internal/catalogue/plays/{id}/retire. Staff only through the REAL
 * `requireStaffActor`; only `authenticateUser` is stubbed per identity. `retiredBy`
 * is the authenticated staff email, never the body's. Status + body byte-for-byte.
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
const PLAY = "sales-cold-email-outreach|lead_found_to_conversation~valid-only";
const URL_PATH = `/v1/catalogue/plays/${encodeURIComponent(PLAY)}/retire`;
const RAW =
  '{"changed":true,"retiredPlayId":"sales-cold-email-outreach|lead_found_to_conversation~valid-only","retiredAt":"2026-10-22T10:00:00.000Z","runsNow":"sales-cold-email-outreach|lead_found_to_conversation~default"}';

let calls: Array<{ url: string; init: any }>;
function upstream(status: number, raw: string) {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(raw, { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => upstream(200, RAW));

describe("POST /v1/catalogue/plays/:playId/retire", () => {
  it("a STAFF key retires it: exact encoded path, retiredBy = the staff email (body value replaced), bytes back", async () => {
    identity.current = STAFF_KEY;
    const res = await request(app()).post(URL_PATH).send({ note: "lead sourcing picks emails", retiredBy: "someone-else@evil.com" });
    expect(res.status).toBe(200);
    expect(res.text).toBe(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${FEATURES_BASE}/internal/catalogue/plays/sales-cold-email-outreach%7Clead_found_to_conversation~valid-only/retire`,
    );
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ note: "lead sourcing picks emails", retiredBy: "kevin@distribute.you" });
  });

  it("an empty body still records the staff author", async () => {
    identity.current = STAFF_KEY;
    await request(app()).post(URL_PATH);
    expect(JSON.parse(calls[0].init.body)).toEqual({ retiredBy: "kevin@distribute.you" });
  });

  it("a CLIENT key is refused 403 staff_only; features-service never called", async () => {
    identity.current = CLIENT_KEY;
    const res = await request(app()).post(URL_PATH).set("x-email", "kevin@distribute.you").send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("staff_only");
    expect(calls).toHaveLength(0);
  });

  it("the platform key needs a staff x-email", async () => {
    identity.current = { authType: "admin", userKeyScope: undefined };
    const refused = await request(app()).post(URL_PATH).set("x-email", "client@acme.com").send({});
    expect(refused.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [409, '{"error":"default_play_not_retirable"}'],
    [404, '{"error":"play_not_found"}'],
    [404, '{"error":"pipe_not_found"}'],
    [400, '{"error":"note_invalid"}'],
  ])("features-service's %i passes through verbatim", async (status, raw) => {
    identity.current = STAFF_KEY;
    upstream(status, raw);
    const res = await request(app()).post(URL_PATH).send({});
    expect(res.status).toBe(status);
    expect(res.text).toBe(raw);
  });
});
