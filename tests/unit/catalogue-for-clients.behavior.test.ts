import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load — set before the routers import.
const { FEATURES_BASE, WORKFLOW_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  const WORKFLOW_BASE = "http://workflow.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  process.env.WORKFLOW_SERVICE_URL = WORKFLOW_BASE;
  process.env.WORKFLOW_SERVICE_API_KEY = "workflow-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "admin-test-key";
  return { FEATURES_BASE, WORKFLOW_BASE };
});

/**
 * CATALOGUE-FOR-CLIENTS-1107 (owner 2026-11-07): the dashboard's Catalogue page is visible to EVERY signed-in client.
 * The dashboard reaches the gateway with the platform key + the user's identity; on that path a NON-staff user must
 * read every object the page shows (outcomes, Engines, scripts, tactics, strategies) and get the SAME body staff get,
 * while every catalogue write keeps refusing them.
 *
 * No auth mock: the real authenticatePlatform / authenticateUser / authenticate / requireStaff run (internal ids on
 * the platform path need no network; runs-client is stubbed). Every refusal asserts ZERO producer calls.
 */
vi.mock("@distribute/runs-client", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
  updateRun: vi.fn().mockResolvedValue({}),
}));

import catalogueRouter from "../../src/routes/catalogue-staff.js";
import enginesRouter, { withoutOrgId } from "../../src/routes/engines.js";
import playsRouter from "../../src/routes/plays.js";
import scriptsRouter from "../../src/routes/scripts.js";
import { buildDocument } from "../../src/openapi/document.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(catalogueRouter);
  app.use(enginesRouter);
  app.use(playsRouter);
  app.use("/v1", scriptsRouter);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
/** The dashboard's path for a signed-in client: platform key + the user's identity + their (non-staff) email. */
const CLIENT = { "X-API-Key": "admin-test-key", "x-org-id": ORG, "x-user-id": USER, "x-email": "founder@client.example" };
/** The dashboard's path for staff. */
const STAFF = { "X-API-Key": "admin-test-key", "x-org-id": ORG, "x-user-id": USER, "x-email": "kevin@distribute.you" };
const RAW = '{"rows":[{"id":"x"}],"total":1,"someNewField":true}';

let calls: Array<{ url: string; options: any }>;

function upstream(status: number, raw: string) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(raw, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  });
}

const producerCalls = () => calls.filter((c) => c.url.startsWith(FEATURES_BASE) || c.url.startsWith(WORKFLOW_BASE));

beforeEach(() => {
  calls = [];
});

/** Every read the Catalogue page needs, with the producer path it must reach. */
const READS = [
  { what: "outcomes list", path: "/v1/catalogue/steps?q=meeting", downstream: `${FEATURES_BASE}/internal/catalogue/steps?q=meeting` },
  { what: "one outcome", path: "/v1/catalogue/steps/meeting_booked", downstream: `${FEATURES_BASE}/internal/catalogue/steps/meeting_booked` },
  { what: "one Engine", path: "/v1/engines/meeting_booked", downstream: `${WORKFLOW_BASE}/internal/engines/meeting_booked` },
  { what: "scripts list", path: "/v1/scripts?outcome=meeting_booked", downstream: `${WORKFLOW_BASE}/scripts?outcome=meeting_booked` },
  { what: "one script", path: "/v1/scripts/3fa85f64-5717-4562-b3fc-2c963f66afa6", downstream: `${WORKFLOW_BASE}/scripts/3fa85f64-5717-4562-b3fc-2c963f66afa6` },
  { what: "one dynasty", path: "/v1/scripts/dynasty/meeting_booked/cold_hello", downstream: `${WORKFLOW_BASE}/scripts/dynasty/meeting_booked/cold_hello` },
  { what: "tactics list", path: "/v1/tactics?limit=25", downstream: `${FEATURES_BASE}/internal/catalogue/tactics?limit=25` },
  { what: "one tactic", path: "/v1/tactics/catch-all", downstream: `${FEATURES_BASE}/internal/catalogue/tactics/catch-all` },
  { what: "strategies list", path: "/v1/strategies?limit=25", downstream: `${FEATURES_BASE}/internal/catalogue/strategies?limit=25` },
  { what: "one strategy", path: "/v1/strategies/valid-catch-all", downstream: `${FEATURES_BASE}/internal/catalogue/strategies/valid-catch-all` },
  { what: "tactics list (catalogue path)", path: "/v1/catalogue/tactics?limit=25", downstream: `${FEATURES_BASE}/internal/catalogue/tactics?limit=25` },
  { what: "one tactic (catalogue path)", path: "/v1/catalogue/tactics/catch-all", downstream: `${FEATURES_BASE}/internal/catalogue/tactics/catch-all` },
  { what: "strategies list (catalogue path)", path: "/v1/catalogue/strategies?limit=25", downstream: `${FEATURES_BASE}/internal/catalogue/strategies?limit=25` },
  { what: "one strategy (catalogue path)", path: "/v1/catalogue/strategies/valid-catch-all", downstream: `${FEATURES_BASE}/internal/catalogue/strategies/valid-catch-all` },
];

describe("a non-staff client on the dashboard's path reads the whole Catalogue page", () => {
  for (const r of READS) {
    it(`${r.what}: 200, the exact producer path, the same bytes staff get`, async () => {
      upstream(200, RAW);
      const client = await request(buildApp()).get(r.path).set(CLIENT);
      expect(client.status).toBe(200);
      expect(client.text).toBe(RAW);
      const staff = await request(buildApp()).get(r.path).set(STAFF);
      expect(staff.status).toBe(200);
      expect(client.text).toBe(staff.text);
      const hits = producerCalls();
      expect(hits).toHaveLength(2);
      expect(hits[0].url).toBe(r.downstream);
      expect(hits[0].options.method ?? "GET").toBe("GET");
    });
  }

  it("the platform key with no identity and a non-staff email reads nothing (400), and calls no producer", async () => {
    upstream(200, RAW);
    for (const path of ["/v1/catalogue/steps", "/v1/engines/meeting_booked"]) {
      const res = await request(buildApp()).get(path).set({ "X-API-Key": "admin-test-key", "x-email": "founder@client.example" });
      expect(res.status).toBe(400);
    }
    expect(producerCalls()).toHaveLength(0);
  });

  it("staff keep their identity-free platform path (staff console, unchanged)", async () => {
    upstream(200, RAW);
    const res = await request(buildApp()).get("/v1/catalogue/steps").set({ "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" });
    expect(res.status).toBe(200);
    expect(producerCalls()[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/steps`);
  });

  it("a client's runnable-filtered list carries runnable=true, as a customer key does", async () => {
    upstream(200, RAW);
    await request(buildApp()).get("/v1/catalogue/sales-paths?runnable=false&limit=5").set(CLIENT);
    expect(producerCalls()[0].url).toBe(`${FEATURES_BASE}/internal/catalogue/sales-paths?limit=5&runnable=true`);
  });

  it("the staff-only catalogue objects stay staff-only on the dashboard's path", async () => {
    upstream(200, RAW);
    for (const path of ["/v1/catalogue/workflows", "/v1/catalogue/plays"]) {
      const res = await request(buildApp()).get(path).set(CLIENT);
      expect(res.status).toBe(403);
    }
    expect(producerCalls()).toHaveLength(0);
  });
});

describe("Engine read: a client reads the fleet answer, never another org's", () => {
  it("a client's orgId is dropped; other parameters ride verbatim", async () => {
    upstream(200, RAW);
    await request(buildApp()).get("/v1/engines/meeting_booked?orgId=someone-else&featureSlug=x").set(CLIENT);
    expect(producerCalls()[0].url).toBe(`${WORKFLOW_BASE}/internal/engines/meeting_booked?featureSlug=x`);
  });

  it("staff pass orgId as sent, or none for the fleet", async () => {
    upstream(200, RAW);
    await request(buildApp()).get("/v1/engines/meeting_booked?orgId=o2").set({ "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" });
    await request(buildApp()).get("/v1/engines/meeting_booked").set({ "X-API-Key": "admin-test-key", "x-email": "kevin@distribute.you" });
    expect(producerCalls().map((c) => c.url)).toEqual([
      `${WORKFLOW_BASE}/internal/engines/meeting_booked?orgId=o2`,
      `${WORKFLOW_BASE}/internal/engines/meeting_booked`,
    ]);
  });

  it("the producer's refusal comes back with its status and body", async () => {
    upstream(400, '{"error":"Bad is not an outcome key"}');
    const res = await request(buildApp()).get("/v1/engines/Bad").set(CLIENT);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Bad is not an outcome key" });
  });

  it("withoutOrgId keeps every other parameter byte-for-byte", () => {
    expect(withoutOrgId("?a=1&orgId=x&b=%7C")).toBe("?a=1&b=%7C");
    expect(withoutOrgId("?orgId=x")).toBe("");
    expect(withoutOrgId("")).toBe("");
  });
});

describe("every catalogue write still refuses a non-staff client on the dashboard's path", () => {
  const WRITES: Array<[string, string]> = [
    ["post", "/v1/catalogue/steps"],
    ["post", "/v1/catalogue/pipes"],
    ["put", "/v1/catalogue/pipes/a%7Cb/default-play"],
    ["post", "/v1/catalogue/pipes/a%7Cb/retire"],
    ["post", "/v1/catalogue/plays/a%7Cb~c/retire"],
    ["post", "/v1/catalogue/sales-funnels"],
    ["post", "/v1/catalogue/sales-paths"],
    ["post", "/v1/declarations/channels"],
    ["patch", "/v1/strategies/valid-catch-all"],
    ["post", "/v1/scripts"],
    ["post", "/v1/scripts/dynasty/meeting_booked/cold_hello/upgrade"],
    ["post", "/v1/scripts/dynasty/meeting_booked/cold_hello/fork"],
    ["put", "/v1/scripts/dynasty/meeting_booked/cold_hello/status"],
    ["post", "/v1/scripts/dynasty/meeting_booked/cold_hello/replay"],
  ];
  for (const [method, path] of WRITES) {
    it(`${method.toUpperCase()} ${path}: 403, no producer call`, async () => {
      upstream(201, RAW);
      const res = await (request(buildApp()) as any)[method](path).set(CLIENT).send({});
      expect(res.status).toBe(403);
      expect(producerCalls()).toHaveLength(0);
    });
  }

  it("no write is mounted on the Engine path", async () => {
    upstream(201, RAW);
    for (const method of ["post", "put", "patch", "delete"]) {
      const res = await (request(buildApp()) as any)[method]("/v1/engines/meeting_booked").set(STAFF).send({});
      expect(res.status).toBe(404);
    }
    expect(producerCalls()).toHaveLength(0);
  });
});

describe("served openapi", () => {
  it("documents the Engine read and every catalogue read the page needs with its gate", () => {
    const doc = buildDocument() as any;
    const reads = ["/v1/catalogue/tactics", "/v1/catalogue/tactics/{id}", "/v1/catalogue/strategies", "/v1/catalogue/strategies/{id}", "/v1/engines/{outcome}", "/v1/catalogue/steps", "/v1/catalogue/steps/{id}", "/v1/scripts", "/v1/scripts/{id}", "/v1/scripts/dynasty/{outcome}/{dynasty}", "/v1/tactics", "/v1/tactics/{id}", "/v1/strategies", "/v1/strategies/{id}"];
    for (const path of reads) {
      const op = doc.paths[path]?.get;
      expect(op, path).toBeDefined();
      expect(op.description, path).toContain("Any signed-in client reads it");
    }
    expect(doc.paths["/v1/engines/{outcome}"].get.description).toContain("workflow-service GET /internal/engines/{outcome}");
  });
});
