import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * PUT /v1/workflows/:id/status — pass-through to workflow-service
 * PUT /workflows/{id}/status (retire or un-retire ONE version).
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes
 * over the wire: the downstream path, the identity headers, the body, and the
 * upstream body/status on the refusal cases (CLAUDE.md rule #7, corollaries 2 and 3).
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import workflowsRouter from "../../src/routes/workflows.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", workflowsRouter);
  return app;
}

const WF = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const OK_BODY = JSON.stringify({
  id: WF,
  workflowSlug: "sales-email-cold-outreach-sienna-v2",
  workflowDynastySlug: "sales-email-cold-outreach-sienna",
  status: "deprecated",
  version: 2,
  someFieldTheGatewayNeverHeardOf: true,
});

const CONFLICT_BODY = JSON.stringify({
  error: 'Another version of dynasty "sales-email-cold-outreach-sienna" is already active ("…-v3"). Retire it first.',
  existingWorkflowId: "11111111-1111-1111-1111-111111111111",
  existingWorkflowSlug: "sales-email-cold-outreach-sienna-v3",
});

describe("PUT /v1/workflows/:id/status — single-version status pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  function stub(body: string, status: number) {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(body, { status, headers: { "content-type": "application/json" } });
    });
  }

  beforeEach(() => stub(OK_BODY, 200));

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("forwards to workflow-service PUT /workflows/{id}/status", async () => {
    const res = await request(buildApp()).put(`/v1/workflows/${WF}/status`).send({ status: "deprecated" });
    expect(res.status).toBe(200);

    const { url, init } = upstream();
    expect(url.endsWith(`/workflows/${WF}/status`)).toBe(true);
    expect(url).not.toContain("/workflows/dynasty/");
    expect(init.method).toBe("PUT");
  });

  it("forwards the body verbatim, including fields the gateway does not declare", async () => {
    await request(buildApp())
      .put(`/v1/workflows/${WF}/status`)
      .send({ status: "deprecated", reason: "superseded", note: { by: "ops" } });

    expect(JSON.parse(upstream().init.body)).toEqual({
      status: "deprecated",
      reason: "superseded",
      note: { by: "ops" },
    });
  });

  it("forwards the AUTHENTICATED org/user identity, not a caller-supplied one", async () => {
    await request(buildApp())
      .put(`/v1/workflows/${WF}/status`)
      .set("x-org-id", "org_attacker")
      .send({ status: "deprecated" });

    const headers = upstream().init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("returns the upstream body unchanged", async () => {
    const res = await request(buildApp()).put(`/v1/workflows/${WF}/status`).send({ status: "deprecated" });
    expect(res.body).toEqual(JSON.parse(OK_BODY));
  });

  it("passes a 409 conflict through with its machine-readable fields intact", async () => {
    stub(CONFLICT_BODY, 409);
    const res = await request(buildApp()).put(`/v1/workflows/${WF}/status`).send({ status: "active" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual(JSON.parse(CONFLICT_BODY));
  });

  it("passes a 404 through with its upstream body", async () => {
    stub(JSON.stringify({ error: "Workflow not found" }), 404);
    const res = await request(buildApp()).put(`/v1/workflows/${WF}/status`).send({ status: "deprecated" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Workflow not found" });
  });

  it("400s a non-UUID id without calling workflow-service", async () => {
    const res = await request(buildApp()).put("/v1/workflows/not-a-uuid/status").send({ status: "deprecated" });

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("leaves the dynasty status route reaching its own downstream path", async () => {
    await request(buildApp())
      .put("/v1/workflows/dynasty/sales-email-cold-outreach-sienna/status")
      .send({ status: "deprecated" });

    expect(upstream().url.endsWith("/workflows/dynasty/sales-email-cold-outreach-sienna/status")).toBe(true);
  });
});
