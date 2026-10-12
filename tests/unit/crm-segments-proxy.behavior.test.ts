import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/orgs/contacts/segments must reach crm-service's own
 * GET /orgs/contacts/segments with the authenticated org, the query string
 * byte-copied, and the answer (the brand's CRM segment catalogue) or the
 * refusal returned untouched.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "user_key";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import crmRouter from "../../src/routes/crm.js";

const CRM_BASE = "http://crm.test.local";
const BRAND = "bbbbbbbb-1111-4111-8111-000000000001";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", crmRouter);
  return app;
}

describe("GET /v1/orgs/contacts/segments → crm-service", () => {
  let calls: Array<{ url: string; options: any }>;

  function upstreamOnce(status: number, body: unknown) {
    (global.fetch as any).mockImplementationOnce(async (url: string, options: any) => {
      calls.push({ url, options });
      const text = JSON.stringify(body);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(text),
      };
    });
  }

  beforeEach(() => {
    process.env.CRM_SERVICE_URL = CRM_BASE;
    process.env.CRM_SERVICE_API_KEY = "crm-test-key";
    calls = [];
    global.fetch = vi.fn();
  });

  afterEach(() => {
    delete process.env.CRM_SERVICE_URL;
    delete process.env.CRM_SERVICE_API_KEY;
  });

  it("forwards to /orgs/contacts/segments with the query verbatim and the authenticated org, body byte-identical", async () => {
    const upstream = {
      brandId: BRAND,
      dealStages: [{ pipeline: "Sales Pipeline", stage: "Form Filled - No Appointment", status: "open", people: 42 }],
      tags: [{ tag: "vip", people: 3 }],
      steps: [{ step: "signup", people: 7 }],
    };
    upstreamOnce(200, upstream);

    const res = await request(buildApp()).get(`/v1/orgs/contacts/segments?brandId=${BRAND}&x=a&x=b`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/contacts/segments?brandId=${BRAND}&x=a&x=b`);
    expect(calls[0].options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });

  it("a crm-service 400 reaches the caller with the same status and JSON body", async () => {
    const upstream = { type: "validation", error: "brandId (uuid) query is required" };
    upstreamOnce(400, upstream);

    const res = await request(buildApp()).get("/v1/orgs/contacts/segments");

    expect(res.status).toBe(400);
    expect(res.body).toEqual(upstream);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/contacts/segments`);
  });
});
