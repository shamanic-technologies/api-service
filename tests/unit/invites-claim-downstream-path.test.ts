import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/orgs/:orgId/invites/claim must reach client-service's real claim
 * handler, POST /internal/invites/claim.
 *
 * The gateway shipped pointing at /internal/orgs/{orgId}/invites/claim — a path
 * client-service has never served — so every claim would have 404'd. Nothing had
 * called the route (the dashboard's referral card was decorative), so no test
 * caught it: the old assertions only checked the middleware chain and a
 * "/internal/orgs/" substring, both of which the broken path satisfied.
 *
 * client-service identifies the claiming org from the BODY (`inviteeOrgId`), not
 * from the path, so the gateway supplies it from the authenticated identity.
 */

const AUTH_ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "44444444-4444-4444-8444-444444444444";
    req.orgId = AUTH_ORG;
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import invitesRouter from "../../src/routes/invites.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", invitesRouter);
  return app;
}

type Captured = { url: string; init: any };

describe("POST /v1/orgs/:orgId/invites/claim", () => {
  let calls: Captured[];

  function mockUpstream(status: number, body: unknown) {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      const text = JSON.stringify(body);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(text),
      };
    }) as any;
  }

  beforeEach(() => {
    mockUpstream(200, { ok: true, inviterOrgId: OTHER_ORG });
  });

  it("forwards to client-service POST /internal/invites/claim", async () => {
    const res = await request(buildApp())
      .post(`/v1/orgs/${AUTH_ORG}/invites/claim`)
      .send({ code: "acme-corp" });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/internal/invites/claim");
    expect(calls[0].init.method).toBe("POST");
  });

  it("does NOT forward to the org-scoped path client-service never served", async () => {
    await request(buildApp())
      .post(`/v1/orgs/${AUTH_ORG}/invites/claim`)
      .send({ code: "acme-corp" });

    expect(calls[0].url).not.toContain("/internal/orgs/");
  });

  it("supplies inviteeOrgId from the authenticated identity", async () => {
    await request(buildApp())
      .post(`/v1/orgs/${AUTH_ORG}/invites/claim`)
      .send({ code: "acme-corp" });

    expect(JSON.parse(calls[0].init.body)).toEqual({
      code: "acme-corp",
      inviteeOrgId: AUTH_ORG,
    });
  });

  it("discards a client-supplied inviteeOrgId — the caller cannot claim for another org", async () => {
    await request(buildApp())
      .post(`/v1/orgs/${AUTH_ORG}/invites/claim`)
      .send({ code: "acme-corp", inviteeOrgId: OTHER_ORG });

    expect(JSON.parse(calls[0].init.body).inviteeOrgId).toBe(AUTH_ORG);
  });

  it("refuses a claim on behalf of a different org with 403, before any downstream call", async () => {
    const res = await request(buildApp())
      .post(`/v1/orgs/${OTHER_ORG}/invites/claim`)
      .send({ code: "acme-corp" });

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("forwards the upstream success body verbatim", async () => {
    const res = await request(buildApp())
      .post(`/v1/orgs/${AUTH_ORG}/invites/claim`)
      .send({ code: "acme-corp" });

    expect(res.body).toEqual({ ok: true, inviterOrgId: OTHER_ORG });
  });

  it("forwards the cap rejection with its status AND its machine-readable fields", async () => {
    mockUpstream(409, { error: "Invite cap reached", used: 3, total: 3 });

    const res = await request(buildApp())
      .post(`/v1/orgs/${AUTH_ORG}/invites/claim`)
      .send({ code: "acme-corp" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Invite cap reached", used: 3, total: 3 });
  });

  it("forwards an unknown-code rejection with its status and body", async () => {
    mockUpstream(404, { error: "Unknown invite code" });

    const res = await request(buildApp())
      .post(`/v1/orgs/${AUTH_ORG}/invites/claim`)
      .send({ code: "nope" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Unknown invite code" });
  });

  it("forwards identity headers to client-service", async () => {
    await request(buildApp())
      .post(`/v1/orgs/${AUTH_ORG}/invites/claim`)
      .send({ code: "acme-corp" });

    expect(calls[0].init.headers["x-org-id"]).toBe(AUTH_ORG);
  });
});
