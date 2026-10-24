import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.brandId = "brand_testabc";
    req.authType = "admin";
    next();
  },
  authenticatePlatform: (req: any, _res: any, next: any) => {
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import brandRouter from "../../src/routes/brand.js";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const PATH = `/v1/brands/${BRAND_ID}/competitors`;
const DOWNSTREAM_READ = `/orgs/brands/${BRAND_ID}/competitors`;
const DOWNSTREAM_DISCOVER = `/orgs/brands/${BRAND_ID}/competitors/discover`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

const COMPUTED = {
  brandId: BRAND_ID,
  status: "computed",
  discoveredAt: "2026-10-24T00:00:00.000Z",
  provenance: { method: "llm", runId: "run_x" },
  competitors: [{ name: "Acme", domain: "acme.com", websiteConfidence: 0.93, linkedinUrl: null, linkedinSource: null }],
  competitorsWithoutWebsite: [{ name: "Globex" }],
  unknownFutureField: { kept: true },
};

describe("/v1/brands/:id/competitors", () => {
  let app: express.Express;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  function stubFetch(status: number, body: unknown) {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    capturedUrl = undefined;
    capturedInit = undefined;
  });

  it("GET forwards to the brand-service read path (never discover) and returns the body verbatim", async () => {
    stubFetch(200, COMPUTED);
    const res = await request(app).get(PATH);
    expect(new URL(capturedUrl!).pathname).toBe(DOWNSTREAM_READ);
    expect(capturedInit?.method).toBe("GET");
    expect(capturedInit?.body).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(COMPUTED);
  });

  it("GET passes not_computed through as a 200", async () => {
    const empty = { brandId: BRAND_ID, status: "not_computed", discoveredAt: null, provenance: null, competitors: [], competitorsWithoutWebsite: [] };
    stubFetch(200, empty);
    const res = await request(app).get(PATH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(empty);
  });

  it("POST discover forwards to the discover path with the body byte-identical", async () => {
    stubFetch(200, COMPUTED);
    const body = { refresh: true, extra: "kept" };
    const res = await request(app).post(`${PATH}/discover`).send(body);
    expect(new URL(capturedUrl!).pathname).toBe(DOWNSTREAM_DISCOVER);
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(COMPUTED);
  });

  it("POST discover with no body still forwards a JSON object", async () => {
    stubFetch(200, COMPUTED);
    await request(app).post(`${PATH}/discover`);
    expect(new URL(capturedUrl!).pathname).toBe(DOWNSTREAM_DISCOVER);
    expect(JSON.parse(capturedInit?.body as string)).toEqual({});
  });

  it("forwards the authenticated identity headers, not caller-supplied ones", async () => {
    stubFetch(200, COMPUTED);
    await request(app).post(`${PATH}/discover`).set("x-org-id", "org_attacker").set("x-user-id", "user_attacker").send({});
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it.each([
    [402, { error: "Insufficient credits", detail: "balance 0" }],
    [403, { error: "Brand does not belong to the caller's org" }],
    [404, { error: "Brand not found" }],
    [422, { error: "Nothing is known about this brand yet", code: "nothing_to_read" }],
    [502, { error: "chat-service failed" }],
  ])("propagates a %i from discover with its own status and whole body", async (status, body) => {
    stubFetch(status, body);
    const res = await request(app).post(`${PATH}/discover`).send({});
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
  });

  it("propagates a 403 on the read verbatim", async () => {
    stubFetch(403, { error: "Brand does not belong to the caller's org" });
    const res = await request(app).get(PATH);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Brand does not belong to the caller's org" });
  });
});
