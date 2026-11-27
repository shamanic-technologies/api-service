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
 * RCE-WORKFLOWS-1127: a workflow DAG is code (script nodes run on our Windmill workers).
 * Every route that creates, changes, forks, generates or runs a workflow is staff only.
 *
 * Drives the real router (real requireStaffActor / requireStaff, requireOrg, requireUser) with
 * only `authenticate` stubbed and a stubbed fetch. Both directions:
 *  - a client key, and the platform key relaying a customer session (non-staff or no x-email),
 *    get 403 BEFORE workflow-service is called;
 *  - a pinned staff user's key and the admin console (platform key + staff x-email) reach
 *    workflow-service on the exact downstream path.
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

import workflowsRouter from "../../src/routes/workflows.js";
import { buildDocument, STAFF_KEY_OPERATIONS } from "../../src/openapi/document.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", workflowsRouter);
  return app;
}

const STAFF = "kevin@distribute.you";
const WF_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

/** The shape of the 2026-11-20 attack: a script node running a shell command. */
const SCRIPT_DAG = {
  nodes: [{ id: "x", type: "script", config: { code: "const cp=require('child_process');return cp.execSync('cat /proc/1/environ').toString()" } }],
  edges: [],
};

let calls: Array<{ url: string; options: any }>;

beforeEach(() => {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: WF_ID, ok: true }), { status: 201, headers: { "content-type": "application/json" } });
  }) as any;
});

const CODE_DOORS: Array<{ method: "post" | "put"; path: string; op: string; downstream: string; body: Record<string, unknown> }> = [
  { method: "post", path: "/v1/workflows", op: "POST /v1/workflows", downstream: "/workflows", body: { name: "probe", featureSlug: "x", dag: SCRIPT_DAG } },
  { method: "put", path: `/v1/workflows/${WF_ID}`, op: "PUT /v1/workflows/{id}", downstream: `/workflows/${WF_ID}`, body: { dag: SCRIPT_DAG } },
  { method: "post", path: `/v1/workflows/${WF_ID}/fork`, op: "POST /v1/workflows/{id}/fork", downstream: `/workflows/${WF_ID}/fork`, body: { changes: [{ node: "x", config: SCRIPT_DAG.nodes[0].config }] } },
  { method: "post", path: "/v1/workflows/dynasty/dy-probe/fork", op: "POST /v1/workflows/dynasty/{workflowDynastySlug}/fork", downstream: "/workflows/dynasty/dy-probe/fork", body: { changes: [] } },
  { method: "post", path: `/v1/workflows/${WF_ID}/execute`, op: "POST /v1/workflows/{id}/execute", downstream: `/workflows/${WF_ID}/execute`, body: { inputs: {} } },
  { method: "post", path: "/v1/workflows/create", op: "POST /v1/workflows/create", downstream: "/workflows/create", body: { featureSlug: "x", description: "run a shell command" } },
  { method: "post", path: "/v1/workflows/upgrade", op: "POST /v1/workflows/upgrade", downstream: "/workflows/upgrade", body: { workflowDynastySlug: "dy-probe", dag: SCRIPT_DAG } },
];

describe("RCE-WORKFLOWS-1127: non-staff callers are refused before workflow-service", () => {
  for (const d of CODE_DOORS) {
    it(`${d.op}: a client key gets 403 staff_only`, async () => {
      const res = await (request(buildApp()) as any)[d.method](d.path)
        .set("x-test-auth-type", "user_key")
        .set("x-test-key-email", "attacker@euploading.com")
        .send(d.body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("staff_only");
      expect(calls).toHaveLength(0);
    });

    it(`${d.op}: a client key whose stored email is a staff address but whose user is not pinned staff gets 403`, async () => {
      const res = await (request(buildApp()) as any)[d.method](d.path)
        .set("x-test-auth-type", "user_key")
        .set("x-test-key-email", STAFF)
        .set("x-test-key-staff", "false")
        .send(d.body);
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it(`${d.op}: the platform key relaying a customer browser session gets 403`, async () => {
      const res = await (request(buildApp()) as any)[d.method](d.path).set("x-email", "customer@example.com").send(d.body);
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it(`${d.op}: the platform key with no x-email gets 403`, async () => {
      const res = await (request(buildApp()) as any)[d.method](d.path).send(d.body);
      expect(res.status).toBe(403);
      expect(calls).toHaveLength(0);
    });
  }
});

describe("RCE-WORKFLOWS-1127: staff still reach workflow-service", () => {
  for (const d of CODE_DOORS) {
    it(`${d.op}: a pinned staff user's key reaches ${d.downstream}`, async () => {
      const res = await (request(buildApp()) as any)[d.method](d.path)
        .set("x-test-auth-type", "user_key")
        .set("x-test-key-email", STAFF)
        .set("x-test-key-staff", "true")
        .send(d.body);
      expect(res.status).toBeLessThan(300);
      expect(calls.filter((c) => c.url === `${WORKFLOW_BASE}${d.downstream}`)).toHaveLength(1);
    });

    it(`${d.op}: the admin console (platform key + staff x-email) reaches ${d.downstream}`, async () => {
      const res = await (request(buildApp()) as any)[d.method](d.path).set("x-email", STAFF).send(d.body);
      expect(res.status).toBeLessThan(300);
      expect(calls.filter((c) => c.url === `${WORKFLOW_BASE}${d.downstream}`)).toHaveLength(1);
    });
  }
});

describe("RCE-WORKFLOWS-1127: the customer document no longer offers the code doors", () => {
  it("every code door is a staff-key operation, absent from the public document, present for a staff key", () => {
    const pub = buildDocument() as any;
    const staffKey = buildDocument({ audience: "staff-key" } as any) as any;
    for (const d of CODE_DOORS) {
      expect(STAFF_KEY_OPERATIONS.has(d.op)).toBe(true);
      const [method, path] = d.op.split(" ");
      expect(pub.paths?.[path]?.[method.toLowerCase()]).toBeUndefined();
      expect(staffKey.paths?.[path]?.[method.toLowerCase()]).toBeDefined();
    }
  });
});
