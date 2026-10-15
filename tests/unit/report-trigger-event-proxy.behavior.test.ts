import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/trigger-events — a customer reports one trigger occurrence, forwarded to campaign-service
 * POST /internal/trigger-events/public (the public door). Driven through the real router with a stubbed `fetch`: asserts the
 * brand ownership gate, the full downstream path, the authenticated identity, the byte-identical body
 * and the relayed status + body.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "user_key";
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

const BRAND = "d0965c2c-a58f-4497-addd-6a19e556b068";
const FOREIGN_BRAND = "11111111-2222-4333-8444-555555555555";
const OFFER = "70051e12-bf19-4639-a54e-cf4f9c1df8dd";

const BODY = {
  triggerId: "email_pushed_via_api",
  brandId: BRAND,
  offerId: OFFER,
  person: { email: "sam@employer.co.uk", name: "Sam Lee" },
  item: { subject: "Hiring in Leeds?", bodyText: "Hi Sam,\nI saw you are hiring.", somethingNew: 1 },
  idempotencyKey: "dj-123",
  futureField: "kept",
};

const CREATED = JSON.stringify({ event: { id: "e1", triggerId: "email_pushed_via_api", status: "fired", outcome: "ran" }, replayed: false });

function respond(status: number, body: string) {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("POST /v1/trigger-events", () => {
  let calls: Array<{ url: string; init: any }>;
  let campaignAnswer: () => Response;

  beforeEach(() => {
    calls = [];
    campaignAnswer = () => respond(201, CREATED);
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.endsWith("/orgs/brands")) return respond(200, JSON.stringify({ brands: [{ id: BRAND }] }));
      return campaignAnswer();
    });
  });

  function campaignCall() {
    const c = calls.filter((x) => x.url.includes("/internal/trigger-events"));
    expect(c).toHaveLength(1);
    return c[0];
  }

  it("forwards to campaign-service /internal/trigger-events/public, body byte-identical, 201 relayed", async () => {
    const res = await request(buildApp()).post("/v1/trigger-events").send(BODY);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(JSON.parse(CREATED));
    const { url, init } = campaignCall();
    expect(new URL(url).pathname).toBe("/internal/trigger-events/public");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(BODY);
  });

  it("sends the AUTHENTICATED org and user, not one the caller named", async () => {
    await request(buildApp()).post("/v1/trigger-events").set("x-org-id", "org_someone_else").send(BODY);
    const { init } = campaignCall();
    expect(init.headers["x-org-id"]).toBe("org_authenticated");
    expect(init.headers["x-user-id"]).toBe("user_test123");
  });

  it("checks the brand at brand-service /orgs/brands under the authenticated org", async () => {
    await request(buildApp()).post("/v1/trigger-events").send(BODY);
    const brandCall = calls.find((x) => x.url.endsWith("/orgs/brands"));
    expect(brandCall).toBeDefined();
    expect(brandCall!.init.headers["x-org-id"]).toBe("org_authenticated");
  });

  it("a brand that is not the org's is 404 brand_not_in_org and nothing is recorded", async () => {
    const res = await request(buildApp()).post("/v1/trigger-events").send({ ...BODY, brandId: FOREIGN_BRAND });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("brand_not_in_org");
    expect(calls.some((x) => x.url.includes("/internal/trigger-events"))).toBe(false);
  });

  it("refuses `performed` (400 performed_not_reportable) before any call", async () => {
    const res = await request(buildApp())
      .post("/v1/trigger-events")
      .send({ ...BODY, performed: { outcome: "ran", campaignId: "c1" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("performed_not_reportable");
    expect(calls).toHaveLength(0);
  });

  it("relays campaign-service's trigger_not_callable 400 field-for-field", async () => {
    campaignAnswer = () => respond(400, '{"error":"This trigger is computed by the platform","reason":"trigger_not_callable"}');
    const res = await request(buildApp()).post("/v1/trigger-events").send({ ...BODY, triggerId: "delay" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "This trigger is computed by the platform", reason: "trigger_not_callable" });
  });

  it("relays campaign-service's unknown_trigger 400 field-for-field", async () => {
    campaignAnswer = () => respond(400, '{"error":"no such trigger","reason":"unknown_trigger"}');
    const res = await request(buildApp()).post("/v1/trigger-events").send({ ...BODY, triggerId: "nope" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "no such trigger", reason: "unknown_trigger" });
  });

  it("relays the 200 replay status", async () => {
    campaignAnswer = () => respond(200, '{"event":{"id":"e1"},"replayed":true}');
    const res = await request(buildApp()).post("/v1/trigger-events").send(BODY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ event: { id: "e1" }, replayed: true });
  });
});
