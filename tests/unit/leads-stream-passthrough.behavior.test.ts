import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /v1/leads is a byte-for-byte passthrough of lead-service GET /orgs/leads,
 * piped rather than parsed.
 *
 * The gateway used to `await response.json()` the upstream body and then
 * `res.json()` it back, holding the parsed object graph AND its re-serialized
 * copy at once. The largest brand returns 100–156 MB there, which reached the V8
 * heap limit and killed the process — taking every other org's in-flight request
 * with it, since an OOM is not scoped to the request that caused it.
 *
 * These tests drive the real router with a stubbed `fetch` and assert on what
 * goes over the wire: the exact bytes, the exact downstream URL, and the
 * upstream status + body on a failure.
 */

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import leadsRouter from "../../src/routes/leads.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", leadsRouter);
  return app;
}

const BRAND = "f4d73dab-1f9d-49b2-b16e-63ecde76a5eb";

describe("GET /v1/leads — raw-byte passthrough", () => {
  let capturedUrls: string[];

  beforeEach(() => {
    capturedUrls = [];
  });

  function stubUpstream(body: string, init: ResponseInit = {}) {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrls.push(url);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
        ...init,
      });
    });
  }

  it("returns the upstream bytes unchanged, including key order and number formatting", async () => {
    // Deliberately not what JSON.stringify(JSON.parse(x)) would produce: key
    // order, whitespace and the exponent form all survive only if nothing
    // re-serializes the body.
    const upstream = '{"leads":[{"z":1,"a":"x","n":1e2,"deep":{"b":null}}],  "total":1}';
    stubUpstream(upstream);

    const res = await request(buildApp()).get(`/v1/leads?brandId=${BRAND}`);

    expect(res.status).toBe(200);
    expect(res.text).toBe(upstream);
  });

  it("streams the body without buffering it into a single JS value", async () => {
    // Two chunks: whatever arrives on the wire must be the concatenation, in
    // order, with no separator and no re-encoding.
    const chunks = ['{"leads":[{"id":"a"},', '{"id":"b"}],"total":2}'];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrls.push(url);
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await request(buildApp()).get(`/v1/leads?brandId=${BRAND}`);

    expect(res.status).toBe(200);
    expect(res.text).toBe(chunks.join(""));
    expect(JSON.parse(res.text)).toEqual({ leads: [{ id: "a" }, { id: "b" }], total: 2 });
  });

  it("forwards to lead-service /orgs/leads with every supported query param", async () => {
    stubUpstream('{"leads":[]}');

    await request(buildApp()).get(
      `/v1/leads?brandId=${BRAND}&campaignId=647572d9-729e-4731-9456-28fa351be92c&limit=5&offset=10&view=basic`,
    );

    const call = capturedUrls.find((u) => u.includes("/orgs/leads"));
    expect(call).toBeDefined();
    expect(call).toContain(`brandId=${BRAND}`);
    expect(call).toContain("campaignId=647572d9-729e-4731-9456-28fa351be92c");
    expect(call).toContain("limit=5");
    expect(call).toContain("offset=10");
    expect(call).toContain("view=basic");
  });

  it("passes an upstream failure through with its status and its body", async () => {
    global.fetch = vi.fn().mockImplementation(async () =>
      new Response('{"error":"brand not found","code":"BRAND_NOT_FOUND"}', {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await request(buildApp()).get(`/v1/leads?brandId=${BRAND}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("brand not found");
    expect(res.body.error).toContain("BRAND_NOT_FOUND");
  });

  it("still 400s when neither brandId nor campaignId is given, without calling lead-service", async () => {
    stubUpstream('{"leads":[]}');

    const res = await request(buildApp()).get("/v1/leads");

    expect(res.status).toBe(400);
    expect(capturedUrls).toHaveLength(0);
  });
});
