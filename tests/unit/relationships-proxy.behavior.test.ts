import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { LEAD_BASE } = vi.hoisted(() => {
  const LEAD_BASE = "http://lead.test.local";
  process.env.LEAD_SERVICE_URL = LEAD_BASE;
  process.env.LEAD_SERVICE_API_KEY = "lead-test-key";
  return { LEAD_BASE };
});

/**
 * RELATIONSHIP-TAGS-1014: /v1/brands/:brandId/relationships/* and
 * GET /v1/leads/:id/relationship → lead-service, same suffix. Driven through the
 * real routers with a stubbed fetch: full downstream URL, method, authenticated
 * identity headers, body and query verbatim, upstream status + body verbatim.
 */
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_authenticated";
    req.orgId = "org_authenticated";
    req.runId = "run_1";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import relationshipsRouter from "../../src/routes/relationships.js";
import leadsRouter from "../../src/routes/leads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", relationshipsRouter);
  app.use("/v1", leadsRouter);
  app.use((_req, res) => res.status(404).json({ error: "gateway route not found" }));
  return app;
}

const BRAND = "f4d73dab-1f9d-49b2-b16e-63ecde76a5eb";
const HUMAN = "11111111-1111-1111-1111-111111111111";
const QUESTION = "22222222-2222-2222-2222-222222222222";
const LINK = "33333333-3333-3333-3333-333333333333";
const LEAD = "44444444-4444-4444-4444-444444444444";
const RAW = { relationship: { tags: ["personal"], unsureTags: [] }, aFieldThisGatewayHasNeverHeardOf: 7 };

let calls: Array<{ url: string; init: any }>;
function upstream(status: number, body: unknown) {
  calls = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => upstream(200, RAW));

const CASES: Array<{ name: string; method: "get" | "post" | "put" | "delete"; path: string; downstream: string; body?: unknown }> = [
  { name: "review read", method: "get", path: `/v1/brands/${BRAND}/relationships/review`, downstream: `/orgs/brands/${BRAND}/relationships/review` },
  {
    name: "merge answer",
    method: "post",
    path: `/v1/brands/${BRAND}/relationships/merge-questions/${QUESTION}/answer`,
    downstream: `/orgs/brands/${BRAND}/relationships/merge-questions/${QUESTION}/answer`,
    body: { same: true, aFieldLeadServiceMayAddLater: 1 },
  },
  {
    name: "merge undo",
    method: "post",
    path: `/v1/brands/${BRAND}/relationships/merges/${LINK}/undo`,
    downstream: `/orgs/brands/${BRAND}/relationships/merges/${LINK}/undo`,
    body: {},
  },
  {
    name: "tag state",
    method: "put",
    path: `/v1/brands/${BRAND}/relationships/${HUMAN}/tags/personal`,
    downstream: `/orgs/brands/${BRAND}/relationships/${HUMAN}/tags/personal`,
    body: { state: "yes" },
  },
  {
    name: "tag withdraw",
    method: "delete",
    path: `/v1/brands/${BRAND}/relationships/${HUMAN}/tags/investor`,
    downstream: `/orgs/brands/${BRAND}/relationships/${HUMAN}/tags/investor`,
  },
  {
    name: "company set",
    method: "put",
    path: `/v1/brands/${BRAND}/relationships/${HUMAN}/company`,
    downstream: `/orgs/brands/${BRAND}/relationships/${HUMAN}/company`,
    body: { domain: "acme.com" },
  },
  {
    name: "one lead's relationship",
    method: "get",
    path: `/v1/leads/${LEAD}/relationship?brandId=${BRAND}`,
    downstream: `/orgs/leads/${LEAD}/relationship?brandId=${BRAND}`,
  },
];

describe.each(CASES)("$name", ({ method, path, downstream, body }) => {
  it("reaches the exact lead-service path with the authenticated org and user, body verbatim", async () => {
    let r = request(buildApp())[method](path).set("x-org-id", "org_spoofed_by_caller");
    if (body !== undefined) r = r.send(body as object);
    const res = await r;
    expect(res.status).toBe(200);
    expect(res.body).toEqual(RAW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${LEAD_BASE}${downstream}`);
    expect(calls[0].init.method).toBe(method.toUpperCase());
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-org-id"]).toBe("org_authenticated");
    expect(headers["x-user-id"]).toBe("user_authenticated");
    if (method === "post" || method === "put") {
      if (body && Object.keys(body as object).length) expect(JSON.parse(calls[0].init.body)).toEqual(body);
    } else {
      expect(calls[0].init.body).toBeUndefined();
    }
  });

  it("forwards lead-service's refusal with its own status and body", async () => {
    upstream(404, { error: "merge_question_not_found", code: "x" });
    let r = request(buildApp())[method](path);
    if (body !== undefined) r = r.send(body as object);
    const res = await r;
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "merge_question_not_found", code: "x" });
  });
});

describe("routing", () => {
  it("the literal merge-questions / merges segments never reach a :humanId route", async () => {
    await request(buildApp()).post(`/v1/brands/${BRAND}/relationships/merges/${LINK}/undo`).send({});
    expect(calls[0].url).toBe(`${LEAD_BASE}/orgs/brands/${BRAND}/relationships/merges/${LINK}/undo`);
  });

  it("a path smuggled in a param stays one encoded segment (never an /internal path)", async () => {
    await request(buildApp()).get(`/v1/brands/..%2F..%2Finternal%2Fx/relationships/review`);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${LEAD_BASE}/orgs/brands/..%2F..%2Finternal%2Fx/relationships/review`);
  });
});
