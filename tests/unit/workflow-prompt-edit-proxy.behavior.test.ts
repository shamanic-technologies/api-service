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
 * POST /v1/workflows/:id/prompt-edit + /v1/workflows/dynasty/:slug/prompt-edit.
 *
 * Drives the real router (real requireStaff, requireOrg, requireUser) with only
 * `authenticate` stubbed to an admin-keyed identity, and a stubbed fetch. Asserts:
 * the full downstream path, the identity forwarded, the body forwarded verbatim,
 * the producer's status + body returned byte-identical (201, 409, 422), and that a
 * non-staff caller is refused before workflow-service is called.
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

describe("POST /v1/workflows/:id/prompt-edit — over the wire", () => {
  it("forks: forwards path, identity and body verbatim; returns the producer's 201 body", async () => {
    const upstream = {
      action: "forked",
      workflow: { id: "b1b1b1b1-0000-4000-8000-000000000001", workflowDynastySlug: "sales-email-new" },
      sourceWorkflow: { id: VERSION_ID, version: 3 },
    };
    stubUpstream(201, upstream);
    const body = { action: "fork", prompt: "Hi {{firstName}}", extra: "kept" };

    const res = await request(buildApp())
      .post(`/v1/workflows/${VERSION_ID}/prompt-edit`)
      .set("x-email", STAFF)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstream);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/workflows/${VERSION_ID}/prompt-edit`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
    expect(calls[0].options.headers["x-run-id"]).toBe("run_test789");
    expect(calls[0].options.headers["X-API-Key"]).toBe("workflow-test-key");
  });

  it("returns the producer's 422 with its readable error and variable lists intact", async () => {
    const upstream = {
      error: "The edited prompt drops {{companyName}}, which the workflow fills in.",
      droppedVariables: ["companyName"],
      addedVariables: [],
      requiredVariables: ["firstName", "companyName"],
    };
    stubUpstream(422, upstream);

    const res = await request(buildApp())
      .post(`/v1/workflows/${VERSION_ID}/prompt-edit`)
      .set("x-email", STAFF)
      .send({ action: "upgrade", prompt: "Hi {{firstName}}" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual(upstream);
  });

  it("returns the producer's 409 unchanged (not collapsed into 500)", async () => {
    const upstream = { error: "Version is superseded", activeWorkflowId: "c2c2c2c2-0000-4000-8000-000000000002" };
    stubUpstream(409, upstream);

    const res = await request(buildApp())
      .post(`/v1/workflows/${VERSION_ID}/prompt-edit`)
      .set("x-email", STAFF)
      .send({ action: "upgrade", prompt: "x" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(upstream);
  });

  it("rejects a non-UUID id without calling workflow-service", async () => {
    stubUpstream(201, {});
    const res = await request(buildApp())
      .post(`/v1/workflows/not-a-uuid/prompt-edit`)
      .set("x-email", STAFF)
      .send({ action: "fork", prompt: "x" });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /v1/workflows/dynasty/:slug/prompt-edit — over the wire", () => {
  it("upgrades: forwards to the dynasty twin and returns the producer's 201 body", async () => {
    const upstream = { action: "upgraded", workflow: { id: "d3d3d3d3-0000-4000-8000-000000000003", version: 4 } };
    stubUpstream(201, upstream);
    const body = { action: "upgrade", prompt: "Hello {{firstName}}" };

    const res = await request(buildApp())
      .post(`/v1/workflows/dynasty/sales-email-cold-outreach-sienna/prompt-edit`)
      .set("x-email", STAFF)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstream);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/workflows/dynasty/sales-email-cold-outreach-sienna/prompt-edit`);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
  });
});

describe("prompt-edit — staff gate", () => {
  it.each([
    ["/v1/workflows/3fa85f64-5717-4562-b3fc-2c963f66afa6/prompt-edit"],
    ["/v1/workflows/dynasty/some-dynasty/prompt-edit"],
  ])("refuses a non-staff email on %s, producer never called", async (path) => {
    stubUpstream(201, {});
    const res = await request(buildApp())
      .post(path)
      .set("x-email", "customer@example.com")
      .send({ action: "fork", prompt: "x" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a user-key caller even with a staff email", async () => {
    stubUpstream(201, {});
    const res = await request(buildApp())
      .post(`/v1/workflows/${VERSION_ID}/prompt-edit`)
      .set("x-test-auth-type", "user_key")
      .set("x-email", STAFF)
      .send({ action: "fork", prompt: "x" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a caller with no email", async () => {
    stubUpstream(201, {});
    const res = await request(buildApp())
      .post(`/v1/workflows/${VERSION_ID}/prompt-edit`)
      .send({ action: "fork", prompt: "x" });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
