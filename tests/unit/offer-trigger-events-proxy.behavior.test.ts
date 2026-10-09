import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/offers/:offerId/trigger-events[/summary] — pass-through to campaign-service
 * GET /internal/offers/{offerId}/trigger-events[/summary].
 *
 * Driven through the real router with a stubbed `fetch`: asserts the full downstream path,
 * the authenticated org header, the verbatim query string and the relayed status + body.
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

import campaignsRouter from "../../src/routes/campaigns.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", campaignsRouter);
  return app;
}

const OFFER = "70051e12-bf19-4639-a54e-cf4f9c1df8dd";
const BRAND = "d0965c2c-a58f-4497-addd-6a19e556b068";

const SUMMARY_BODY = JSON.stringify({
  recordedSince: "2026-10-09T08:00:00.000Z",
  triggers: [{ triggerId: "positive_reply", events: 12, ran: 9, skipped: 3, somethingBrandNew: 42 }],
});
const LIST_BODY = JSON.stringify({ events: [{ id: "e1", triggerId: "positive_reply", outcome: "ran" }] });

function respond(status: number, body: string) {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("GET /v1/offers/:offerId/trigger-events[/summary] — pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return respond(200, url.includes("/summary") ? SUMMARY_BODY : LIST_BODY);
    });
  });

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("summary: forwards to /internal/offers/{offerId}/trigger-events/summary with the query verbatim", async () => {
    const query = `?brandId=${BRAND}&from=2026-10-01T00:00:00Z&to=2026-10-09T00:00:00Z&extra=a&extra=b`;
    const res = await request(buildApp()).get(`/v1/offers/${OFFER}/trigger-events/summary${query}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(SUMMARY_BODY));
    const { url } = upstream();
    expect(url.endsWith(`/internal/offers/${OFFER}/trigger-events/summary${query}`)).toBe(true);
  });

  it("list: forwards to /internal/offers/{offerId}/trigger-events with the query verbatim", async () => {
    const query = `?brandId=${BRAND}&limit=20`;
    const res = await request(buildApp()).get(`/v1/offers/${OFFER}/trigger-events${query}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(LIST_BODY));
    const { url } = upstream();
    expect(url.endsWith(`/internal/offers/${OFFER}/trigger-events${query}`)).toBe(true);
    expect(url).not.toContain("/summary");
  });

  it("sends the AUTHENTICATED org, not one the caller named", async () => {
    await request(buildApp())
      .get(`/v1/offers/${OFFER}/trigger-events?brandId=${BRAND}`)
      .set("x-org-id", "org_someone_else");
    const { init } = upstream();
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
    expect(init.headers["x-user-id"]).toBe("user_test123");
    expect(init.headers["x-brand-id"]).toBe(BRAND);
  });

  it("relays campaign-service's 400 field-for-field, without refusing it itself", async () => {
    const upstreamCall = vi
      .fn()
      .mockImplementation(async () => respond(400, '{"error":"from is required","code":"bad_query"}'));
    global.fetch = upstreamCall;
    const res = await request(buildApp()).get(`/v1/offers/${OFFER}/trigger-events/summary?brandId=${BRAND}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "from is required", code: "bad_query" });
    expect(upstreamCall).toHaveBeenCalledTimes(1);
  });

  it("a failing upstream surfaces as a named error, not an empty success", async () => {
    global.fetch = vi.fn().mockImplementation(async () => respond(500, '{"error":"db down"}'));
    const res = await request(buildApp()).get(`/v1/offers/${OFFER}/trigger-events?brandId=${BRAND}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "db down" });
  });
});
