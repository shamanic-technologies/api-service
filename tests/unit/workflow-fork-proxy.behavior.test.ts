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
 * POST /v1/workflows/:id/fork + /v1/workflows/dynasty/:slug/fork.
 *
 * Drives the real router (real requireStaff, requireOrg, requireUser) with only
 * `authenticate` stubbed to an admin-keyed identity, and a stubbed fetch. Asserts:
 * the full downstream path, the identity forwarded, the body forwarded verbatim,
 * the producer's status + body returned byte-identical (201, 409, 422), and that a
 * NON-staff caller is served too (same access as PUT /v1/workflows/{id}).
 *
 * The payloads below are fixtures, not a contract this repo owns (CLAUDE.md #6/#8).
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
      next();
    },
  };
});

import workflowsRouter from "../../src/routes/workflows.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", workflowsRouter);
  return app;
}

const VERSION_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const STAFF = "kevin@distribute.you";

let calls: Array<{ url: string; options: any }>;

function stubUpstream(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as any;
}

beforeEach(() => {
  calls = [];
});

const CHANGES = [{ op: "add", path: "/nodes/fetch-lead/config/body", value: { acceptedEmails: "valid_and_catch_all" } }];

describe("POST /v1/workflows/:id/fork — over the wire", () => {
  it("forwards path, identity and body verbatim; returns the producer's 201 body", async () => {
    const upstream = {
      workflow: { id: "b1b1b1b1-0000-4000-8000-000000000001", workflowDynastySlug: "sales-cold-email-outreach-vega" },
      sourceWorkflow: { id: VERSION_ID, version: 3 },
      changesApplied: 1,
    };
    stubUpstream(201, upstream);
    const body = { changes: CHANGES, description: "copy" };

    const res = await request(buildApp())
      .post(`/v1/workflows/${VERSION_ID}/fork`)
      .set("x-test-auth-type", "user_key")
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/workflows/${VERSION_ID}/fork`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["X-API-Key"]).toBe("workflow-test-key");
  });

  it("returns the producer's 409 (existing copy) and 422 (change cannot apply) unchanged", async () => {
    stubUpstream(409, { error: "exists", existingWorkflowId: "c2c2c2c2-0000-4000-8000-000000000002", existingWorkflowSlug: "x" });
    let res = await request(buildApp()).post(`/v1/workflows/${VERSION_ID}/fork`).send({ changes: CHANGES });
    expect(res.status).toBe(409);
    expect(res.body.existingWorkflowId).toBe("c2c2c2c2-0000-4000-8000-000000000002");

    stubUpstream(422, { error: 'change 0: no node with id "fetch-lead"', changeIndex: 0 });
    res = await request(buildApp()).post(`/v1/workflows/${VERSION_ID}/fork`).send({ changes: CHANGES });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'change 0: no node with id "fetch-lead"', changeIndex: 0 });
  });

  it("rejects a non-UUID id without calling workflow-service", async () => {
    stubUpstream(201, {});
    const res = await request(buildApp()).post(`/v1/workflows/not-a-uuid/fork`).send({ changes: CHANGES });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /v1/workflows/dynasty/:slug/fork — over the wire", () => {
  it("forwards to the dynasty route with the slug encoded", async () => {
    stubUpstream(201, { workflow: { id: "x" } });
    const res = await request(buildApp())
      .post(`/v1/workflows/dynasty/sales-cold-email-outreach-lyonesse/fork`)
      .send({ changes: CHANGES });
    expect(res.status).toBe(201);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/workflows/dynasty/sales-cold-email-outreach-lyonesse/fork`);
  });
});
