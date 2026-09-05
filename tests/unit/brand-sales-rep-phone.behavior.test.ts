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
const PATH = `/v1/brands/${BRAND_ID}/sales-rep-phone`;
const DOWNSTREAM = `/orgs/brands/${BRAND_ID}/sales-rep-phone`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

describe("/v1/brands/:id/sales-rep-phone", () => {
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

  it("GET forwards to the brand-service path and returns the body verbatim", async () => {
    stubFetch(200, { salesRepPhone: "+33612345678" });

    const res = await request(app).get(PATH);

    expect(capturedUrl).toContain(DOWNSTREAM);
    expect(capturedInit?.method).toBe("GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepPhone: "+33612345678" });
  });

  it("GET returns a null number as-is (nobody to ring is not a 404)", async () => {
    stubFetch(200, { salesRepPhone: null });

    const res = await request(app).get(PATH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepPhone: null });
  });

  it("PUT forwards the body byte-identical, including fields the gateway does not know", async () => {
    stubFetch(200, { salesRepPhone: "+33612345678" });
    const body = { salesRepPhone: "00 33 6 12 34 56 78", somethingBrandServiceAddsLater: true };

    const res = await request(app).put(PATH).send(body);

    expect(capturedUrl).toContain(DOWNSTREAM);
    expect(capturedInit?.method).toBe("PUT");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
    expect(res.body).toEqual({ salesRepPhone: "+33612345678" });
  });

  it("DELETE forwards with no body and returns the downstream body verbatim", async () => {
    stubFetch(200, { salesRepPhone: null });

    const res = await request(app).delete(PATH);

    expect(capturedUrl).toContain(DOWNSTREAM);
    expect(capturedInit?.method).toBe("DELETE");
    expect(capturedInit?.body).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepPhone: null });
  });

  it("forwards the authenticated identity headers, not caller-supplied ones", async () => {
    stubFetch(200, { salesRepPhone: null });

    await request(app).get(PATH).set("x-org-id", "org_attacker").set("x-user-id", "user_attacker");

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  it("propagates a refusal with its own status and its whole body", async () => {
    stubFetch(400, { error: "Sales rep phone must carry a country code", code: "NO_COUNTRY_CODE" });

    const res = await request(app).put(PATH).send({ salesRepPhone: "0612345678" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Sales rep phone must carry a country code", code: "NO_COUNTRY_CODE" });
  });

  it("propagates a 403 on a foreign brand verbatim", async () => {
    stubFetch(403, { error: "Brand does not belong to the caller's org" });

    const res = await request(app).get(PATH);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Brand does not belong to the caller's org" });
  });

  it("does not swallow the sibling literal routes on the same prefix", async () => {
    stubFetch(200, { clickDestinationUrl: "https://acme.com" });

    await request(app).put(`/v1/brands/${BRAND_ID}/click-destination`).send({ clickDestinationUrl: "https://acme.com" });

    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/click-destination`);
  });
});
