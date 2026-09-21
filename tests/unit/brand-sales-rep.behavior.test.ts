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
const PATH = `/v1/brands/${BRAND_ID}/sales-rep`;
const DOWNSTREAM = `/orgs/brands/${BRAND_ID}/sales-rep`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

describe("/v1/brands/:id/sales-rep", () => {
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

  // AC1 — the dashboard can read a brand's rep.
  it("GET forwards to the brand-service path and returns the body verbatim", async () => {
    stubFetch(200, { salesRepEmail: "rep@acme.com", salesRepPhone: "+33612345678" });

    const res = await request(app).get(PATH);

    expect(capturedUrl).toContain(DOWNSTREAM);
    expect(capturedUrl).not.toContain("sales-rep-phone");
    expect(capturedInit?.method).toBe("GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepEmail: "rep@acme.com", salesRepPhone: "+33612345678" });
  });

  // AC1 — a brand that never stated a rep reads as a 200, not a 404.
  it("GET returns the never-stated answer as-is (nobody to reach is not a 404)", async () => {
    stubFetch(200, { salesRepEmail: null, salesRepPhone: null });

    const res = await request(app).get(PATH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepEmail: null, salesRepPhone: null });
  });

  // AC2 — the dashboard can state a rep and read back what was saved.
  it("PUT forwards the body byte-identical, including fields the gateway does not know", async () => {
    stubFetch(200, { salesRepEmail: "rep@acme.com", salesRepPhone: "+33612345678" });
    const body = {
      salesRepEmail: " rep@acme.com ",
      salesRepPhone: "00 33 6 12 34 56 78",
      somethingBrandServiceAddsLater: true,
    };

    const res = await request(app).put(PATH).send(body);

    expect(capturedUrl).toContain(DOWNSTREAM);
    expect(capturedInit?.method).toBe("PUT");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepEmail: "rep@acme.com", salesRepPhone: "+33612345678" });
  });

  // AC2 — an email with no phone is legal downstream; the gateway narrows nothing.
  it("PUT forwards an email-only rep without narrowing it", async () => {
    stubFetch(200, { salesRepEmail: "rep@acme.com", salesRepPhone: null });

    const res = await request(app).put(PATH).send({ salesRepEmail: "rep@acme.com" });

    expect(JSON.parse(capturedInit?.body as string)).toEqual({ salesRepEmail: "rep@acme.com" });
    expect(res.body).toEqual({ salesRepEmail: "rep@acme.com", salesRepPhone: null });
  });

  // AC3 — the dashboard can remove a rep.
  it("DELETE forwards with no body and returns the downstream body verbatim", async () => {
    stubFetch(200, { salesRepEmail: null, salesRepPhone: null });

    const res = await request(app).delete(PATH);

    expect(capturedUrl).toContain(DOWNSTREAM);
    expect(capturedInit?.method).toBe("DELETE");
    expect(capturedInit?.body).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepEmail: null, salesRepPhone: null });
  });

  // AC4 — a refusal keeps its own status and its own sentence, field for field.
  it("propagates the phone-without-email refusal with its status and whole body", async () => {
    stubFetch(400, {
      error: "A sales rep phone cannot be stated without an email address",
      code: "PHONE_WITHOUT_EMAIL",
    });

    const res = await request(app).put(PATH).send({ salesRepPhone: "+33612345678" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "A sales rep phone cannot be stated without an email address",
      code: "PHONE_WITHOUT_EMAIL",
    });
  });

  // AC5 — a foreign or unknown brand is refused exactly as the rep-phone proxy refuses one.
  it("propagates a 403 on a foreign brand verbatim", async () => {
    stubFetch(403, { error: "Brand does not belong to the caller's org" });

    const res = await request(app).get(PATH);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Brand does not belong to the caller's org" });
  });

  it("propagates a 404 on an unknown brand verbatim", async () => {
    stubFetch(404, { error: "Brand not found" });

    const res = await request(app).get(PATH);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Brand not found" });
  });

  // AC5 — the org boundary is the authenticated one, not one the caller names.
  it("forwards the authenticated identity headers, not caller-supplied ones", async () => {
    stubFetch(200, { salesRepEmail: null, salesRepPhone: null });

    await request(app).get(PATH).set("x-org-id", "org_attacker").set("x-user-id", "user_attacker");

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  // AC6 — the existing rep-phone proxy still reaches its own downstream path.
  it("does not swallow the sibling sales-rep-phone route", async () => {
    stubFetch(200, { salesRepPhone: "+33612345678" });

    await request(app).get(`/v1/brands/${BRAND_ID}/sales-rep-phone`);

    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/sales-rep-phone`);
  });
});
