import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * /v1/followup-cuts — pass-through to instantly-service /orgs/followup-cuts (LEAK-1012:
 * stop the follow-ups of leads a campaign emailed in error). Driven through the real
 * router with a stubbed fetch: the wire path, the authenticated identity, the body
 * byte-identical, and the producer's refusal reaching the caller field-for-field.
 */

const { INSTANTLY_BASE } = vi.hoisted(() => {
  const INSTANTLY_BASE = "http://instantly.test.local";
  process.env.INSTANTLY_SERVICE_URL = INSTANTLY_BASE;
  process.env.INSTANTLY_SERVICE_API_KEY = "instantly-test-key";
  return { INSTANTLY_BASE };
});

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

import conversationsRouter from "../../src/routes/conversations.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", conversationsRouter);
  return app;
}

let calls: Array<{ url: string; options: any }>;
function upstream(status = 200, body: unknown = { campaignId: "camp-1", cut: 1, alreadyCut: 0, failed: 0, leads: [] }) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

const BODY = { campaignId: "camp-1", leadEmails: ["a@x.com"], reason: "sourcing bug", extra: 1 };

beforeEach(() => {
  calls = [];
});

describe("POST /v1/followup-cuts", () => {
  it("forwards to instantly-service /orgs/followup-cuts with the authenticated identity, body byte-identical", async () => {
    upstream();
    const res = await request(buildApp())
      .post("/v1/followup-cuts")
      .set("x-org-id", "org_forged")
      .send(BODY);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/orgs/followup-cuts`);
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.headers["X-API-Key"]).toBe("instantly-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_authenticated");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(JSON.parse(calls[0].options.body)).toEqual(BODY);
  });

  it("the producer's 404 leads_not_in_campaign reaches the caller field-for-field", async () => {
    upstream(404, { error: "campaign has no sequence for: b@y.com", code: "leads_not_in_campaign", emails: ["b@y.com"] });
    const res = await request(buildApp()).post("/v1/followup-cuts").send(BODY);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("leads_not_in_campaign");
    expect(res.body.emails).toEqual(["b@y.com"]);
  });
});

describe("GET /v1/followup-cuts", () => {
  it("forwards the query verbatim", async () => {
    upstream(200, { cuts: [] });
    const res = await request(buildApp()).get("/v1/followup-cuts?campaignId=camp-1&x=2");
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${INSTANTLY_BASE}/orgs/followup-cuts?campaignId=camp-1&x=2`);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_authenticated");
  });
});
