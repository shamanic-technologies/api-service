import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { CLIENT_BASE } = vi.hoisted(() => {
  const CLIENT_BASE = "http://client.test.local";
  process.env.CLIENT_SERVICE_URL = CLIENT_BASE;
  process.env.CLIENT_SERVICE_API_KEY = "client-test-key";
  return { CLIENT_BASE };
});

/**
 * Create a client org (staff key only) and member invitations (any member) →
 * client-service. `authenticate*` stand in for each identity; `requireStaffActor`
 * is real. Asserts the forwarded path, the identity the gateway forces into the
 * body, and the byte-identical status + body coming back.
 */
const identity = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  const stub = (req: any, _res: any, next: any) => {
    Object.assign(req, { userId: "user-staff", runId: "run-1" }, identity.current);
    next();
  };
  return { ...actual, authenticate: stub, authenticateUser: stub };
});

import orgsRouter from "../../src/routes/orgs.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", orgsRouter);
  return a;
}

const STAFF_KEY = { authType: "user_key", userKeyScope: { isStaff: true, email: "kevin@distribute.you", memberships: [] } };
const CLIENT_KEY = { authType: "user_key", userKeyScope: { isStaff: false, email: "client@acme.com", memberships: [] } };
let fetchMock: ReturnType<typeof vi.fn>;

function upstream(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("POST /v1/orgs → client-service POST /internal/orgs", () => {
  it("a staff key creates: the acting user is forced from auth, 201 + body piped back", async () => {
    identity.current = { ...STAFF_KEY, orgId: undefined };
    const created = { orgId: "11111111-1111-1111-1111-111111111111", name: "Acme", created: true, onboardingComplete: true };
    fetchMock.mockResolvedValue(upstream(201, created));
    const res = await request(app()).post("/v1/orgs").send({ name: "Acme", idempotencyKey: "k1", createdByUserId: "forged" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CLIENT_BASE}/internal/orgs`);
    expect(JSON.parse(init.body as string)).toEqual({ name: "Acme", idempotencyKey: "k1", createdByUserId: "user-staff" });
  });

  it("a client key is refused 403 staff_only and client-service is never called", async () => {
    identity.current = { ...CLIENT_KEY, userId: "user-client" };
    const res = await request(app()).post("/v1/orgs").send({ name: "Acme" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("staff_only");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/v1/orgs/:orgId/member-invitations → client-service", () => {
  const ORG = "22222222-2222-2222-2222-222222222222";

  it("POST invites with the authenticated org in the path and the inviter forced from auth", async () => {
    identity.current = { ...CLIENT_KEY, userId: "user-client", orgId: ORG };
    const invitation = { invitation: { id: "orginv_1", email: "jane@acme.com", inviteUrl: "https://x/invite" }, created: true };
    fetchMock.mockResolvedValue(upstream(201, invitation));
    const res = await request(app()).post(`/v1/orgs/${ORG}/member-invitations`).send({ email: "jane@acme.com", invitedByUserId: "forged" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(invitation);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CLIENT_BASE}/internal/orgs/${ORG}/member-invitations`);
    expect(JSON.parse(init.body as string)).toEqual({ email: "jane@acme.com", invitedByUserId: "user-client" });
  });

  it("GET lists and DELETE revokes on the exact downstream paths, refusals forwarded", async () => {
    identity.current = { ...CLIENT_KEY, userId: "user-client", orgId: ORG };
    fetchMock.mockResolvedValueOnce(upstream(200, { invitations: [] }));
    const list = await request(app()).get(`/v1/orgs/${ORG}/member-invitations`);
    expect(list.status).toBe(200);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${CLIENT_BASE}/internal/orgs/${ORG}/member-invitations`);

    fetchMock.mockResolvedValueOnce(upstream(404, { error: "invitation_not_found", message: "No such invitation" }));
    const del = await request(app()).delete(`/v1/orgs/${ORG}/member-invitations/orginv_9`);
    expect(del.status).toBe(404);
    expect(del.body).toEqual({ error: "invitation_not_found", message: "No such invitation" });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${CLIENT_BASE}/internal/orgs/${ORG}/member-invitations/orginv_9`);
    expect(init.method).toBe("DELETE");
  });

  it("a path org that is not the authenticated one is refused before any call", async () => {
    identity.current = { ...CLIENT_KEY, userId: "user-client", orgId: ORG };
    const res = await request(app()).get("/v1/orgs/33333333-3333-3333-3333-333333333333/member-invitations");
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
