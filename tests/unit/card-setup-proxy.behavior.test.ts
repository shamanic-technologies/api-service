import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  },
  authenticatePlatform: (req: any, _res: any, next: any) => {
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  requireStaff: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import billingRouter from "../../src/routes/billing.js";

const CARD_SETUP = "/v1/billing/accounts/card_setup";
const SAVED = "/v1/billing/accounts/saved_payment_method";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", billingRouter);
  return app;
}

describe("card-setup / saved-payment-method proxies", () => {
  let app: express.Express;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  function stubFetch(status: number, body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    capturedUrl = undefined;
    capturedInit = undefined;
  });

  describe("POST /v1/billing/accounts/card_setup", () => {
    it("forwards to the billing-service path with the caller's body byte-identical", async () => {
      stubFetch(200, { object: "card_setup", mode: "hosted_redirect", url: "https://acquirer.example/pay/abc" });
      const body = { return_url: "https://app.example/billing", currency: "eur", somethingBillingAddsLater: true };

      const res = await request(app).post(CARD_SETUP).send(body);

      expect(capturedUrl).toContain("/v1/accounts/card_setup");
      expect(capturedInit?.method).toBe("POST");
      expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
      expect(res.status).toBe(200);
    });

    it("returns the hosted-redirect descriptor unchanged", async () => {
      const descriptor = {
        object: "card_setup",
        mode: "hosted_redirect",
        url: "https://acquirer.example/pay/abc",
      };
      stubFetch(200, descriptor);

      const res = await request(app).post(CARD_SETUP).send({ return_url: "https://app.example/billing" });

      expect(res.body).toEqual(descriptor);
    });

    it("returns the embedded-widget descriptor unchanged, every field included", async () => {
      const descriptor = {
        object: "card_setup",
        mode: "embedded_widget",
        script_url: "https://acquirer.example/sdk.js",
        environment: "sandbox",
        token: "public-order-token-xyz",
        save_payment_method_for: "merchant",
      };
      stubFetch(200, descriptor);

      const res = await request(app).post(CARD_SETUP).send({ return_url: "https://app.example/billing" });

      expect(res.body).toEqual(descriptor);
    });

    it("carries no credential toward the downstream beyond the standard identity headers", async () => {
      stubFetch(200, { object: "card_setup", mode: "hosted_redirect", url: "https://acquirer.example/x" });

      await request(app)
        .post(CARD_SETUP)
        .set("x-org-id", "org_attacker")
        .set("x-user-id", "user_attacker")
        .send({ return_url: "https://app.example/billing" });

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["x-org-id"]).toBe("org_test456");
      expect(headers["x-user-id"]).toBe("user_test123");
      expect(headers["x-run-id"]).toBe("run_test789");
    });

    it("propagates a downstream refusal with its own status and whole body", async () => {
      stubFetch(400, { error: "return_url: Invalid url", code: "INVALID_RETURN_URL" });

      const res = await request(app).post(CARD_SETUP).send({ return_url: "not-a-url" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "return_url: Invalid url", code: "INVALID_RETURN_URL" });
    });

    it("propagates a 502 rather than masking it as a gateway error", async () => {
      stubFetch(502, { error: "Failed to start card setup" });

      const res = await request(app).post(CARD_SETUP).send({ return_url: "https://app.example/billing" });

      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: "Failed to start card setup" });
    });
  });

  describe("GET /v1/billing/accounts/saved_payment_method", () => {
    it("forwards to the billing-service path with no body", async () => {
      stubFetch(200, { object: "saved_payment_method", org_id: "org_test456", acquirer: "stripe", saved: false, method: null });

      const res = await request(app).get(SAVED);

      expect(capturedUrl).toContain("/v1/accounts/saved_payment_method");
      expect(capturedInit?.method ?? "GET").toBe("GET");
      expect(capturedInit?.body).toBeUndefined();
      expect(res.status).toBe(200);
    });

    it("returns a saved card unchanged", async () => {
      const answer = {
        object: "saved_payment_method",
        org_id: "org_test456",
        acquirer: "stripe",
        saved: true,
        method: { id: "pm_123", type: "card", saved_for: "merchant" },
      };
      stubFetch(200, answer);

      const res = await request(app).get(SAVED);

      expect(res.body).toEqual(answer);
    });

    it("keeps 'the acquirer answered, there is none' a 200 carrying its reason", async () => {
      const answer = {
        object: "saved_payment_method",
        org_id: "org_test456",
        acquirer: "revolut",
        saved: false,
        method: null,
        reason: "no_card_on_file",
      };
      stubFetch(200, answer);

      const res = await request(app).get(SAVED);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(answer);
    });

    it("keeps 'we could not ask' a 502, distinct from 'no card saved'", async () => {
      stubFetch(502, { error: "Could not confirm whether a card is saved" });

      const res = await request(app).get(SAVED);

      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: "Could not confirm whether a card is saved" });
      expect(res.body).not.toHaveProperty("saved");
    });

    it("forwards the authenticated identity, not caller-supplied headers", async () => {
      stubFetch(200, { object: "saved_payment_method", org_id: "org_test456", acquirer: "stripe", saved: false, method: null });

      await request(app).get(SAVED).set("x-org-id", "org_attacker").set("x-user-id", "user_attacker");

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["x-org-id"]).toBe("org_test456");
      expect(headers["x-user-id"]).toBe("user_test123");
    });
  });

  it("does not swallow the sibling literal routes on the same prefix", async () => {
    stubFetch(200, { id: "acct_1" });

    await request(app).get("/v1/billing/accounts/balance");
    expect(capturedUrl).toContain("/v1/accounts/balance");

    await request(app).get("/v1/billing/accounts");
    expect(capturedUrl).toContain("/v1/accounts");
  });
});
