import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { FEATURES_BASE } = vi.hoisted(() => {
  const FEATURES_BASE = "http://features.test.local";
  process.env.FEATURES_SERVICE_URL = FEATURES_BASE;
  process.env.FEATURES_SERVICE_API_KEY = "features-test-key";
  return { FEATURES_BASE };
});

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>("../../src/middleware/auth.js");
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.userId = "user_test123";
      req.orgId = "org_test456";
      req.runId = "run_test789";
      req.authType = "user_key";
      next();
    },
  };
});

import featuresRouter from "../../src/routes/features.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", featuresRouter);
  return app;
}

const BODY = { leadId: "lead-1", entries: [{ messageId: "m1", model: { name: "Claude Sonnet", vendor: "Anthropic" }, tactics: [{ line: "Names the brand in the first line", testing: true }] }] };

describe("GET /v1/features/orgs/leads/:leadId/written-by", () => {
  let calls: { url: string; headers: Record<string, string> }[];
  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      return new Response(JSON.stringify(BODY), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
  });

  it("forwards to features-service under the authenticated org, query verbatim, body byte-identical", async () => {
    const res = await request(buildApp())
      .get("/v1/features/orgs/leads/lead-1/written-by?campaignId=camp-9&x=a&x=b")
      .set("x-org-id", "org_attacker");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BODY);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${FEATURES_BASE}/orgs/leads/lead-1/written-by?campaignId=camp-9&x=a&x=b`);
    expect(calls[0].headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].headers["x-user-id"]).toBe("user_test123");
  });

  it("forwards no query string when none is sent", async () => {
    await request(buildApp()).get("/v1/features/orgs/leads/lead-1/written-by");
    expect(calls[0].url).toBe(`${FEATURES_BASE}/orgs/leads/lead-1/written-by`);
  });

  it("forwards an upstream 404 body verbatim under its status", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "Lead not found", code: "lead_not_found" }), { status: 404, headers: { "content-type": "application/json" } })) as any;
    const res = await request(buildApp()).get("/v1/features/orgs/leads/lead-x/written-by");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Lead not found", code: "lead_not_found" });
  });
});
