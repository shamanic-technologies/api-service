import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCallExternalService = vi.fn();

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: (...args: unknown[]) => mockCallExternalService(...args),
  callExternalServiceWithStatus: (...args: unknown[]) => mockCallExternalService(...args),
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

describe("billing proxy — fractional cents (decimal-string contract)", () => {
  it("GET /billing/accounts/balance returns decimal string balance_cents untouched", async () => {
    const upstream = { balance_cents: "100.4200000000", depleted: false };
    mockCallExternalService.mockResolvedValue(upstream);

    const res = await request(createApp()).get("/billing/accounts/balance");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(typeof res.body.balance_cents).toBe("string");
    expect(res.body.balance_cents).toBe("100.4200000000");
  });

  it("GET /billing/accounts returns decimal-string credit/reload fields untouched", async () => {
    const upstream = {
      id: "acc_1",
      orgId: "org-test",
      creditBalanceCents: "12345.6789012345",
      hasAutoReload: true,
      hasPaymentMethod: true,
      reloadAmountCents: "500000.0000000000",
      reloadThresholdCents: "100.0000000000",
      createdAt: "2026-01-01T00:00:00Z",
    };
    mockCallExternalService.mockResolvedValue(upstream);

    const res = await request(createApp()).get("/billing/accounts");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(typeof res.body.creditBalanceCents).toBe("string");
    expect(typeof res.body.reloadAmountCents).toBe("string");
    expect(typeof res.body.reloadThresholdCents).toBe("string");
  });

  it("GET /billing/accounts handles null reload fields", async () => {
    const upstream = {
      id: "acc_2",
      orgId: "org-test",
      creditBalanceCents: "0.0000000000",
      hasAutoReload: false,
      hasPaymentMethod: false,
      reloadAmountCents: null,
      reloadThresholdCents: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    mockCallExternalService.mockResolvedValue(upstream);

    const res = await request(createApp()).get("/billing/accounts");

    expect(res.status).toBe(200);
    expect(res.body.reloadAmountCents).toBeNull();
    expect(res.body.reloadThresholdCents).toBeNull();
  });

  it("POST /billing/credits/deduct forwards decimal-string amount_cents byte-identical", async () => {
    const upstream = { success: true, balance_cents: "99.5800000000", depleted: false };
    mockCallExternalService.mockResolvedValue(upstream);

    const reqBody = { amount_cents: "0.42", description: "test deduction" };
    const res = await request(createApp())
      .post("/billing/credits/deduct")
      .send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);

    // Inspect the call to service-client and assert the body forwarded as-is
    expect(mockCallExternalService).toHaveBeenCalled();
    const [, , opts] = mockCallExternalService.mock.calls[0] as [
      unknown,
      unknown,
      { method?: string; body?: unknown },
    ];
    expect(opts?.method).toBe("POST");
    expect(opts?.body).toEqual(reqBody);
    expect((opts?.body as any).amount_cents).toBe("0.42");
  });

  it("POST /billing/credits/deduct forwards integer amount_cents (legacy) byte-identical", async () => {
    const upstream = { success: true, balance_cents: "900.0000000000", depleted: false };
    mockCallExternalService.mockResolvedValue(upstream);

    const reqBody = { amount_cents: 100, description: "legacy integer call" };
    const res = await request(createApp())
      .post("/billing/credits/deduct")
      .send(reqBody);

    expect(res.status).toBe(200);
    const [, , opts] = mockCallExternalService.mock.calls[0] as [
      unknown,
      unknown,
      { body?: unknown },
    ];
    expect(opts?.body).toEqual(reqBody);
    expect((opts?.body as any).amount_cents).toBe(100);
    expect(typeof (opts?.body as any).amount_cents).toBe("number");
  });

  it("PATCH /billing/accounts/auto-reload forwards decimal-string fields untouched", async () => {
    const upstream = {
      id: "acc_3",
      orgId: "org-test",
      creditBalanceCents: "100.0000000000",
      hasAutoReload: true,
      hasPaymentMethod: true,
      reloadAmountCents: "1000.5000000000",
      reloadThresholdCents: "50.2500000000",
      createdAt: "2026-01-01T00:00:00Z",
    };
    mockCallExternalService.mockResolvedValue(upstream);

    const reqBody = {
      reload_amount_cents: "1000.5",
      reload_threshold_cents: "50.25",
    };
    const res = await request(createApp())
      .patch("/billing/accounts/auto-reload")
      .send(reqBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    const [, , opts] = mockCallExternalService.mock.calls[0] as [
      unknown,
      unknown,
      { body?: unknown },
    ];
    expect(opts?.body).toEqual(reqBody);
  });
});
