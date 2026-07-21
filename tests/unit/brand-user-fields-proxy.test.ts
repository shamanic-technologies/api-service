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
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import brandRouter from "../../src/routes/brand.js";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", brandRouter);
  return app;
}

let capturedUrl: string | undefined;
let capturedInit: RequestInit | undefined;

function mockUpstream(status: number, payload: unknown, ok = status < 400) {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return ok
      ? { ok: true, status, json: () => Promise.resolve(payload) }
      : { ok: false, status, text: () => Promise.resolve(JSON.stringify(payload)) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedUrl = undefined;
  capturedInit = undefined;
});

// Full downstream shape incl. the { value, provenance } wrapper — must pass through verbatim.
const fieldsPayload = {
  fields: {
    services: { value: "SEO consulting", provenance: "confirmed" },
    dreamOutcome: { value: "Rank #1 on Google", provenance: "suggested" },
    perceivedLikelihood: { value: null, provenance: "suggested" },
    socialProof: { value: ["500+ clients"], provenance: "confirmed" },
    riskReversal: { value: "30-day guarantee", provenance: "confirmed" },
    urgency: { value: null, provenance: "suggested" },
    scarcity: { value: null, provenance: "suggested" },
  },
};

describe("GET /v1/brands/:id/user-fields", () => {
  it("forwards to brand-service /orgs/brands/:id/user-fields and returns { fields } + status verbatim", async () => {
    mockUpstream(200, fieldsPayload);
    const app = buildApp();
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/user-fields`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fieldsPayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/user-fields`);
    expect(capturedInit?.method ?? "GET").toBe("GET");
  });

  it("preserves the { value, provenance } wrapper on every key (no stripping)", async () => {
    mockUpstream(200, fieldsPayload);
    const app = buildApp();
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/user-fields`);

    expect(res.body.fields.services).toEqual({ value: "SEO consulting", provenance: "confirmed" });
    expect(res.body.fields.perceivedLikelihood).toEqual({ value: null, provenance: "suggested" });
  });

  it("forwards identity headers (x-org-id, x-user-id, x-run-id)", async () => {
    mockUpstream(200, fieldsPayload);
    const app = buildApp();
    await request(app).get(`/v1/brands/${BRAND_ID}/user-fields`);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_test456");
    expect(headers["x-user-id"]).toBe("user_test123");
    expect(headers["x-run-id"]).toBe("run_test789");
  });

  it.each([
    [404, { error: "Brand not found" }, "Brand not found"],
    [401, { error: "Unauthorized" }, "Unauthorized"],
  ])("propagates upstream %i status + body verbatim", async (status, payload, expected) => {
    mockUpstream(status, payload);
    const app = buildApp();
    const res = await request(app).get(`/v1/brands/${BRAND_ID}/user-fields`);

    expect(res.status).toBe(status);
    expect(res.body.error).toContain(expected);
  });
});

describe("PUT /v1/brands/:id/user-fields", () => {
  const body = { fields: { services: "SEO consulting", riskReversal: "30-day guarantee" } };

  it("forwards body byte-identical to downstream and returns { fields } verbatim", async () => {
    mockUpstream(200, fieldsPayload);
    const app = buildApp();
    const res = await request(app).put(`/v1/brands/${BRAND_ID}/user-fields`).send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fieldsPayload);
    expect(capturedUrl).toContain(`/orgs/brands/${BRAND_ID}/user-fields`);
    expect(capturedInit?.method).toBe("PUT");
    expect(JSON.parse(capturedInit?.body as string)).toEqual(body);
  });

  it("propagates an upstream 400 on an unknown key + body verbatim", async () => {
    mockUpstream(400, { error: "Unknown field key: bogus" });
    const app = buildApp();
    const res = await request(app).put(`/v1/brands/${BRAND_ID}/user-fields`).send({ fields: { bogus: "x" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Unknown field key");
  });
});
