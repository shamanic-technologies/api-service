import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  return { BILLING_BASE };
});

/**
 * Staff operations a staff member's OWN key may call (owner rule 2026-10-12,
 * `mcp-first`): `requireStaffActor` admits a user key only when its user is staff
 * as client-service records them, never on anything the caller sends.
 * `authenticate` is stubbed to stand in for each identity; `requireStaffActor`
 * is the real one.
 */
const identity = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      Object.assign(req, { userId: "user-1", orgId: "org-target", runId: "run-1" }, identity.current);
      next();
    },
  };
});

import creditsRouter from "../../src/routes/credits.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", creditsRouter);
  return a;
}

const BODY = { amountCents: 5000, note: "Welcome", idempotencyKey: "grant-1" };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ granted: true }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("POST /v1/billing/credits/grant through a user key", () => {
  it("a STAFF user's key grants: forwarded to billing with the staff email and the authenticated org", async () => {
    identity.current = { authType: "user_key", userKeyScope: { isStaff: true, email: "Kevin@Distribute.you", memberships: [] } };
    const res = await request(app()).post("/v1/billing/credits/grant").send(BODY);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BILLING_BASE}/v1/credits/grant`);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org-target");
    expect(headers["x-email"]).toBe("kevin@distribute.you");
    expect(JSON.parse(init.body as string)).toEqual(BODY);
  });

  it("a CLIENT key is refused 403 staff_only and billing is never called", async () => {
    identity.current = { authType: "user_key", userKeyScope: { isStaff: false, email: "client@acme.com", memberships: [] } };
    const res = await request(app()).post("/v1/billing/credits/grant").set("x-email", "kevin@distribute.you").send(BODY);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("staff_only");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a scope claiming staff with a non-staff email is refused (the allowlist is re-checked)", async () => {
    identity.current = { authType: "user_key", userKeyScope: { isStaff: true, email: "client@acme.com", memberships: [] } };
    const res = await request(app()).post("/v1/billing/credits/grant").send(BODY);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the platform key still needs a staff x-email (unchanged requireStaff path)", async () => {
    identity.current = { authType: "admin", userKeyScope: undefined };
    const refused = await request(app()).post("/v1/billing/credits/grant").set("x-email", "client@acme.com").send(BODY);
    expect(refused.status).toBe(403);
    const ok = await request(app()).post("/v1/billing/credits/grant").set("x-email", "kevin@distribute.you").send(BODY);
    expect(ok.status).toBe(200);
  });

  it("the cross-org grants ledger stays requireStaff: a staff KEY cannot read it", async () => {
    identity.current = { authType: "user_key", userKeyScope: { isStaff: true, email: "kevin@distribute.you", memberships: [] } };
    const res = await request(app()).get("/v1/billing/credits/grants/all");
    expect([401, 403]).toContain(res.status);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
