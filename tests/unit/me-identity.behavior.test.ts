import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/me — "who am I acting as", driven through the real router with a
 * stubbed `fetch`: asserts which downstream reads happen and what an AI
 * assistant reading the first call learns (every organization the key reaches,
 * each with its brands, and which one this request acts in).
 */

const auth = vi.hoisted(() => ({
  authType: "user_key" as "user_key" | "admin",
  orgId: "org-1" as string | undefined,
  scope: { isStaff: false, memberships: [{ id: "org-1", name: "distribute.you" }, { id: "org-2", name: "Living Vital" }] } as
    | { isStaff: boolean; memberships: Array<{ id: string; name: string | null }> }
    | undefined,
}));

vi.mock("../../src/middleware/auth.js", () => ({
  authenticateUser: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.orgId = auth.orgId;
    req.runId = "run-1";
    req.authType = auth.authType;
    req.userKeyScope = auth.authType === "user_key" ? auth.scope : undefined;
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

type Handler = (url: string, init: any) => { status: number; body: unknown };
let calls: Array<{ url: string; init: any }>;

function stubFetch(handler: Handler) {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

const ALL_BRANDS = [
  { id: "b1", name: "distribute.you", domain: "distribute.you", orgId: "org-1" },
  { id: "b2", name: "Pressbeat", domain: "pressbeat.io", orgId: "org-1" },
  { id: "b3", name: "Living Vital", domain: "livingvital.com", orgId: "org-2" },
  { id: "b9", name: "Stranger", domain: "stranger.com", orgId: "org-9" },
];

const happy: Handler = (url, init) => {
  if (url.endsWith("/internal/users/user-1")) {
    return { status: 200, body: { user: { id: "user-1", email: "kevin@distribute.you", firstName: "Kevin", lastName: "Lourd" } } };
  }
  if (url.endsWith("/internal/brands/all")) return { status: 200, body: { brands: ALL_BRANDS } };
  if (url.endsWith("/internal/orgs/names")) {
    const ids: string[] = JSON.parse(init.body).orgIds;
    const names: Record<string, string> = { "org-1": "distribute.you", "org-2": "Living Vital", "org-9": "Stranger Inc" };
    return { status: 200, body: { orgs: ids.map((orgId) => ({ orgId, name: names[orgId] ?? null })), notFound: [] } };
  }
  if (url.includes("/internal/orgs/org-1")) return { status: 200, body: { id: "org-1", externalId: "org_x", name: "distribute.you" } };
  if (url.includes("/orgs/brands")) {
    return { status: 200, body: { brands: [{ id: "b1", name: "distribute.you", domain: "distribute.you", logoUrl: null }] } };
  }
  return { status: 404, body: { error: "unexpected" } };
};

describe("GET /v1/me — a user key reaches every organization of its user", () => {
  beforeEach(() => {
    auth.authType = "user_key";
    auth.orgId = "org-1";
    auth.scope = { isStaff: false, memberships: [{ id: "org-1", name: "distribute.you" }, { id: "org-2", name: "Living Vital" }] };
  });

  it("lists the user's organizations with their brands, the targeted one, and the key scope", async () => {
    stubFetch(happy);
    const res = await request(buildApp()).get("/v1/me");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)[0]).toBe("summary");
    expect(res.body.organizations).toEqual([
      { id: "org-1", name: "distribute.you", brands: [
        { id: "b1", name: "distribute.you", domain: "distribute.you" },
        { id: "b2", name: "Pressbeat", domain: "pressbeat.io" },
      ] },
      { id: "org-2", name: "Living Vital", brands: [{ id: "b3", name: "Living Vital", domain: "livingvital.com" }] },
    ]);
    // A brand of an org the user is not in never appears.
    expect(JSON.stringify(res.body.organizations)).not.toContain("b9");
    expect(res.body.organization).toEqual({ id: "org-1", name: "distribute.you" });
    expect(res.body.brands).toHaveLength(2);
    expect(res.body.summary).toBe(
      "Acting as Kevin Lourd (kevin@distribute.you). This key reaches 2 organizations: " +
        '"distribute.you" (distribute.you, Pressbeat); "Living Vital" (Living Vital). This request acts in "distribute.you".',
    );
    expect(res.body.keyScope).toMatch(/belongs to its USER/);
    expect(res.body.keyScope).toMatch(/org_target_required/);
    expect(res.body.keyScope).toMatch(/never carries staff, admin or beta powers/);
    expect(res.body.lookupErrors).toEqual([]);
    expect(res.body).toMatchObject({ userId: "user-1", orgId: "org-1", authType: "user_key" });
  });

  it("with no target named: organization null, and the summary says each request must name one", async () => {
    auth.orgId = undefined;
    stubFetch(happy);
    const res = await request(buildApp()).get("/v1/me");
    expect(res.status).toBe(200);
    expect(res.body.organization).toBeNull();
    expect(res.body.brands).toBeNull();
    expect(res.body.organizations).toHaveLength(2);
    expect(res.body.summary).toMatch(/Each request must name a brand \(brandId\) or an organization \(orgId\)/);
  });

  it("a staff user's key lists every organization holding a brand, named in one batch", async () => {
    auth.orgId = undefined;
    auth.scope = { isStaff: true, memberships: [{ id: "org-2", name: "Living Vital" }] };
    stubFetch(happy);
    const res = await request(buildApp()).get("/v1/me");
    // Real memberships first, then every other organization holding a brand.
    expect(res.body.organizations.map((o: any) => o.id)).toEqual(["org-2", "org-1", "org-9"]);
    expect(res.body.organizations[2]).toEqual({ id: "org-9", name: "Stranger Inc", brands: [{ id: "b9", name: "Stranger", domain: "stranger.com" }] });
    expect(calls.filter((c) => c.url.endsWith("/internal/orgs/names"))).toHaveLength(1);
    expect(res.body.summary).toMatch(/Staff: counts as a member of every organization; 3 organizations hold a brand\./);
  });

  it("null + lookupErrors when the brand lookup fails, never an empty list", async () => {
    stubFetch((url, init) => (url.endsWith("/internal/brands/all") ? { status: 500, body: { error: "db down" } } : happy(url, init)));
    const res = await request(buildApp()).get("/v1/me");
    expect(res.status).toBe(200);
    expect(res.body.organizations).toBeNull();
    expect(res.body.summary).toMatch(/could not be listed \(lookup failed\)/);
    expect(res.body.lookupErrors[0].source).toMatch(/brand-service/);
    expect(res.body.lookupErrors[0].error).toMatch(/db down/);
  });
});

describe("GET /v1/me — dashboard session", () => {
  beforeEach(() => {
    auth.authType = "admin";
    auth.orgId = "org-1";
  });

  it("describes the one signed-in organization, keyScope null", async () => {
    stubFetch(happy);
    const res = await request(buildApp()).get("/v1/me");
    expect(res.body.keyScope).toBeNull();
    expect(res.body.organizations).toEqual([
      { id: "org-1", name: "distribute.you", brands: [{ id: "b1", name: "distribute.you", domain: "distribute.you" }] },
    ]);
    expect(res.body.organization).toEqual({ id: "org-1", name: "distribute.you" });
    expect(calls.some((c) => /\/orgs\/brands\?orgId=org-1$/.test(c.url))).toBe(true);
    for (const c of calls) expect(c.init.headers["x-org-id"]).toBe("org-1");
  });
});
