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

describe("billing proxy — passthrough contract", () => {
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
});
