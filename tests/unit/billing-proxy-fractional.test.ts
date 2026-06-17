import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallExternalService = vi.fn();

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
  externalServices: {
    billing: { url: "http://mock-billing", apiKey: "k" },
  },
}));

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.orgId = "org-test";
    req.userId = "user-test";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import express from "express";
import request from "supertest";
import billingRouter from "../../src/routes/billing.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(billingRouter);
  return app;
}

beforeEach(() => {
  mockCallExternalService.mockReset();
});

describe("billing proxy — passthrough contract", () => {
  const brandId = "11111111-1111-4111-8111-111111111111";

  it("GET /billing/accounts/balance forwards upstream body unchanged", async () => {
    const upstream = { available_cents: "100.4200000000", depleted: false };
    mockCallExternalService.mockResolvedValue(upstream);

    const res = await request(createApp()).get("/billing/accounts/balance");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(typeof res.body.available_cents).toBe("string");
  });

  it("GET /billing/accounts forwards decimal-string fields untouched", async () => {
    const upstream = {
      id: "acc_1",
      org_id: "org-test",
      balance_cents: "12345.6789012345",
      usage_cents: "2345.6789012345",
      available_cents: "10000.0000000000",
      has_auto_topup: true,
      has_payment_method: true,
      topup_amount_cents: 500000,
      topup_threshold_cents: 100,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    mockCallExternalService.mockResolvedValue(upstream);

    const res = await request(createApp()).get("/billing/accounts");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(typeof res.body.balance_cents).toBe("string");
    expect(typeof res.body.usage_cents).toBe("string");
    expect(typeof res.body.available_cents).toBe("string");
  });

  it("GET /billing/accounts handles null topup fields", async () => {
    const upstream = {
      id: "acc_2",
      org_id: "org-test",
      balance_cents: "0.0000000000",
      usage_cents: "0.0000000000",
      available_cents: "0.0000000000",
      has_auto_topup: false,
      has_payment_method: false,
      topup_amount_cents: null,
      topup_threshold_cents: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    mockCallExternalService.mockResolvedValue(upstream);

    const res = await request(createApp()).get("/billing/accounts");

    expect(res.status).toBe(200);
    expect(res.body.topup_amount_cents).toBeNull();
    expect(res.body.topup_threshold_cents).toBeNull();
  });

  it("PATCH /billing/accounts/auto_topup forwards body byte-identical to /v1/accounts/auto_topup", async () => {
    const upstream = {
      id: "acc_3",
      org_id: "org-test",
      balance_cents: "100.0000000000",
      usage_cents: "10.0000000000",
      available_cents: "90.0000000000",
      has_auto_topup: true,
      has_payment_method: true,
      topup_amount_cents: 1000,
      topup_threshold_cents: 50,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    mockCallExternalService.mockResolvedValue(upstream);

    const reqBody = {
      topup_amount_cents: 1000,
      topup_threshold_cents: 50,
    };
    const res = await request(createApp())
      .patch("/billing/accounts/auto_topup")
      .send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    const [service, downstreamPath, opts] = mockCallExternalService.mock.calls[0] as [
      unknown,
      string,
      { method?: string; body?: unknown },
    ];
    expect(service).toEqual({ url: "http://mock-billing", apiKey: "k" });
    expect(downstreamPath).toBe("/v1/accounts/auto_topup");
    expect(opts?.method).toBe("PATCH");
    expect(opts?.body).toEqual(reqBody);
  });

  it("PATCH /billing/accounts/auto_topup rejects missing threshold before downstream", async () => {
    const res = await request(createApp())
      .patch("/billing/accounts/auto_topup")
      .send({ topup_amount_cents: 1000 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Missing required fields: topup_threshold_cents",
      missingFields: ["topup_threshold_cents"],
    });
    expect(mockCallExternalService).not.toHaveBeenCalled();
  });

  it("DELETE /billing/accounts/auto_topup forwards to /v1/accounts/auto_topup", async () => {
    const upstream = {
      id: "acc_4",
      org_id: "org-test",
      balance_cents: "0.0000000000",
      usage_cents: "0.0000000000",
      available_cents: "0.0000000000",
      has_auto_topup: false,
      has_payment_method: true,
      topup_amount_cents: null,
      topup_threshold_cents: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    mockCallExternalService.mockResolvedValue(upstream);

    const res = await request(createApp()).delete("/billing/accounts/auto_topup");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    const [, downstreamPath, opts] = mockCallExternalService.mock.calls[0] as [
      unknown,
      string,
      { method?: string },
    ];
    expect(downstreamPath).toBe("/v1/accounts/auto_topup");
    expect(opts?.method).toBe("DELETE");
  });

  it("POST /billing/checkout-sessions forwards setup mode without topup amount", async () => {
    const upstream = { url: "https://stripe.example/setup" };
    mockCallExternalService.mockResolvedValue(upstream);
    const reqBody = {
      success_url: "https://example.com/success",
      cancel_url: "https://example.com/cancel",
      mode: "setup",
    };

    const res = await request(createApp())
      .post("/billing/checkout-sessions")
      .send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    const [service, downstreamPath, opts] = mockCallExternalService.mock.calls[0] as [
      unknown,
      string,
      { method?: string; body?: unknown; headers?: Record<string, string> },
    ];
    expect(service).toEqual({ url: "http://mock-billing", apiKey: "k" });
    expect(downstreamPath).toBe("/v1/checkout-sessions");
    expect(opts?.method).toBe("POST");
    expect(opts?.body).toEqual(reqBody);
    expect(opts?.headers).toMatchObject({
      "x-org-id": "org-test",
      "x-user-id": "user-test",
    });
  });

  it("POST /billing/checkout-sessions still rejects payment checkout without topup amount", async () => {
    const res = await request(createApp())
      .post("/billing/checkout-sessions")
      .send({ success_url: "https://example.com/success", cancel_url: "https://example.com/cancel" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Missing required fields: topup_amount_cents",
      missingFields: ["topup_amount_cents"],
    });
    expect(mockCallExternalService).not.toHaveBeenCalled();
  });

  it("POST /billing/accounts/wallet_setup forwards body byte-identical to /v1/accounts/wallet_setup", async () => {
    const upstream = {
      wallet_setup_complete: true,
      checkout_required: false,
    };
    mockCallExternalService.mockResolvedValue(upstream);
    const reqBody = {
      initial_load_amount_cents: 50000,
      topup_amount_cents: 25000,
      topup_threshold_cents: 10000,
    };

    const res = await request(createApp())
      .post("/billing/accounts/wallet_setup")
      .send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    const [service, downstreamPath, opts] = mockCallExternalService.mock.calls[0] as [
      unknown,
      string,
      { method?: string; body?: unknown; headers?: Record<string, string> },
    ];
    expect(service).toEqual({ url: "http://mock-billing", apiKey: "k" });
    expect(downstreamPath).toBe("/v1/accounts/wallet_setup");
    expect(opts?.method).toBe("POST");
    expect(opts?.body).toEqual(reqBody);
    expect(opts?.headers).toMatchObject({
      "x-org-id": "org-test",
      "x-user-id": "user-test",
    });
  });

  it("PATCH /brands/:brandId/daily-budget forwards body and identity headers", async () => {
    const upstream = {
      brandId,
      orgId: "org-test",
      dailyBudgetCents: "2500.0000000000",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const reqBody = { dailyBudgetCents: "2500.0000000000" };
    mockCallExternalService.mockResolvedValue(upstream);

    const res = await request(createApp())
      .patch(`/brands/${brandId}/daily-budget`)
      .send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    const [service, actualPath, opts] = mockCallExternalService.mock.calls[0] as [
      unknown,
      string,
      { method?: string; body?: unknown; headers?: Record<string, string> },
    ];
    expect(service).toEqual({ url: "http://mock-billing", apiKey: "k" });
    expect(actualPath).toBe(`/v1/brands/${brandId}/daily-budget`);
    expect(opts?.method).toBe("PATCH");
    expect(opts?.body).toEqual(reqBody);
    expect(opts?.headers).toMatchObject({
      "x-org-id": "org-test",
      "x-user-id": "user-test",
    });
  });

  it("PATCH /brands/:brandId/daily-budget rejects invalid brand ID before downstream", async () => {
    const res = await request(createApp())
      .patch("/brands/not-a-uuid/daily-budget")
      .send({ dailyBudgetCents: 2500 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid brand ID — expected a UUID" });
    expect(mockCallExternalService).not.toHaveBeenCalled();
  });

  it("PATCH /brands/:brandId/daily-budget rejects missing amount before downstream", async () => {
    const res = await request(createApp())
      .patch(`/brands/${brandId}/daily-budget`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Missing required fields: dailyBudgetCents",
      missingFields: ["dailyBudgetCents"],
    });
    expect(mockCallExternalService).not.toHaveBeenCalled();
  });

  it.each([
    ["post", `/brands/${brandId}/subscription`],
    ["patch", `/brands/${brandId}/subscription`],
    ["post", `/brands/${brandId}/subscription/pause`],
    ["post", `/brands/${brandId}/subscription/resume`],
  ] as const)("does not expose %s %s", async (httpMethod, gatewayPath) => {
    const res = await request(createApp())[httpMethod](gatewayPath).send({ dailyAmountCents: 2500 });

    expect(res.status).toBe(404);
    expect(mockCallExternalService).not.toHaveBeenCalled();
  });
});
