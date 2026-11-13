import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * POST /v1/features/unit-reports — pass-through to features-service POST /orgs/unit-reports
 * (SCRIPT-VALUE-RATING-1113). Driven through the real router with a stubbed `fetch`: the
 * downstream path, the AUTHENTICATED identity, the body verbatim both ways, and the
 * producer's status (201 / 400 refusal) are what goes over the wire.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "user_key";
    next();
  },
  authenticatePlatform: (_req: any, _res: any, next: any) => next(),
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  requireStaff: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const REPORT = {
  outcomeKey: "message_written",
  subjectService: "content-generation",
  subjectId: "gen-1",
  kind: "reported",
  source: "mcp",
  note: "wrong first name",
  unitAt: "2026-11-10T09:30:00.000Z",
  aFieldThisGatewayHasNeverHeardOf: 7,
};

const STORED = JSON.stringify({ ...REPORT, id: "r1", orgId: "org_authenticated", userId: "user_test123", reportedAt: "2026-11-13T10:00:00.000Z" });

function stubFetch(body: string, status: number) {
  const calls: Array<{ url: string; init: any }> = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

describe("POST /v1/features/unit-reports", () => {
  let calls: Array<{ url: string; init: any }>;
  beforeEach(() => {
    calls = stubFetch(STORED, 201);
  });

  it("forwards to features-service POST /orgs/unit-reports and keeps its 201 + body", async () => {
    const res = await request(buildApp()).post("/v1/features/unit-reports").send(REPORT);
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe("/orgs/unit-reports");
    expect(calls[0].init.method).toBe("POST");
    expect(res.body).toEqual(JSON.parse(STORED));
  });

  it("forwards the request body verbatim, fields it does not know included", async () => {
    await request(buildApp()).post("/v1/features/unit-reports").send(REPORT);
    expect(JSON.parse(calls[0].init.body)).toEqual(REPORT);
  });

  it("carries the AUTHENTICATED org and user, never caller-supplied ones", async () => {
    await request(buildApp())
      .post("/v1/features/unit-reports")
      .set("x-org-id", "org_spoofed")
      .set("x-user-id", "user_spoofed")
      .send(REPORT);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("forwards a malformed report's refusal with the producer's status and body", async () => {
    const refusal = { error: "kind must be edited or reported", code: "unit_report_unrecognised" };
    stubFetch(JSON.stringify(refusal), 400);
    const res = await request(buildApp()).post("/v1/features/unit-reports").send({ kind: "loved" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(refusal);
  });
});

describe("GET /v1/features/unit-reports", () => {
  const LIST = JSON.stringify({ reports: [{ id: "r2", kind: "edited" }, { id: "r1", kind: "reported" }], aFieldThisGatewayHasNeverHeardOf: 7 });

  it("forwards to features-service GET /orgs/unit-reports with the query verbatim, not as a feature slug", async () => {
    const calls = stubFetch(LIST, 200);
    const res = await request(buildApp()).get("/v1/features/unit-reports?subjectService=content-generation&subjectId=gen-1&outcomeKey=message_written&later=x");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/orgs/unit-reports");
    expect(url.search).toBe("?subjectService=content-generation&subjectId=gen-1&outcomeKey=message_written&later=x");
    expect(res.body).toEqual(JSON.parse(LIST));
  });

  it("reads under the AUTHENTICATED org, never a caller-supplied one", async () => {
    const calls = stubFetch(LIST, 200);
    await request(buildApp()).get("/v1/features/unit-reports?subjectService=s&subjectId=i").set("x-org-id", "org_spoofed");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_test123");
  });

  it("forwards the producer's refusal with its status and body", async () => {
    const refusal = { error: "subjectService and subjectId are required", reason: "unit_report_query_unrecognised" };
    stubFetch(JSON.stringify(refusal), 400);
    const res = await request(buildApp()).get("/v1/features/unit-reports");
    expect(res.status).toBe(400);
    expect(res.body).toEqual(refusal);
  });
});
