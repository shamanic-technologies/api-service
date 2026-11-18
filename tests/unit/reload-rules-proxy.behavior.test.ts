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
 * GET /v1/billing/accounts/reload_rules → billing-service GET /v1/accounts/reload_rules
 * (RELOAD-RULE-ONE-HOME-1118: billing is the one home of the reload figures).
 * Body and status forwarded verbatim; no shape asserted beyond identity (rule #6).
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      Object.assign(req, { userId: "user-1", orgId: "org-target", runId: "run-1", authType: "user_key" });
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

let fetchMock: ReturnType<typeof vi.fn>;
function upstream(status: number, body: unknown) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
}

const ANSWER = { org_id: "org-target", some_field: 1 };
beforeEach(() => upstream(200, ANSWER));

describe("GET /v1/billing/accounts/reload_rules", () => {
  it("forwards to billing with the org identity, answer verbatim", async () => {
    const res = await request(app()).get("/v1/billing/accounts/reload_rules");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(ANSWER);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BILLING_BASE}/v1/accounts/reload_rules`);
    expect((init.headers as Record<string, string>)["x-org-id"]).toBe("org-target");
  });

  it("billing's refusal passes through verbatim", async () => {
    const refusal = { error: "boom", code: "x" };
    upstream(502, refusal);
    const res = await request(app()).get("/v1/billing/accounts/reload_rules");
    expect(res.status).toBe(502);
    expect(res.body).toEqual(refusal);
  });
});
