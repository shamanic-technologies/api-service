import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * POST /v1/orgs/:orgId/phone-members → client-service POST
 * /internal/orgs/:orgId/phone-members (MEMBER-BY-PHONE-GATEWAY-1103). Driven
 * through the REAL `authenticate` (user keys): a member of the org and a staff
 * key reach the producer on the path org; a non-member is refused before any
 * producer call. The body and the producer's answer (refusals included) pass
 * through untouched.
 */

vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/lib/service-client.js", () => ({
  callExternalService: vi.fn(),
  pipeExternalService: vi.fn(),
  externalServices: {
    key: { url: "http://key", apiKey: "k" },
    client: { url: "http://client", apiKey: "k" },
    brand: { url: "http://brand", apiKey: "k" },
  },
}));

import { callExternalService, pipeExternalService } from "../../src/lib/service-client.js";
import orgsRouter from "../../src/routes/orgs.js";

const mockCall = vi.mocked(callExternalService);
const mockPipe = vi.mocked(pipeExternalService);

const ACME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const KEY = "Bearer distrib.usr_test";

function stub(opts: { orgs: string[]; email: string }) {
  mockCall.mockImplementation(async (_svc: unknown, path: string, init?: any) => {
    if (path.startsWith("/validate")) return { valid: true, orgId: ACME, userId: "user-1" };
    if (path === "/internal/users/user-1") return { user: { id: "user-1", email: opts.email } };
    if (path === "/internal/users/user-1/orgs") return { organizations: opts.orgs.map((id) => ({ orgId: id, name: id })) };
    if (path === "/internal/orgs/names") {
      const all = [ACME, OTHER];
      const found = all.filter((id) => init.body.orgIds.includes(id));
      return { orgs: found.map((id) => ({ orgId: id, name: id })), notFound: init.body.orgIds.filter((id: string) => !all.includes(id)) };
    }
    throw new Error(`unexpected downstream call ${path}`);
  });
}

function app() {
  const a = express();
  a.use(express.json());
  a.use("/v1", orgsRouter);
  return a;
}

beforeEach(() => {
  mockCall.mockReset();
  mockPipe.mockReset();
  mockPipe.mockImplementation(async (_svc: unknown, _path: string, init: any) => {
    init.expressRes.status(201).json({ forwarded: true });
  });
});

describe("POST /v1/orgs/:orgId/phone-members", () => {
  it("a member of the org adds a number: piped to the exact producer path, body untouched", async () => {
    stub({ orgs: [ACME], email: "founder@acme.com" });
    const res = await request(app())
      .post(`/v1/orgs/${ACME}/phone-members`)
      .set("Authorization", KEY)
      .send({ phone: "+15551234567" });
    expect(res.status).toBe(201);
    const [svc, path, init] = mockPipe.mock.calls[0] as [unknown, string, any];
    expect(svc).toEqual({ url: "http://client", apiKey: "k" });
    expect(path).toBe(`/internal/orgs/${ACME}/phone-members`);
    expect(init.method).toBe("POST");
    expect(init.body).toEqual({ phone: "+15551234567" });
    expect(init.headers["x-org-id"]).toBe(ACME);
  });

  it("a staff key reaches any org it is not a member of", async () => {
    stub({ orgs: [ACME], email: "kevin.lourd@gmail.com" });
    const res = await request(app())
      .post(`/v1/orgs/${OTHER}/phone-members`)
      .set("Authorization", KEY)
      .send({ phone: "+15551234567" });
    expect(res.status).toBe(201);
    expect((mockPipe.mock.calls[0] as [unknown, string])[1]).toBe(`/internal/orgs/${OTHER}/phone-members`);
  });

  it("a non-member is refused org_not_member and the producer is never called", async () => {
    stub({ orgs: [ACME], email: "founder@acme.com" });
    const res = await request(app())
      .post(`/v1/orgs/${OTHER}/phone-members`)
      .set("Authorization", KEY)
      .send({ phone: "+15551234567" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("org_not_member");
    expect(mockPipe).not.toHaveBeenCalled();
  });

  it("no key at all is refused", async () => {
    const res = await request(app()).post(`/v1/orgs/${ACME}/phone-members`).send({ phone: "+15551234567" });
    expect(res.status).toBe(401);
    expect(mockPipe).not.toHaveBeenCalled();
  });
});
