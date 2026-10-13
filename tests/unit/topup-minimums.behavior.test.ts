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
 * GET/PUT /v1/billing/accounts/topup_minimums → billing-service
 * /v1/accounts/topup_minimums. GET: any org member. PUT: staff only
 * (`requireStaffActor`, real), with the staff email forwarded as x-email.
 * `authenticate` is stubbed to stand in for each identity.
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

import billingRouter from "../../src/routes/billing.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", billingRouter);
  return a;
}

const STAFF_KEY = { authType: "user_key", userKeyScope: { isStaff: true, email: "Kevin@Distribute.you", memberships: [] } };
const CLIENT_KEY = { authType: "user_key", userKeyScope: { isStaff: false, email: "client@acme.com", memberships: [] } };
const ANSWER = { org_id: "org-target", topup_minimum_cents: 1000, topup_minimum_source: "account" };

let fetchMock: ReturnType<typeof vi.fn>;
function upstream(status: number, body: unknown) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => upstream(200, ANSWER));

describe("PUT /v1/billing/accounts/topup_minimums", () => {
  it("a STAFF key sets: forwarded byte-identical with the staff email and the authenticated org", async () => {
    identity.current = STAFF_KEY;
    const body = { topup_minimum_cents: 1000, reload_threshold_minimum_cents: 1000 };
    const res = await request(app()).put("/v1/billing/accounts/topup_minimums").send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(ANSWER);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BILLING_BASE}/v1/accounts/topup_minimums`);
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org-target");
    expect(headers["x-email"]).toBe("kevin@distribute.you");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("a CLIENT key is refused 403 staff_only, even claiming a staff x-email; billing never called", async () => {
    identity.current = CLIENT_KEY;
    const res = await request(app())
      .put("/v1/billing/accounts/topup_minimums")
      .set("x-email", "kevin@distribute.you")
      .send({ topup_minimum_cents: 0 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("staff_only");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the platform key needs a staff x-email, and forwards that one", async () => {
    identity.current = { authType: "admin", userKeyScope: undefined };
    const refused = await request(app()).put("/v1/billing/accounts/topup_minimums").set("x-email", "client@acme.com").send({});
    expect(refused.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    const ok = await request(app()).put("/v1/billing/accounts/topup_minimums").set("x-email", "kevin@distribute.you").send({});
    expect(ok.status).toBe(200);
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["x-email"]).toBe("kevin@distribute.you");
  });

  it("billing's 400 passes through with its code and minimum_cents", async () => {
    identity.current = STAFF_KEY;
    const refusal = { error: "below minimum", code: "topup_below_minimum", minimum_cents: 500 };
    upstream(400, refusal);
    const res = await request(app()).put("/v1/billing/accounts/topup_minimums").send({ topup_minimum_cents: -1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(refusal);
  });
});

describe("GET /v1/billing/accounts/topup_minimums", () => {
  it("a CLIENT key reads its own org's minimums", async () => {
    identity.current = CLIENT_KEY;
    const res = await request(app()).get("/v1/billing/accounts/topup_minimums");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(ANSWER);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BILLING_BASE}/v1/accounts/topup_minimums`);
    expect((init.headers as Record<string, string>)["x-org-id"]).toBe("org-target");
  });

  it("billing's 404 account_not_found passes through verbatim", async () => {
    identity.current = CLIENT_KEY;
    const notFound = { error: "No billing account", code: "account_not_found" };
    upstream(404, notFound);
    const res = await request(app()).get("/v1/billing/accounts/topup_minimums");
    expect(res.status).toBe(404);
    expect(res.body).toEqual(notFound);
  });
});
