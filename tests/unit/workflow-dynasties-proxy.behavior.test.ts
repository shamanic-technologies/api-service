import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/workflows/dynasties — pass-through to workflow-service GET /workflows/dynasties.
 *
 * Driven through the real router with a stubbed `fetch`, so these assert what goes over
 * the wire: the downstream path, the identity headers, the forwarded query string and the
 * body. A source-substring test cannot see what a template literal interpolates, and cannot
 * see identity at all (CLAUDE.md rule #7, corollaries 2 and 3).
 *
 * The query assertions are the point of the route: workflow-service is adding a way to
 * scope this listing to one feature, and the gateway must not need a release to let that
 * parameter through.
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

const DYNASTIES_BODY = JSON.stringify({
  dynasties: [
    {
      workflowDynastySlug: "sales-email-cold-outreach-sienna",
      workflowDynastyName: "Cold outreach",
      workflowSlugs: ["sales-email-cold-outreach-sienna-v1", "sales-email-cold-outreach-sienna-v2"],
      unknownDownstreamField: 7,
    },
  ],
});

describe("GET /v1/workflows/dynasties — dynasty listing pass-through", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(DYNASTIES_BODY, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  });

  function upstream() {
    expect(calls).toHaveLength(1);
    return calls[0];
  }

  it("forwards to workflow-service GET /workflows/dynasties", async () => {
    const res = await request(buildApp()).get("/v1/workflows/dynasties");
    expect(res.status).toBe(200);

    const { url, init } = upstream();
    expect(url.endsWith("/workflows/dynasties")).toBe(true);
    expect(init.method ?? "GET").toBe("GET");
  });

  it("is not swallowed by GET /v1/workflows/:id — no by-id enrichment fires", async () => {
    const res = await request(buildApp()).get("/v1/workflows/dynasties");
    // The by-id handler would 400 on a non-UUID id, and it also fans out to
    // /workflows/{id}/required-providers. Exactly one upstream call, and a 200.
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain("required-providers");
  });

  it("forwards the caller's query string verbatim, including parameters the gateway does not declare", async () => {
    await request(buildApp()).get(
      "/v1/workflows/dynasties?featureSlug=sales-email&someFutureScope=abc&tag=a&tag=b&q=%20spaced%20",
    );
    const { url } = upstream();
    expect(url).toContain("/workflows/dynasties?");
    const query = url.slice(url.indexOf("?"));
    expect(query).toBe("?featureSlug=sales-email&someFutureScope=abc&tag=a&tag=b&q=%20spaced%20");
  });

  it("sends no query string when the caller sent none", async () => {
    await request(buildApp()).get("/v1/workflows/dynasties");
    expect(upstream().url).not.toContain("?");
  });

  it("forwards the authenticated identity, not a caller-supplied org", async () => {
    await request(buildApp())
      .get("/v1/workflows/dynasties?orgId=org_attacker")
      .set("x-org-id", "org_attacker");

    const { init } = upstream();
    const headers = init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("returns the upstream body byte-identical, unknown fields included", async () => {
    const res = await request(buildApp()).get("/v1/workflows/dynasties");
    expect(res.body).toEqual(JSON.parse(DYNASTIES_BODY));
  });

  it("re-emits an upstream error body field-for-field under its own status", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "nope", code: "SOME_CODE" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await request(buildApp()).get("/v1/workflows/dynasties");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "nope", code: "SOME_CODE" });
  });
});
