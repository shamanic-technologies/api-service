import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * DEPRECATION-REASON-1020: on the three workflow deprecation doors (dynasty status,
 * per-version status, retire-by-content) the staff member's `reason` / `decidedBy`
 * reach workflow-service intact, and the staff actor's email travels as `x-email`
 * so workflow-service records a person as "decided by". Driven through the real
 * router with a stubbed fetch: asserts what goes over the wire.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_authenticated";
    req.runId = "run_test789";
    req.authType = "user_key";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireStaff: (_req: any, _res: any, next: any) => next(),
  // requireStaffActor sets the staff email from an authenticated source.
  requireStaffActor: (req: any, _res: any, next: any) => {
    req.staffEmail = "kevin@distribute.you";
    next();
  },
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
const DOORS: Array<[string, "put" | "post", string, Record<string, unknown>]> = [
  ["dynasty status", "put", "/v1/workflows/dynasty/sales-email-cold-outreach-sienna/status", { status: "deprecated" }],
  ["version status", "put", `/v1/workflows/${WF}/status`, { status: "deprecated" }],
  ["retire-by-content", "post", "/v1/workflows/retire-by-content", { promptType: "cold-email-v59" }],
];

describe("workflow deprecation doors relay the reason and the staff actor", () => {
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  it("dynasty status: forwards {status, reason} to workflow-service (no longer dropped)", async () => {
    const res = await request(buildApp())
      .put("/v1/workflows/dynasty/sales-email-cold-outreach-sienna/status")
      .send({ status: "deprecated", reason: "Spam complaints above 0.3% on Gmail" });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith("/workflows/dynasty/sales-email-cold-outreach-sienna/status")).toBe(true);
    expect(JSON.parse(calls[0].init.body)).toEqual({
      status: "deprecated",
      reason: "Spam complaints above 0.3% on Gmail",
    });
  });

  it("dynasty status: still accepts a deprecation without a reason (producer decides)", async () => {
    const res = await request(buildApp())
      .put("/v1/workflows/dynasty/sales-email-cold-outreach-sienna/status")
      .send({ status: "deprecated" });
    expect(res.status).toBe(200);
    expect(JSON.parse(calls[0].init.body)).toEqual({ status: "deprecated" });
  });

  for (const [name, method, path, base] of DOORS) {
    it(`${name}: forwards reason + decidedBy verbatim and the staff email as x-email`, async () => {
      const body = { ...base, reason: "Replaced by v4", decidedBy: "ops@distribute.you" };
      const res = await request(buildApp())[method](path).set("x-email", "attacker@example.com").send(body);

      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(JSON.parse(calls[0].init.body)).toEqual(body);
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers["x-email"]).toBe("kevin@distribute.you");
      expect(headers["x-org-id"]).toBe("org_authenticated");
      expect(headers["x-user-id"]).toBe("user_test123");
    });
  }
});
