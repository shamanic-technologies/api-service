import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { CRM_BASE } = vi.hoisted(() => {
  const CRM_BASE = "http://crm.test.local";
  process.env.CRM_SERVICE_URL = CRM_BASE;
  process.env.CRM_SERVICE_API_KEY = "crm-test-key";
  return { CRM_BASE };
});

/**
 * POST /v1/orgs/contacts (CRM-ADD-ONE-CONTACT-1021): a client adds ONE person to a brand's
 * CRM. Must reach crm-service POST /orgs/contacts with the authenticated org + user, the body
 * byte-identical, and crm-service's status (201 created / 200 already held / 400 refusals)
 * and body returned untouched. Only `authenticate` is stubbed (it calls client-service);
 * the real `requireOrg` / `requireUser` run. Payloads are fixtures, not a contract owned here.
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      if (req.headers["x-test-no-user"] !== "true") req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

import crmRouter from "../../src/routes/crm.js";

const BRAND = "bbbbbbbb-1111-4111-8111-000000000001";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", crmRouter);
  return app;
}

let calls: Array<{ url: string; options: any }>;

function stubUpstream(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as any;
}

beforeEach(() => {
  calls = [];
});

const person = {
  brandId: BRAND,
  fullName: "Test Person",
  companyName: "Staff Test Co",
  linkedinUrl: "https://www.linkedin.com/in/staff-test-person",
  note: "Met at a staff test event",
};

describe("POST /v1/orgs/contacts → crm-service POST /orgs/contacts", () => {
  it("forwards the body verbatim with the authenticated org + user and relays the 201 byte-identical", async () => {
    const upstream = {
      contactId: "c1",
      created: true,
      matchedOn: null,
      emailStatus: "unknown",
      contact: { ...person, primaryEmail: null, fieldNobodyDeclared: 1 },
    };
    stubUpstream(201, upstream);

    const res = await request(buildApp())
      .post("/v1/orgs/contacts")
      .set("x-org-id", "forged-org")
      .send(person);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/contacts`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(person);
    expect(calls[0].options.headers["X-API-Key"]).toBe("crm-test-key");
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it("an already-held person keeps crm-service's 200", async () => {
    const upstream = { contactId: "c1", created: false, matchedOn: "linkedin", emailStatus: "unknown", contact: {} };
    stubUpstream(200, upstream);
    const res = await request(buildApp()).post("/v1/orgs/contacts").send(person);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
  });

  it.each([
    [{ type: "not_enough_to_find", error: "Give an email, a LinkedIn URL, or a name with a company" }],
    [{ type: "validation", error: "linkedinUrl: not a linkedin.com profile URL", details: { field: "linkedinUrl" } }],
  ])("a crm-service 400 reaches the caller with its status and full body (%o)", async (upstream) => {
    stubUpstream(400, upstream);
    const res = await request(buildApp()).post("/v1/orgs/contacts").send({ brandId: BRAND, fullName: "Nobody" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(upstream);
  });

  it("refuses a caller with no user before crm-service", async () => {
    stubUpstream(201, {});
    const res = await request(buildApp()).post("/v1/orgs/contacts").set("x-test-no-user", "true").send(person);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("does not swallow the sibling literal routes", async () => {
    stubUpstream(200, { contacts: [] });
    await request(buildApp()).get(`/v1/orgs/contacts?brandId=${BRAND}`);
    expect(calls[0].url).toBe(`${CRM_BASE}/orgs/contacts?brandId=${BRAND}`);
    expect(calls[0].options.method ?? "GET").toBe("GET");
  });
});
