import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/workflows/summaries — pass-through to workflow-service GET /workflows/summaries
 * (what each workflow does, without its DAG). Driven through the real router with a stubbed
 * `fetch`: asserts the downstream path, the verbatim query, the authenticated org and the
 * byte-identical body, and that `/workflows/:id` does not swallow the literal.
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
  requireStaff: (_req: any, _res: any, next: any) => next(),
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

const BODY = JSON.stringify({
  workflows: [
    {
      id: "8f0c2a7e-0000-4000-8000-000000000001",
      workflowSlug: "ai-meeting-booking-torcular-v4",
      workflowDynastySlug: "ai-meeting-booking-torcular",
      description: "Books a meeting.",
      futureField: 1,
    },
  ],
});

describe("GET /v1/workflows/summaries — pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(BODY, { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  it("forwards to /workflows/summaries with the query verbatim, the authenticated org, the body untouched", async () => {
    const query = "?featureSlug=ai-meeting-booking&status=all&extra=a&extra=b";
    const res = await request(buildApp()).get(`/v1/workflows/summaries${query}`).set("x-org-id", "org_someone_else");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(BODY));
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.pathname + u.search).toBe(`/workflows/summaries${query}`);
    expect(calls[0].init.headers["x-org-id"]).toBe("org_authenticated");
  });

  it("relays a downstream 400 field-for-field", async () => {
    global.fetch = vi.fn().mockImplementation(async () =>
      new Response('{"error":"bad status","code":"invalid_status"}', { status: 400, headers: { "content-type": "application/json" } }),
    );
    const res = await request(buildApp()).get("/v1/workflows/summaries?status=nope");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad status", code: "invalid_status" });
  });
});
