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
const PATH = `/v1/brands/${BRAND_ID}/linkedin-page`;
const DOWNSTREAM = `/orgs/brands/${BRAND_ID}/linkedin-page`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

const FOUND = {
  brandId: BRAND_ID,
  status: "found",
  linkedinUrl: "https://www.linkedin.com/company/pressbeat/",
  provenance: { method: "apollo_company_lookup", source: "apollo", setBy: null },
};

describe("/v1/brands/:id/linkedin-page", () => {
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

  it("GET forwards to the brand-service org path (a read, never the discover route) and returns the body verbatim", async () => {
    stubFetch(200, FOUND);
    const res = await request(app).get(PATH);
    expect(capturedUrl).toContain(DOWNSTREAM);
    expect(capturedUrl).not.toContain("discover");
    expect(capturedInit?.method).toBe("GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(FOUND);
  });

  it("PUT forwards the body byte-identical and returns the stored page", async () => {
    const set = { ...FOUND, linkedinUrl: "https://www.linkedin.com/company/distribute-you/", provenance: { method: "set_by_user", source: "user" } };
    stubFetch(200, set);
    const body = { linkedinUrl: "linkedin.com/company/distribute-you", extra: true };
    const res = await request(app).put(PATH).send(body);
    expect(capturedUrl).toContain(DOWNSTREAM);
    expect(capturedInit?.method).toBe("PUT");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
    expect(res.body).toEqual(set);
  });

  it("DELETE forwards with no body", async () => {
    stubFetch(200, { brandId: BRAND_ID, status: "not_computed", linkedinUrl: null, provenance: null });
    const res = await request(app).delete(PATH);
    expect(capturedUrl).toContain(DOWNSTREAM);
    expect(capturedInit?.method).toBe("DELETE");
    expect(capturedInit?.body).toBeUndefined();
    expect(res.body.status).toBe("not_computed");
  });

  it("forwards the authenticated identity headers, not caller-supplied ones", async () => {
    stubFetch(200, FOUND);
    await request(app).get(PATH).set("x-org-id", "org_attacker").set("x-user-id", "user_attacker");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("propagates a refusal with its own status and its whole body (reason included)", async () => {
    const refusal = { error: "This is a person's profile, not a company page.", reason: "personal_profile" };
    stubFetch(400, refusal);
    const res = await request(app).put(PATH).send({ linkedinUrl: "https://www.linkedin.com/in/x" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(refusal);
  });

  it("propagates a 403 on a foreign brand verbatim", async () => {
    stubFetch(403, { error: "Brand does not belong to the caller's org" });
    const res = await request(app).get(PATH);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Brand does not belong to the caller's org" });
  });
});
