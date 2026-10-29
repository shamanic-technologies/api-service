import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load, so set it before the router imports.
const { WORKFLOW_BASE } = vi.hoisted(() => {
  const WORKFLOW_BASE = "http://workflow.test.local";
  process.env.WORKFLOW_SERVICE_URL = WORKFLOW_BASE;
  process.env.WORKFLOW_SERVICE_API_KEY = "workflow-test-key";
  return { WORKFLOW_BASE };
});

/**
 * /v1/scripts* (FACTORY-P2-ENGINES): byte passthroughs to workflow-service.
 *
 * Drives the real router (real requireStaffActor, requireOrg, requireUser) with only `authenticate`
 * stubbed, and a stubbed fetch. Asserts the full downstream path, identity + staff x-email forwarded,
 * the body verbatim, the producer's status + body byte-identical, and the staff gate on the five
 * writes (a client key refused before workflow-service is called; a staff member's own key passes).
 * Payloads are fixtures, not a contract this repo owns (CLAUDE.md #6/#8).
 */

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = req.headers["x-test-auth-type"] ?? "admin";
      if (req.authType === "user_key") {
        req.userKeyScope = {
          isStaff: req.headers["x-test-key-staff"] === "true",
          email: req.headers["x-test-key-email"],
          memberships: [],
        };
      }
      next();
    },
  };
});

import scriptsRouter from "../../src/routes/scripts.js";
import { buildDocument, STAFF_KEY_OPERATIONS } from "../../src/openapi/document.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", scriptsRouter);
  return app;
}

const STAFF = "kevin@distribute.you";
const SCRIPT_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

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

const STAFF_WRITES: Array<{ method: "post" | "put"; path: string; downstream: string; body: Record<string, unknown> }> = [
  { method: "post", path: "/v1/scripts", downstream: "/scripts", body: { outcome: "message_written", dynasty: "dy_hook", code: "export default async function run(){return null}", description: "d" } },
  { method: "post", path: "/v1/scripts/dynasty/message_written/dy_hook/upgrade", downstream: "/scripts/dynasty/message_written/dy_hook/upgrade", body: { code: "x" } },
  { method: "post", path: "/v1/scripts/dynasty/message_written/dy_hook/fork", downstream: "/scripts/dynasty/message_written/dy_hook/fork", body: { dynasty: "dy_hook2", description: "d" } },
  { method: "put", path: "/v1/scripts/dynasty/message_written/dy_hook/status", downstream: "/scripts/dynasty/message_written/dy_hook/status", body: { status: "deprecated", reason: "r" } },
  { method: "post", path: "/v1/scripts/dynasty/message_written/dy_hook/replay", downstream: "/scripts/dynasty/message_written/dy_hook/replay", body: { code: "x" } },
];

describe("staff writes — over the wire", () => {
  for (const w of STAFF_WRITES) {
    it(`${w.method.toUpperCase()} ${w.path}: forwards path, identity, staff email and body; returns the producer's status + body`, async () => {
      const upstream = { id: SCRIPT_ID, scriptSlug: "message_written/dy_hook/v1", extra: { kept: true } };
      stubUpstream(201, upstream);

      const res = await (request(buildApp()) as any)[w.method](w.path).set("x-email", STAFF).send(w.body);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(upstream);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${WORKFLOW_BASE}${w.downstream}`);
      expect(calls[0].options.method).toBe(w.method.toUpperCase());
      expect(JSON.parse(calls[0].options.body)).toEqual(w.body);
      expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
      expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
      expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
      expect(calls[0].options.headers["x-email"]).toBe(STAFF);
      expect(calls[0].options.headers["X-API-Key"]).toBe("workflow-test-key");
    });

    it(`${w.method.toUpperCase()} ${w.path}: a client key gets 403 staff_only, workflow-service never called`, async () => {
      stubUpstream(201, {});
      const res = await (request(buildApp()) as any)[w.method](w.path)
        .set("x-test-auth-type", "user_key")
        .set("x-test-key-staff", "false")
        .set("x-test-key-email", "client@acme.com")
        .send(w.body);
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it(`${w.method.toUpperCase()} ${w.path}: listed in STAFF_KEY_OPERATIONS`, () => {
      const templated = w.path.replace("/message_written/dy_hook", "/{outcome}/{dynasty}");
      expect(STAFF_KEY_OPERATIONS.has(`${w.method.toUpperCase()} ${templated}`)).toBe(true);
    });
  }

  it("a staff member's own key passes and its stored email is the author", async () => {
    stubUpstream(201, { ok: true });
    const res = await request(buildApp())
      .post("/v1/scripts")
      .set("x-test-auth-type", "user_key")
      .set("x-test-key-staff", "true")
      .set("x-test-key-email", STAFF)
      .send({ outcome: "message_written" });
    expect(res.status).toBe(201);
    expect(calls[0].options.headers["x-email"]).toBe(STAFF);
  });

  it("the producer's 422 replay_failed reaches the caller field-for-field", async () => {
    const upstream = { error: "replay failed on 2 of 40 cases", code: "replay_failed", details: { failures: [{ id: "c1" }] } };
    stubUpstream(422, upstream);
    const res = await request(buildApp())
      .post("/v1/scripts/dynasty/message_written/dy_hook/upgrade")
      .set("x-email", STAFF)
      .send({ code: "x" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual(upstream);
  });

  it("the producer's 409 stays a 409", async () => {
    const upstream = { error: "dynasty exists", code: "dynasty_exists" };
    stubUpstream(409, upstream);
    const res = await request(buildApp()).post("/v1/scripts").set("x-email", STAFF).send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual(upstream);
  });
});

describe("reads — any authenticated org + user, client key included", () => {
  const READS = [
    { path: "/v1/scripts?outcome=message_written&status=all&status=x", downstream: "/scripts?outcome=message_written&status=all&status=x" },
    { path: `/v1/scripts/${SCRIPT_ID}`, downstream: `/scripts/${SCRIPT_ID}` },
    { path: "/v1/scripts/dynasty/message_written/dy_hook", downstream: "/scripts/dynasty/message_written/dy_hook" },
  ];
  for (const r of READS) {
    it(`GET ${r.path}: client key → producer's 200 body, query verbatim`, async () => {
      const upstream = { scripts: [{ id: SCRIPT_ID }], cases: 3 };
      stubUpstream(200, upstream);
      const res = await request(buildApp())
        .get(r.path)
        .set("x-test-auth-type", "user_key")
        .set("x-test-key-staff", "false")
        .set("x-test-key-email", "client@acme.com");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(upstream);
      expect(calls[0].url).toBe(`${WORKFLOW_BASE}${r.downstream}`);
      expect(calls[0].options.method).toBe("GET");
      expect(calls[0].options.body).toBeUndefined();
      expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    });
  }

  it("a producer 404 stays a 404 with its body", async () => {
    stubUpstream(404, { error: "no script message_written/nope" });
    const res = await request(buildApp()).get("/v1/scripts/dynasty/message_written/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "no script message_written/nope" });
  });
});

describe("served documents", () => {
  const pub = buildDocument() as any;
  const staff = buildDocument({ audience: "staff-key" }) as any;

  it("the customer document carries the 3 reads and none of the 5 writes", () => {
    expect(pub.paths["/v1/scripts"].get).toBeDefined();
    expect(pub.paths["/v1/scripts/{id}"].get).toBeDefined();
    expect(pub.paths["/v1/scripts/dynasty/{outcome}/{dynasty}"].get).toBeDefined();
    expect(pub.paths["/v1/scripts"].post).toBeUndefined();
    for (const a of ["upgrade", "fork", "replay"]) expect(pub.paths[`/v1/scripts/dynasty/{outcome}/{dynasty}/${a}`]).toBeUndefined();
    expect(pub.paths["/v1/scripts/dynasty/{outcome}/{dynasty}/status"]).toBeUndefined();
  });

  it("the staff key's document carries all 8, writes x-staff-only, with the run(ctx) contract", () => {
    expect(staff.paths["/v1/scripts"].post["x-staff-only"]).toBe(true);
    expect(staff.paths["/v1/scripts/dynasty/{outcome}/{dynasty}/upgrade"].post["x-staff-only"]).toBe(true);
    expect(staff.paths["/v1/scripts/dynasty/{outcome}/{dynasty}/fork"].post["x-staff-only"]).toBe(true);
    expect(staff.paths["/v1/scripts/dynasty/{outcome}/{dynasty}/status"].put["x-staff-only"]).toBe(true);
    expect(staff.paths["/v1/scripts/dynasty/{outcome}/{dynasty}/replay"].post["x-staff-only"]).toBe(true);
    expect(staff.paths["/v1/scripts/{id}"].get).toBeDefined();
    const create = JSON.stringify(staff.paths["/v1/scripts"].post);
    for (const token of ["run(ctx)", "ctx.get", "llm.complete", "ctx.storage", "replay_failed", "catalogue step", "no deploy"]) {
      expect(create, token).toContain(token);
    }
  });
});
