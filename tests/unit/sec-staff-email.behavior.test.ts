import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * SEC-STAFF-EMAIL-1120 (security hotfix 2026-11-20). Prod incident: a customer
 * key called POST /v1/users/resolve and created a user carrying the owner's
 * staff address in a fresh org. Two doors are closed here, driven through the
 * REAL `authenticate` / `requireStaffActor` / users router (downstream stubbed):
 *   1. /v1/users/resolve only resolves the caller's OWN proven identity;
 *   2. a user key whose stored email is a staff address is NOT staff unless its
 *      user is one of the pinned staff user rows (`STAFF_USER_IDS`).
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
import { authenticate, requireOrg, requireStaffActor, AuthenticatedRequest } from "../../src/middleware/auth.js";
import usersRouter from "../../src/routes/users.js";
import { STAFF_USER_IDS } from "../../src/lib/staff.js";

const mockCall = vi.mocked(callExternalService);

const ATTACKER_USER = "a4651533-7acc-4c6e-be22-3a9b0e037568";
const ATTACKER_ORG = "3f338e3a-e3c2-493b-a6dc-064d943f178e";
const VICTIM_ORG = "org-victim";
const REAL_STAFF_USER = "cfe148ed-e3d8-40a2-8920-f8c040a81934";

function stubKey(userId: string, email: string, orgs: string[]) {
  mockCall.mockImplementation(async (_svc: unknown, path: string) => {
    if (path.startsWith("/validate")) return { valid: true, orgId: orgs[0], userId };
    if (path === `/internal/users/${userId}`) return { user: { id: userId, email } };
    if (path === `/internal/users/${userId}/orgs`) return { organizations: orgs.map((id) => ({ orgId: id, name: id })) };
    if (path === "/internal/orgs/names") return { orgs: [{ orgId: VICTIM_ORG, name: "Victim" }], notFound: [] };
    if (path === "/internal/resolve") return { orgId: "o", userId: "u", orgCreated: true, userCreated: true };
    throw new Error(`unexpected downstream call ${path}`);
  });
}

function app() {
  const a = express();
  a.use(express.json());
  const echo = (req: AuthenticatedRequest, res: express.Response) =>
    res.json({ orgId: req.orgId ?? null, staffEmail: req.staffEmail ?? null });
  a.get("/v1/campaigns", authenticate, requireOrg, echo);
  a.post("/v1/staff-key-op", authenticate, requireStaffActor, echo);
  a.use("/v1", usersRouter);
  return a;
}

const KEY = "Bearer distrib.usr_attacker";
const calledPaths = () => mockCall.mock.calls.map((c) => c[1] as string);

beforeEach(() => {
  mockCall.mockReset();
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-key";
});

describe("a key minted for a user created with a staff email is NOT staff", () => {
  it.each(["kevin.lourd@gmail.com", "Kevin@Distribute.you"])("stored email %s, unpinned user: no staff operation", async (email) => {
    stubKey(ATTACKER_USER, email, [ATTACKER_ORG]);
    const res = await request(app()).post("/v1/staff-key-op").set("authorization", KEY).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("staff_only");
  });

  it("cannot act in an organization it is not a member of (staff-wide org scope refused)", async () => {
    stubKey(ATTACKER_USER, "kevin.lourd@gmail.com", [ATTACKER_ORG]);
    const res = await request(app()).get(`/v1/campaigns?orgId=${VICTIM_ORG}`).set("authorization", KEY);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("org_not_member");
  });

  it("the pinned staff user keeps staff power", async () => {
    stubKey(REAL_STAFF_USER, STAFF_USER_IDS[REAL_STAFF_USER], ["org-staff-home"]);
    const op = await request(app()).post("/v1/staff-key-op?orgId=org-staff-home").set("authorization", KEY).send({});
    expect(op.status).toBe(200);
    expect(op.body.staffEmail).toBe("kevin.lourd@gmail.com");
    const scoped = await request(app()).get(`/v1/campaigns?orgId=${VICTIM_ORG}`).set("authorization", KEY);
    expect(scoped.status).toBe(200);
    expect(scoped.body.orgId).toBe(VICTIM_ORG);
  });

  it("a pinned staff user whose stored email changed away from staff is not staff", async () => {
    stubKey(REAL_STAFF_USER, "someone@else.com", ["org-staff-home"]);
    const res = await request(app()).post("/v1/staff-key-op").set("authorization", KEY).send({});
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/users/resolve only resolves the caller's own proven identity", () => {
  const ATTACK = { externalOrgId: "org_attacker_new", externalUserId: "user_attacker_new", email: "kevin.lourd@gmail.com" };

  it("a user key is refused 403 identity_not_proven and client-service is never asked", async () => {
    stubKey(ATTACKER_USER, "attacker@evil.com", [ATTACKER_ORG]);
    const res = await request(app()).post("/v1/users/resolve").set("authorization", KEY).send(ATTACK);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("identity_not_proven");
    expect(calledPaths()).not.toContain("/internal/resolve");
  });

  function platform(headers: Record<string, string>) {
    return request(app()).post("/v1/users/resolve").set("x-api-key", "platform-key").set(headers);
  }

  it("platform key: a body naming another identity than the session is refused", async () => {
    stubKey("x", "x@x.com", []);
    const res = await platform({ "x-external-org-id": "org_me", "x-external-user-id": "user_me", "x-email": "me@acme.com" }).send(ATTACK);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("identity_not_proven");
    // Only the session's own resolve ran (authenticate), never the body's identity.
    const resolveBodies = mockCall.mock.calls.filter((c) => c[1] === "/internal/resolve").map((c) => (c[2] as any).body);
    expect(resolveBodies).toEqual([{ externalOrgId: "org_me", externalUserId: "user_me", email: "me@acme.com" }]);
  });

  it("platform key: the session's own ids with an email other than the session's is refused", async () => {
    stubKey("x", "x@x.com", []);
    const res = await platform({ "x-external-org-id": "org_me", "x-external-user-id": "user_me", "x-email": "me@acme.com" })
      .send({ externalOrgId: "org_me", externalUserId: "user_me", email: "kevin.lourd@gmail.com" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("identity_not_proven");
  });

  it("platform key with internal ids only (no session) cannot resolve any identity", async () => {
    stubKey("x", "x@x.com", []);
    const res = await platform({ "x-org-id": "org-internal", "x-user-id": "user-internal" })
      .send({ externalOrgId: "org_any", externalUserId: "user_any" });
    expect(res.status).toBe(403);
    expect(calledPaths()).not.toContain("/internal/resolve");
  });

  it("platform key: the signed-in session's own identity is forwarded byte-identical", async () => {
    stubKey("x", "x@x.com", []);
    const body = { externalOrgId: "org_me", externalUserId: "user_me", email: "Me@Acme.com", firstName: "Me" };
    const res = await platform({ "x-external-org-id": "org_me", "x-external-user-id": "user_me", "x-email": "me@acme.com" }).send(body);
    expect(res.status).toBe(200);
    const resolveBodies = mockCall.mock.calls.filter((c) => c[1] === "/internal/resolve").map((c) => (c[2] as any).body);
    expect(resolveBodies[resolveBodies.length - 1]).toEqual(body);
  });
});
