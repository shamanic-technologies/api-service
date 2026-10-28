import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { WORKFLOW_BASE } = vi.hoisted(() => {
  const WORKFLOW_BASE = "http://workflow.test.local";
  process.env.WORKFLOW_SERVICE_URL = WORKFLOW_BASE;
  process.env.WORKFLOW_SERVICE_API_KEY = "workflow-test-key";
  return { WORKFLOW_BASE };
});

/**
 * THREADS-CAMPAIGN-1028: a workflow is created ON a pipe. POST /v1/workflows forwards its body verbatim
 * (`pipeId` included) and POST /v1/workflows/create forwards a stated `pipeId` (absent = no key).
 */
vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "admin";
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

let calls: Array<{ url: string; options: any }>;
beforeEach(() => {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: "wf-1" }), { status: 201, headers: { "content-type": "application/json" } });
  }) as any;
});

const PIPE = "threads-post|start_to_post_published";

describe("a workflow created on a pipe", () => {
  it("POST /v1/workflows forwards pipeId with the body verbatim", async () => {
    const body = { featureSlug: "threads-post", pipeId: PIPE, name: "x", dag: { nodes: [], edges: [] } };
    const res = await request(buildApp()).post("/v1/workflows").send(body);
    expect(res.status).toBe(201);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/workflows`);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it("POST /v1/workflows/create forwards a stated pipeId", async () => {
    const res = await request(buildApp())
      .post("/v1/workflows/create")
      .send({ featureSlug: "threads-post", pipeId: PIPE, description: "Publish one thread a day on Threads" });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/workflows/create`);
    expect(JSON.parse(calls[0].options.body).pipeId).toBe(PIPE);
  });

  it("POST /v1/workflows/create sends no pipeId key when none is stated", async () => {
    await request(buildApp()).post("/v1/workflows/create").send({ featureSlug: "threads-post", description: "Publish one thread a day on Threads" });
    expect(JSON.parse(calls[0].options.body)).not.toHaveProperty("pipeId");
  });
});
