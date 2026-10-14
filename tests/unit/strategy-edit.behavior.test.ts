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
 * PATCH /v1/strategies/:id → features-service PATCH /internal/catalogue/strategies/:id
 * (STRATEGY-EDIT-PUBLIC-1014). Staff only through the REAL `requireStaffActor` (a staff
 * key, or the platform key + staff x-email); only `authenticateUser` is stubbed to stand
 * in for each identity. `updatedBy` is the authenticated staff email, never the body's.
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

import router from "../../src/routes/plays.js";
import { buildDocument, STAFF_KEY_OPERATIONS } from "../../src/openapi/document.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(router);
  return a;
}

const STAFF_KEY = { authType: "user_key", userKeyScope: { isStaff: true, email: "Kevin@Distribute.you", memberships: [] } };
const CLIENT_KEY = { authType: "user_key", userKeyScope: { isStaff: false, email: "client@acme.com", memberships: [] } };
const ID = "valid catch-all/odd";
const RAW = '{"id":"valid-catch-all","excludes":["unknown-email"],"changed":true,"someNewField":true}';

let calls: Array<{ url: string; init: any }>;
function upstream(status: number, raw: string) {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(raw, { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => upstream(200, RAW));

describe("PATCH /v1/strategies/:id", () => {
  it("a STAFF key edits: id re-encoded, body verbatim, updatedBy = the staff email (body value overwritten), bytes back", async () => {
    identity.current = STAFF_KEY;
    const res = await request(app())
      .patch(`/v1/strategies/${encodeURIComponent(ID)}`)
      .send({ excludes: ["unknown-email"], someNewField: 1, updatedBy: "someone-else@evil.com" });
    expect(res.status).toBe(200);
    expect(res.text).toBe(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/strategies/valid%20catch-all%2Fodd`);
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init.body)).toEqual({ excludes: ["unknown-email"], someNewField: 1, updatedBy: "kevin@distribute.you" });
  });

  it("a CLIENT key is refused 403 staff_only; features-service never called", async () => {
    identity.current = CLIENT_KEY;
    const res = await request(app())
      .patch("/v1/strategies/valid-catch-all")
      .set("x-email", "kevin@distribute.you")
      .send({ excludes: ["unknown-email"] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("staff_only");
    expect(calls).toHaveLength(0);
  });

  it("the platform key needs a staff x-email", async () => {
    identity.current = { authType: "admin", userKeyScope: undefined };
    const refused = await request(app())
      .patch("/v1/strategies/valid-catch-all")
      .set("x-email", "client@acme.com")
      .send({ excludes: ["unknown-email"] });
    expect(refused.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("features-service's 409 passes through verbatim", async () => {
    identity.current = STAFF_KEY;
    upstream(409, '{"error":"strategy_rule_taken","reason":"strategy_rule_taken","existingStrategyId":"x"}');
    const res = await request(app()).patch("/v1/strategies/valid-catch-all").send({ excludes: [] });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "strategy_rule_taken", reason: "strategy_rule_taken", existingStrategyId: "x" });
  });

  it("is a staff-key operation: absent from the public document, present for a staff key, never documents updatedBy", () => {
    expect(STAFF_KEY_OPERATIONS.has("PATCH /v1/strategies/{id}")).toBe(true);
    const pub = buildDocument() as any;
    expect(pub.paths["/v1/strategies/{id}"].patch).toBeUndefined();
    expect(pub.paths["/v1/strategies/{id}"].get).toBeDefined();
    const staff = buildDocument({ audience: "staff-key" }) as any;
    const op = staff.paths["/v1/strategies/{id}"].patch;
    expect(op["x-staff-only"]).toBe(true);
    expect(JSON.stringify(op.requestBody)).not.toContain("updatedBy");
  });
});
