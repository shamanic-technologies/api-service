import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * A user API key belongs to its USER, across every organization the user is a
 * member of (owner decision 2026-10-01). Driven through the real `authenticate`
 * with the downstream reads stubbed: which org a request acts in, and every way
 * it is refused when that org cannot be picked or is out of scope.
 */

vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: vi.fn(),
  externalServices: {
    key: { url: "http://key", apiKey: "k" },
    client: { url: "http://client", apiKey: "k" },
    brand: { url: "http://brand", apiKey: "k" },
  },
}));

import { callExternalService } from "../../src/lib/service-client.js";
import { createRun } from "@distribute/runs-client";
import { authenticate, authenticateUser, requireOrg, requireStaff, AuthenticatedRequest } from "../../src/middleware/auth.js";

const mockCall = vi.mocked(callExternalService);

const LIVING_VITAL = { id: "org-living-vital", name: "Living Vital" };
const DISTRIBUTE = { id: "org-distribute", name: "distribute.you" };
const OTHER = { id: "org-other", name: "Someone else" };

const BRANDS = [
  { id: "brand-dy", orgId: DISTRIBUTE.id },
  { id: "brand-lv", orgId: LIVING_VITAL.id },
  { id: "brand-shared", orgId: LIVING_VITAL.id },
  { id: "brand-shared", orgId: DISTRIBUTE.id },
  { id: "brand-other", orgId: OTHER.id },
];

let membershipFails = false;

function stub(opts: { orgs: Array<{ id: string; name: string | null }>; email?: string }) {
  mockCall.mockImplementation(async (_svc: unknown, path: string, init?: any) => {
    if (path.startsWith("/validate")) return { valid: true, orgId: LIVING_VITAL.id, userId: "user-1" };
    if (path === "/internal/users/user-1") return { user: { id: "user-1", email: opts.email ?? "someone@acme.com" } };
    if (path === "/internal/users/user-1/orgs") {
      if (membershipFails) throw Object.assign(new Error("identity provider unreachable"), { statusCode: 502 });
      return { organizations: opts.orgs.map((o) => ({ orgId: o.id, name: o.name })) };
    }
    if (path === "/internal/brands/all") return { brands: BRANDS.map((b) => ({ ...b, name: b.id, domain: null })) };
    if (path === "/internal/orgs/names") {
      const all = [LIVING_VITAL, DISTRIBUTE, OTHER];
      const found = all.filter((o) => init.body.orgIds.includes(o.id));
      return { orgs: found.map((o) => ({ orgId: o.id, name: o.name })), notFound: init.body.orgIds.filter((id: string) => !found.some((o) => o.id === id)) };
    }
    throw new Error(`unexpected downstream call ${path}`);
  });
}

function app() {
  const a = express();
  a.use(express.json());
  const echo = (req: AuthenticatedRequest, res: express.Response) => res.json({ orgId: req.orgId ?? null });
  a.get("/v1/campaigns", authenticate, requireOrg, echo);
  a.post("/v1/campaigns", authenticate, requireOrg, echo);
  a.get("/v1/brands/:id/stats", authenticate, requireOrg, echo);
  a.get("/v1/brands/:brandId/daily-budget", authenticate, requireOrg, echo);
  a.get("/v1/me", authenticateUser, echo);
  a.get("/v1/staff-thing", authenticate, requireStaff, echo);
  return a;
}

const KEY = "Bearer distrib.usr_test";
const calledPaths = () => mockCall.mock.calls.map((c) => c[1] as string);

beforeEach(() => {
  mockCall.mockReset();
  vi.mocked(createRun).mockClear();
  membershipFails = false;
});

describe("user key — single-org user (today's customers)", () => {
  it("acts in the one organization with nothing named, without reading brands", async () => {
    stub({ orgs: [DISTRIBUTE] });
    const res = await request(app()).get("/v1/campaigns").set("Authorization", KEY);
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(DISTRIBUTE.id);
    expect(calledPaths()).not.toContain("/internal/brands/all");
    expect(vi.mocked(createRun)).toHaveBeenCalledWith(expect.objectContaining({ orgId: DISTRIBUTE.id }), expect.anything());
  });

  it("naming a brand needs no brand lookup either (the downstream scopes it on the org)", async () => {
    stub({ orgs: [DISTRIBUTE] });
    const res = await request(app()).get("/v1/campaigns?brandId=brand-dy").set("Authorization", KEY);
    expect(res.body.orgId).toBe(DISTRIBUTE.id);
    expect(calledPaths()).not.toContain("/internal/brands/all");
  });

  it("naming an organization the user is not in is refused", async () => {
    stub({ orgs: [DISTRIBUTE] });
    const res = await request(app()).get(`/v1/campaigns?orgId=${OTHER.id}`).set("Authorization", KEY);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("org_not_member");
    expect(res.body.organizations).toEqual([DISTRIBUTE]);
  });
});

describe("user key — multi-org user", () => {
  const orgs = [LIVING_VITAL, DISTRIBUTE];

  it("naming nothing is refused with the list of organizations, never a default", async () => {
    stub({ orgs });
    const res = await request(app()).get("/v1/campaigns").set("Authorization", KEY);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("org_target_required");
    expect(res.body.organizations).toEqual(orgs);
    expect(res.body.message).toMatch(/belongs to 2 organizations/);
    expect(res.body.fix).toMatch(/brandId/);
    expect(res.body.fix).toMatch(/orgId/);
    expect(vi.mocked(createRun)).not.toHaveBeenCalled();
  });

  it("the org stored on the key is never used as a default", async () => {
    stub({ orgs });
    const res = await request(app()).get("/v1/campaigns").set("Authorization", KEY);
    expect(res.body.orgId).toBeUndefined();
    expect(res.status).toBe(400);
  });

  it.each([
    ["query brandId", (r: request.Test) => r, "/v1/campaigns?brandId=brand-dy"],
    ["x-brand-id header", (r: request.Test) => r.set("x-brand-id", "brand-dy"), "/v1/campaigns"],
    ["/brands/:id path", (r: request.Test) => r, "/v1/brands/brand-dy/stats"],
    ["/brands/:brandId path", (r: request.Test) => r, "/v1/brands/brand-dy/daily-budget"],
  ])("a brand named by %s selects the org holding it", async (_label, decorate, url) => {
    stub({ orgs });
    const res = await decorate(request(app()).get(url).set("Authorization", KEY));
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(DISTRIBUTE.id);
  });

  it("a brand named in a JSON body selects the org holding it", async () => {
    stub({ orgs });
    const res = await request(app()).post("/v1/campaigns").set("Authorization", KEY).send({ brandIds: ["brand-lv"] });
    expect(res.body.orgId).toBe(LIVING_VITAL.id);
  });

  it("an organization named by query or x-org-id header is used when the user is a member", async () => {
    stub({ orgs });
    const q = await request(app()).get(`/v1/campaigns?orgId=${DISTRIBUTE.id}`).set("Authorization", KEY);
    expect(q.body.orgId).toBe(DISTRIBUTE.id);
    const h = await request(app()).get("/v1/campaigns").set("Authorization", KEY).set("x-org-id", LIVING_VITAL.id);
    expect(h.body.orgId).toBe(LIVING_VITAL.id);
  });

  it("an organization the user was removed from is refused (membership read every request)", async () => {
    stub({ orgs: [DISTRIBUTE] });
    const res = await request(app()).get(`/v1/campaigns?orgId=${LIVING_VITAL.id}`).set("Authorization", KEY);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("org_not_member");
  });

  it("a brand held by none of the user's organizations is a 404, even if another org holds it", async () => {
    stub({ orgs });
    const res = await request(app()).get("/v1/campaigns?brandId=brand-other").set("Authorization", KEY);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("brand_not_found");
  });

  it("a brand held by two of the user's organizations asks for the org, and the org settles it", async () => {
    stub({ orgs });
    const res = await request(app()).get("/v1/campaigns?brandId=brand-shared").set("Authorization", KEY);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("brand_in_several_orgs");
    expect(res.body.organizations).toEqual(expect.arrayContaining(orgs));

    const settled = await request(app()).get(`/v1/campaigns?brandId=brand-shared&orgId=${DISTRIBUTE.id}`).set("Authorization", KEY);
    expect(settled.body.orgId).toBe(DISTRIBUTE.id);
  });

  it("brands of two different organizations in one request are refused", async () => {
    stub({ orgs });
    const res = await request(app()).get("/v1/campaigns").set("Authorization", KEY).set("x-brand-id", "brand-dy,brand-lv");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("brands_span_orgs");
  });

  it("a brand that contradicts the named org is refused", async () => {
    stub({ orgs });
    const res = await request(app()).get(`/v1/campaigns?brandId=brand-dy&orgId=${LIVING_VITAL.id}`).set("Authorization", KEY);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("brands_span_orgs");
  });

  it("two different orgs named at once are refused", async () => {
    stub({ orgs });
    const res = await request(app()).get(`/v1/campaigns?orgId=${DISTRIBUTE.id}`).set("Authorization", KEY).set("x-org-id", LIVING_VITAL.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Conflicting organization");
  });

  it("GET /v1/me answers without a target (that is how the choices are learned)", async () => {
    stub({ orgs });
    const res = await request(app()).get("/v1/me").set("Authorization", KEY);
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBeNull();
  });

  it("GET /v1/me still refuses a named org that is out of scope", async () => {
    stub({ orgs });
    const res = await request(app()).get(`/v1/me?orgId=${OTHER.id}`).set("Authorization", KEY);
    expect(res.status).toBe(403);
  });
});

describe("user key — staff user", () => {
  const staff = { orgs: [LIVING_VITAL], email: "Kevin.Lourd@gmail.com" };

  it("counts as a member of every organization: a brand of any org selects it", async () => {
    stub(staff);
    const res = await request(app()).get("/v1/campaigns?brandId=brand-other").set("Authorization", KEY);
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(OTHER.id);
  });

  it("a brand claimed by many orgs selects the one staff actually belongs to", async () => {
    stub(staff);
    // brand-shared is held by Living Vital (a real membership) and distribute.you (staff-wide only).
    const res = await request(app()).get("/v1/campaigns?brandId=brand-shared").set("Authorization", KEY);
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(LIVING_VITAL.id);
    // Naming the org still reaches the other holder.
    const other = await request(app()).get(`/v1/campaigns?brandId=brand-shared&orgId=${DISTRIBUTE.id}`).set("Authorization", KEY);
    expect(other.body.orgId).toBe(DISTRIBUTE.id);
  });

  it("can name any existing organization, not a non-existent one", async () => {
    stub(staff);
    const ok = await request(app()).get(`/v1/campaigns?orgId=${OTHER.id}`).set("Authorization", KEY);
    expect(ok.body.orgId).toBe(OTHER.id);
    const missing = await request(app()).get("/v1/campaigns?orgId=org-nope").set("Authorization", KEY);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("org_not_found");
  });

  it("must still name a target: no default org even with a single dashboard org", async () => {
    stub(staff);
    const res = await request(app()).get("/v1/campaigns").set("Authorization", KEY);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("org_target_required");
    expect(res.body.message).toMatch(/staff/);
  });

  it("never carries staff powers: a staff route refuses the key", async () => {
    stub(staff);
    const res = await request(app())
      .get(`/v1/staff-thing?orgId=${OTHER.id}`)
      .set("Authorization", KEY)
      .set("x-email", "kevin.lourd@gmail.com");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Staff access required");
  });
});

describe("user key — membership cannot be read", () => {
  it("a key whose user no longer exists is a 403 no_organization", async () => {
    mockCall.mockImplementation(async (_svc: unknown, path: string) => {
      if (path.startsWith("/validate")) return { valid: true, orgId: LIVING_VITAL.id, userId: "user-1" };
      throw Object.assign(new Error('{"error":"User not found","reason":"user_not_found"}'), { statusCode: 404 });
    });
    const res = await request(app()).get("/v1/campaigns").set("Authorization", KEY);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("no_organization");
    expect(res.body.message).toMatch(/no longer exists/);
  });

  it("is a 503 membership_unavailable, never a silent default org", async () => {
    stub({ orgs: [DISTRIBUTE] });
    membershipFails = true;
    const res = await request(app()).get("/v1/campaigns").set("Authorization", KEY);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("membership_unavailable");
    expect(res.body.message).toMatch(/identity provider unreachable/);
  });
});
