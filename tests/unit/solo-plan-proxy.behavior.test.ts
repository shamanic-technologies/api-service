import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the routers import.
const { BILLING_BASE } = vi.hoisted(() => {
  const BILLING_BASE = "http://billing.test.local";
  process.env.BILLING_SERVICE_URL = BILLING_BASE;
  process.env.BILLING_SERVICE_API_KEY = "billing-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { BILLING_BASE };
});

/**
 * SOLO-PLAN-1125: the solo-founder plan's customer routes are byte pipes to billing-service
 * /v1/accounts/solo_plan* with the AUTHENTICATED org + user; status and body come back verbatim.
 * No auth mock: the real authenticate + requireOrg + requireUser.
 */
vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

import router from "../../src/routes/solo-plan.js";
import { buildDocument } from "../../src/openapi/document.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const AUTH = { "X-API-Key": "admin-test-key", "x-org-id": ORG, "x-user-id": USER };
let calls: Array<{ url: string; options: any }>;

function upstream(status: number, raw: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(raw, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  });
}

function expectIdentity(options: any) {
  expect(options.headers["X-API-Key"]).toBe("billing-test-key");
  expect(options.headers["x-org-id"]).toBe(ORG);
  expect(options.headers["x-user-id"]).toBe(USER);
  expect(options.headers["x-run-id"]).toBeTruthy();
}

beforeEach(() => {
  calls = [];
});

const ROUTES: Array<["get" | "post", string, string]> = [
  ["get", "/v1/billing/accounts/solo_plan", "/v1/accounts/solo_plan"],
  ["post", "/v1/billing/accounts/solo_plan/enroll", "/v1/accounts/solo_plan/enroll"],
  ["post", "/v1/billing/accounts/solo_plan/start", "/v1/accounts/solo_plan/start"],
  ["post", "/v1/billing/accounts/solo_plan/start_now", "/v1/accounts/solo_plan/start_now"],
  ["post", "/v1/billing/accounts/solo_plan/layers", "/v1/accounts/solo_plan/layers"],
];

describe.each(ROUTES)("%s %s", (method, path, downstream) => {
  it(`pipes to billing ${downstream} with the caller's org + user, 200 body byte-for-byte`, async () => {
    const raw = `{"org_id":"${ORG}","state":"trial","credit_left_cents":9900,"debt_cents":0}`;
    upstream(200, raw);
    const res = await request(buildApp())[method](path).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.text).toBe(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BILLING_BASE}${downstream}`);
    expect(calls[0].options.method).toBe(method.toUpperCase());
    if (method === "get") expect(calls[0].options.body).toBeUndefined();
    expectIdentity(calls[0].options);
  });

  it.each([
    [404, '{"error":"This account is not on the solo-founder plan","code":"not_enrolled"}'],
    [409, '{"error":"The trial is over","code":"not_in_trial"}'],
    [502, '{"error":"Failed to read the solo-founder plan"}'],
  ])("keeps billing's %i and body field-for-field", async (status, raw) => {
    upstream(status, raw);
    const res = await request(buildApp())[method](path).set(AUTH);
    expect(res.status).toBe(status);
    expect(res.body).toEqual(JSON.parse(raw));
  });

  it("refuses an unauthenticated caller before any downstream call", async () => {
    upstream(200, "{}");
    const res = await request(buildApp())[method](path);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /v1/billing/accounts/solo_plan/start body", () => {
  it("forwards the body verbatim, no default added, identity from auth never from the body", async () => {
    upstream(200, '{"card_required":true,"checkout_url":"https://checkout.stripe.com/x"}');
    const body = { return_url: "https://example.com/back", ui_mode: "hosted", orgId: "evil-org" };
    await request(buildApp()).post("/v1/billing/accounts/solo_plan/start").set(AUTH).send(body);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expectIdentity(calls[0].options);
  });

  it("an empty start stays empty (billing owns the return_url refusal)", async () => {
    const raw = '{"error":"return_url is required for a hosted card page"}';
    upstream(400, raw);
    const res = await request(buildApp()).post("/v1/billing/accounts/solo_plan/start").set(AUTH).send({});
    expect(JSON.parse(calls[0].options.body)).toEqual({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual(JSON.parse(raw));
  });
});

describe("openapi", () => {
  const doc: any = buildDocument();
  it("publishes every operation on the customer document with billing's answer", () => {
    for (const [method, path] of ROUTES) {
      const op = doc.paths[path]?.[method];
      expect(op, `${method} ${path}`).toBeTruthy();
      expect(op.operationId).toBeTruthy();
      const ok = op.responses["200"].content["application/json"].schema;
      const resolved = ok.$ref ? doc.components.schemas[ok.$ref.split("/").pop()] : ok;
      const documented = Object.keys(resolved.properties ?? {}).length + (resolved.allOf?.length ?? 0);
      expect(documented, `${method} ${path} answer documented`).toBeGreaterThan(0);
    }
  });

  it("start documents billing's body; spending writes need the user's yes, enrol does not", () => {
    const start = doc.paths["/v1/billing/accounts/solo_plan/start"].post;
    const schema = start.requestBody.content["application/json"].schema;
    const resolved = schema.$ref ? doc.components.schemas[schema.$ref.split("/").pop()] : schema;
    expect(Object.keys(resolved.properties ?? {})).toEqual(expect.arrayContaining(["return_url", "ui_mode"]));
    expect(start["x-needs-user-yes"]).toBeTruthy();
    expect(doc.paths["/v1/billing/accounts/solo_plan/start_now"].post["x-needs-user-yes"]).toBeTruthy();
    expect(doc.paths["/v1/billing/accounts/solo_plan/layers"].post["x-needs-user-yes"]).toBeTruthy();
    expect(doc.paths["/v1/billing/accounts/solo_plan/enroll"].post["x-needs-user-yes"]).toBeUndefined();
  });
});
