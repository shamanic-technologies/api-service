import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/leads/:id/answered-outside — pass-through to lead-service.
 * Driven through the real router with a stubbed `fetch`: downstream path, identity
 * headers, status and body byte for byte (CLAUDE.md rule #7, corollaries 2 and 3).
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

const LEAD = "44444444-4444-4444-4444-444444444444";
const RECORDED = JSON.stringify({
  statement: { id: "s1", leadId: LEAD, brandId: "b1", statedByUserId: "user_test123", statedAt: "2026-10-11T10:00:00.000Z" },
  awaitingReply: false,
  aFieldThisGatewayHasNeverHeardOf: 7,
});

function stubFetch(body: string, status = 201) {
  const calls: Array<{ url: string; init: any }> = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

describe("POST /v1/leads/:id/answered-outside", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch(RECORDED);
  });

  it("POSTs lead-service's exact path, query forwarded verbatim", async () => {
    const query = "?brandId=33333333-3333-3333-3333-333333333333&somethingNew=x%20y";
    await request(buildApp()).post(`/v1/leads/${LEAD}/answered-outside${query}`);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith(`/orgs/leads/${LEAD}/answered-outside${query}`)).toBe(true);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBeUndefined();
  });

  it("carries the AUTHENTICATED org and user, never the caller's", async () => {
    await request(buildApp())
      .post(`/v1/leads/${LEAD}/answered-outside`)
      .set("x-user-id", "user_spoofed")
      .set("x-org-id", "org_spoofed");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-org-id"]).toBe("org_authenticated");
  });

  it("returns lead-service's status and body untransformed", async () => {
    const res = await request(buildApp()).post(`/v1/leads/${LEAD}/answered-outside`);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(JSON.parse(RECORDED));
  });

  it("forwards a refusal with its own status and body", async () => {
    calls = stubFetch(JSON.stringify({ error: "id must be a uuid", code: "invalid_id" }), 400);
    const res = await request(buildApp()).post(`/v1/leads/not-a-uuid/answered-outside`);
    expect(calls[0].url.endsWith(`/orgs/leads/not-a-uuid/answered-outside`)).toBe(true);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "id must be a uuid", code: "invalid_id" });
  });

  it("does not collide with GET /v1/leads/awaiting-reply (reaches lead-service's literal route)", async () => {
    calls = stubFetch(JSON.stringify({ brandId: "b", total: 0, people: [] }), 200);
    const res = await request(buildApp()).get(`/v1/leads/awaiting-reply?brandId=b`);
    expect(calls[0].url.endsWith(`/orgs/leads/awaiting-reply?brandId=b`)).toBe(true);
    expect(calls[0].init.method ?? "GET").toBe("GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ brandId: "b", total: 0, people: [] });
  });
});
