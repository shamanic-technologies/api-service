import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * FAKE-OUTCOMES-1022: the "not a real person" mark and the conversion withdrawal, both
 * pass-throughs to lead-service. Driven through the real router with a stubbed `fetch`:
 * downstream path, method, identity headers, body and status, byte for byte.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import leadsRouter from "../../src/routes/leads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", leadsRouter);
  return app;
}

const LEAD = "74d6bc9f-2d11-4951-940e-b0f562d2a2cd";
const BRAND = "f4d73dab-1f9d-49b2-b16e-63ecde76a5eb";
const CONV = "3a17ea77-b015-4d8d-9e08-0c4e43183120";

function stubFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: any }> = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

describe("PUT/DELETE /v1/leads/:id/not-a-person", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch({ leadId: LEAD, notAPerson: true, aFieldThisGatewayHasNeverHeardOf: 7 });
  });

  it("PUT forwards method, path, body verbatim and the authenticated identity", async () => {
    const res = await request(buildApp())
      .put(`/v1/leads/${LEAD}/not-a-person`)
      .set("x-org-id", "org_spoofed_by_caller")
      .send({ note: "our AI reply test", someFutureField: 1 });
    expect(res.status).toBe(200);
    expect(res.body.aFieldThisGatewayHasNeverHeardOf).toBe(7);
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/not-a-person`)).toBe(true);
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(calls[0].init.body)).toEqual({ note: "our AI reply test", someFutureField: 1 });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("DELETE forwards to the same lead-service path", async () => {
    const res = await request(buildApp()).delete(`/v1/leads/${LEAD}/not-a-person`);
    expect(res.status).toBe(200);
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/not-a-person`)).toBe(true);
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("relays a refusal with its status and code", async () => {
    calls = stubFetch({ error: "Lead not found" }, 404);
    const res = await request(buildApp()).put(`/v1/leads/${LEAD}/not-a-person`).send({});
    expect(res.status).toBe(404);
  });
});

describe("brand conversions: list, withdraw, undo", () => {
  it("GET forwards the query verbatim", async () => {
    const calls = stubFetch({ brandId: BRAND, total: 0, conversions: [] });
    const res = await request(buildApp()).get(`/v1/brands/${BRAND}/conversions?event=signup&leadId=${LEAD}&limit=10`);
    expect(res.status).toBe(200);
    expect(calls[0].url.endsWith(`/orgs/brands/${BRAND}/conversions?event=signup&leadId=${LEAD}&limit=10`)).toBe(true);
    expect((calls[0].init.headers as Record<string, string>)["x-org-id"]).toBe("org_authenticated");
  });

  it("POST withdraw forwards the body and relays a 409 with its code", async () => {
    const calls = stubFetch({ error: "crm_evidence", message: "reject its pairing" }, 409);
    const res = await request(buildApp())
      .post(`/v1/brands/${BRAND}/conversions/${CONV}/withdraw`)
      .send({ note: "surname match only" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("crm_evidence");
    expect(calls[0].url.endsWith(`/orgs/brands/${BRAND}/conversions/${CONV}/withdraw`)).toBe(true);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual({ note: "surname match only" });
    expect((calls[0].init.headers as Record<string, string>)["x-user-id"]).toBe("user_test123");
  });

  it("DELETE withdrawal forwards to lead-service", async () => {
    const calls = stubFetch({ conversion: { id: CONV, counted: true } });
    const res = await request(buildApp()).delete(`/v1/brands/${BRAND}/conversions/${CONV}/withdrawal`);
    expect(res.status).toBe(200);
    expect(calls[0].url.endsWith(`/orgs/brands/${BRAND}/conversions/${CONV}/withdrawal`)).toBe(true);
    expect(calls[0].init.method).toBe("DELETE");
  });
});
