import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/me — "who am I acting as", driven through the real router with a
 * stubbed `fetch`: asserts which downstream reads happen, with which identity,
 * and what an AI assistant reading the first call learns.
 */

const auth = vi.hoisted(() => ({ authType: "user_key" as "user_key" | "admin" }));

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.orgId = "org-1";
    req.runId = "run-1";
    req.authType = auth.authType;
    next();
  },
  AuthenticatedRequest: {},
}));

import meRouter from "../../src/routes/me.js";

function buildApp() {
  const app = express();
  app.use("/v1", meRouter);
  return app;
}

type Handler = (url: string) => { status: number; body: unknown };
let calls: Array<{ url: string; init: any }>;

function stubFetch(handler: Handler) {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

const happy: Handler = (url) => {
  if (url.includes("/internal/users/user-1")) {
    return { status: 200, body: { user: { id: "user-1", email: "kevin@distribute.you", firstName: "Kevin", lastName: "Lourd" } } };
  }
  if (url.includes("/internal/orgs/org-1")) return { status: 200, body: { id: "org-1", externalId: "org_x", name: "distribute.you" } };
  if (url.includes("/orgs/brands")) {
    return {
      status: 200,
      body: { brands: [
        { id: "b1", name: "distribute.you", domain: "distribute.you", logoUrl: null },
        { id: "b2", name: null, domain: "pressbeat.io", logoUrl: null },
      ] },
    };
  }
  return { status: 404, body: { error: "unexpected" } };
};

describe("GET /v1/me — identity for a user key", () => {
  beforeEach(() => {
    auth.authType = "user_key";
  });

  it("names the user, the organization and its brands, summary first", async () => {
    stubFetch(happy);
    const res = await request(buildApp()).get("/v1/me");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)[0]).toBe("summary");
    expect(res.body.summary).toBe(
      'Acting as Kevin Lourd (kevin@distribute.you) in the organization "distribute.you". ' +
        "It holds 2 brands: distribute.you, pressbeat.io. This access covers this one organization only.",
    );
    expect(res.body.organization).toEqual({ id: "org-1", name: "distribute.you" });
    expect(res.body.brands).toEqual([
      { id: "b1", name: "distribute.you", domain: "distribute.you" },
      { id: "b2", name: null, domain: "pressbeat.io" },
    ]);
    expect(res.body.user).toEqual({ id: "user-1", email: "kevin@distribute.you", firstName: "Kevin", lastName: "Lourd" });
    expect(res.body.keyScope).toMatch(/ONE organization/);
    expect(res.body.keyScope).toMatch(/never carries staff, admin or beta powers/);
    expect(res.body.lookupErrors).toEqual([]);
    // Pre-existing fields unchanged.
    expect(res.body).toMatchObject({ userId: "user-1", orgId: "org-1", authType: "user_key" });
  });

  it("reads only the authenticated org and user, with the authenticated identity headers", async () => {
    stubFetch(happy);
    await request(buildApp()).get("/v1/me?orgId=someone-else");

    const urls = calls.map((c) => c.url);
    expect(urls).toHaveLength(3);
    expect(urls.some((u) => /\/internal\/users\/user-1$/.test(u))).toBe(true);
    expect(urls.some((u) => /\/internal\/orgs\/org-1$/.test(u))).toBe(true);
    expect(urls.some((u) => /\/orgs\/brands\?orgId=org-1$/.test(u))).toBe(true);
    for (const c of calls) {
      expect(c.init.headers["x-org-id"]).toBe("org-1");
      expect(c.init.headers["x-user-id"]).toBe("user-1");
    }
  });

  it("says 'no brand yet' for an empty org, and null + lookupErrors when a lookup fails", async () => {
    stubFetch((url) => {
      if (url.includes("/orgs/brands")) return { status: 200, body: { brands: [] } };
      if (url.includes("/internal/orgs/")) return { status: 500, body: { error: "db down" } };
      return happy(url);
    });
    const res = await request(buildApp()).get("/v1/me");

    expect(res.status).toBe(200);
    expect(res.body.brands).toEqual([]);
    expect(res.body.organization).toBeNull();
    expect(res.body.summary).toMatch(/an unknown organization \(lookup failed\)/);
    expect(res.body.summary).toMatch(/^Acting as Kevin Lourd \(kevin@distribute\.you\) in an unknown organization/);
    expect(res.body.summary).toMatch(/It holds no brand yet\./);
    expect(res.body.lookupErrors).toHaveLength(1);
    expect(res.body.lookupErrors[0].source).toMatch(/client-service \/internal\/orgs/);
    expect(res.body.lookupErrors[0].error).toMatch(/db down/);
  });

  it("says the org name is not recorded instead of a broken sentence", async () => {
    stubFetch((url) => {
      if (url.includes("/internal/orgs/")) return { status: 200, body: { id: "org-1", externalId: "org_x", name: null } };
      return happy(url);
    });
    const res = await request(buildApp()).get("/v1/me");
    expect(res.body.summary).toMatch(/^Acting as Kevin Lourd \(kevin@distribute\.you\) in organization org-1 \(its name is not recorded\)\. /);
  });

  it("keyScope is null for a dashboard session", async () => {
    auth.authType = "admin";
    stubFetch(happy);
    const res = await request(buildApp()).get("/v1/me");
    expect(res.body.keyScope).toBeNull();
    expect(res.body.authType).toBe("admin");
  });
});
