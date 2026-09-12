import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { readFileSync } from "fs";
import { join } from "path";

// externalServices (src/lib/service-client.ts) snapshots *_SERVICE_URL at module load,
// so the base must be set BEFORE the router imports. vi.hoisted runs before imports.
const { BILLING_BASE, STRIPE_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  const STRIPE_BASE = "http://stripe.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  process.env.STRIPE_SERVICE_URL = STRIPE_BASE;
  process.env.STRIPE_SERVICE_API_KEY = "stripe-test-key";
  return { BILLING_BASE, STRIPE_BASE };
});

/**
 * The billing proxies forward a downstream REFUSAL field-for-field (CLAUDE.md #7).
 *
 * billing-service #437 makes POST /v1/portal-sessions answer 402 when an org with a
 * negative balance tries to change its card and the settle charge fails. That body is
 * machine-readable — `code: "outstanding_balance_unsettled"` plus `owed_cents`,
 * `balance_cents`, `reason` — and the dashboard branches on `code` and prints
 * `owed_cents`. The gateway used to rebuild `{ error: error.message }` around it, which
 * stringifies the WHOLE upstream body into one `error` field: status preserved, every
 * machine-readable field destroyed.
 *
 * A source-substring assertion cannot see what goes over the wire, so this file drives
 * the real router with supertest and a stubbed fetch. The payloads below are FIXTURES,
 * not a contract this repo owns (#6/#8) — what is asserted is that the object comes back
 * byte-identical under the upstream status, whatever its fields are.
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

import billingRouter from "../../src/routes/billing.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", billingRouter);
  return app;
}

const REFUSAL_402 = {
  error: "Settle the outstanding balance before changing your payment method",
  code: "outstanding_balance_unsettled",
  owed_cents: 4237,
  balance_cents: -4237,
  reason: "settle_charge_failed",
};

let calls: Array<{ url: string; options: any }>;

function stubUpstream(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
      json: () => Promise.resolve(body),
    };
  });
}

beforeEach(() => {
  calls = [];
});

describe("POST /v1/billing/portal-sessions — upstream refusal reaches the caller", () => {
  it("forwards billing's 402 status AND its body field-for-field", async () => {
    stubUpstream(402, REFUSAL_402);

    const res = await request(buildApp())
      .post("/v1/billing/portal-sessions")
      .send({ return_url: "https://app.distribute.you/billing" });

    expect(res.status).toBe(402);
    expect(res.body).toEqual(REFUSAL_402);
    // The whole point: the consumer can branch on `code` and render the amount.
    expect(res.body.code).toBe("outstanding_balance_unsettled");
    expect(res.body.owed_cents).toBe(4237);
    // …and the body was NOT flattened into a single stringified `error`.
    expect(res.body.error).toBe(REFUSAL_402.error);
  });

  it("still reaches billing's real path with the authenticated org", async () => {
    stubUpstream(402, REFUSAL_402);

    await request(buildApp()).post("/v1/billing/portal-sessions").send({ return_url: "x" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}/v1/portal-sessions`);
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("wraps a NON-JSON upstream body verbatim under the upstream status", async () => {
    stubUpstream(502, "<html>bad gateway</html>");

    const res = await request(buildApp()).post("/v1/billing/portal-sessions").send({});

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "<html>bad gateway</html>" });
  });
});

describe("the sibling billing proxies forward the upstream failure the same way", () => {
  const cases: Array<{ name: string; call: (app: express.Express) => request.Test }> = [
    {
      name: "GET /v1/billing/accounts",
      call: (app) => request(app).get("/v1/billing/accounts"),
    },
    {
      name: "GET /v1/billing/accounts/balance",
      call: (app) => request(app).get("/v1/billing/accounts/balance"),
    },
    {
      name: "PATCH /v1/billing/accounts/auto_topup",
      call: (app) =>
        request(app)
          .patch("/v1/billing/accounts/auto_topup")
          .send({ topup_amount_cents: 5000, topup_threshold_cents: 1000 }),
    },
    {
      name: "DELETE /v1/billing/accounts/auto_topup",
      call: (app) => request(app).delete("/v1/billing/accounts/auto_topup"),
    },
    {
      name: "POST /v1/billing/checkout-sessions",
      call: (app) =>
        request(app)
          .post("/v1/billing/checkout-sessions")
          .send({ ui_mode: "embedded", topup_amount_cents: 5000 }),
    },
    {
      name: "GET /v1/billing/payments",
      call: (app) => request(app).get("/v1/billing/payments"),
    },
  ];

  for (const { name, call } of cases) {
    it(`${name} re-emits the upstream status and object`, async () => {
      const body = { error: "nope", code: "SOME_DOWNSTREAM_CODE", details: { n: 1 } };
      stubUpstream(409, body);

      const res = await call(buildApp());

      expect(res.status).toBe(409);
      expect(res.body).toEqual(body);
    });
  }
});

describe("no route in billing.ts rebuilds its own error envelope", () => {
  it("has no res.status(...).json({ error: error.message }) left", () => {
    const source = readFileSync(join(process.cwd(), "src/routes/billing.ts"), "utf8");
    expect(source).not.toMatch(/error:\s*error\.message/);
    expect(source).not.toMatch(/error\.statusCode\s*\|\|\s*500/);
  });
});
