import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// externalServices snapshots *_SERVICE_URL at module load, so set them before the routers import.
const { EMAILGEN_BASE, WORKFLOW_BASE } = vi.hoisted(() => {
  const EMAILGEN_BASE = "http://content.test.local";
  const WORKFLOW_BASE = "http://workflow.test.local";
  process.env.CONTENT_GENERATION_SERVICE_URL = EMAILGEN_BASE;
  process.env.CONTENT_GENERATION_SERVICE_API_KEY = "content-test-key";
  process.env.WORKFLOW_SERVICE_URL = WORKFLOW_BASE;
  process.env.WORKFLOW_SERVICE_API_KEY = "workflow-test-key";
  process.env.ADMIN_DISTRIBUTE_API_KEY = "platform-test-key";
  return { EMAILGEN_BASE, WORKFLOW_BASE };
});

/**
 * TEMPLATE-MODEL-STATUS-1019: staff status of templates / writer models, a template's last
 * outputs, retire-by-content, and the dynasty / version status routes, now staff only.
 *
 * Drives the real routers and the real staff gates (requireStaff, requireStaffActor,
 * authenticatePlatform). Only `authenticate` / `authenticateUser` are stubbed (they call
 * client-service). Asserts the full downstream URL, the forwarded body, the producer's
 * status + body byte-identical, and that a non-staff caller is refused BEFORE any
 * downstream call. Payloads are fixtures, not a contract this repo owns.
 */

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/middleware/auth.js")>(
    "../../src/middleware/auth.js",
  );
  const stub = (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.authType = req.headers["x-test-auth-type"] ?? "admin";
    if (req.authType === "user_key") {
      req.userKeyScope = {
        isStaff: req.headers["x-test-key-staff"] === "true",
        email: req.headers["x-test-key-email"],
        memberships: [],
      };
    }
    next();
  };
  return { ...actual, authenticate: stub, authenticateUser: stub };
});

import contentRouter from "../../src/routes/content.js";
import workflowsRouter from "../../src/routes/workflows.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", workflowsRouter);
  app.use("/v1", contentRouter);
  return app;
}

const STAFF = "kevin@distribute.you";
const PLATFORM_KEY = "platform-test-key";

let calls: Array<{ url: string; options: any }>;

function stubUpstream(status: number, body: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as any;
}

beforeEach(() => {
  calls = [];
});

const staffPlatform = (r: request.Test) => r.set("x-api-key", PLATFORM_KEY).set("x-email", STAFF);

describe("content-generation template / model status (staff)", () => {
  it("GET /v1/content/templates pipes GET /internal/templates byte-identical", async () => {
    const upstream = { templates: [{ type: "cold-email-v59", status: "active", fieldNobodyDeclared: 1 }] };
    stubUpstream(200, upstream);
    const res = await staffPlatform(request(buildApp()).get("/v1/content/templates"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls[0].url).toBe(`${EMAILGEN_BASE}/internal/templates`);
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers["X-API-Key"]).toBe("content-test-key");
  });

  it("GET /v1/content/models pipes GET /internal/models", async () => {
    stubUpstream(200, { models: [{ model: "glm-pro", status: "active" }] });
    const res = await staffPlatform(request(buildApp()).get("/v1/content/models"));
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${EMAILGEN_BASE}/internal/models`);
  });

  it("PUT /v1/content/templates/:type/status forwards the body and the producer's 404 verbatim", async () => {
    const upstream = { error: "No template found for type=nope" };
    stubUpstream(404, upstream);
    const res = await staffPlatform(request(buildApp()).put("/v1/content/templates/nope/status")).send({ status: "deprecated" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(upstream);
    expect(calls[0].url).toBe(`${EMAILGEN_BASE}/internal/templates/nope/status`);
    expect(calls[0].options.method).toBe("PUT");
    expect(JSON.parse(calls[0].options.body)).toEqual({ status: "deprecated" });
  });

  it("PUT /v1/content/models/:model/status hits the full downstream path", async () => {
    stubUpstream(200, { model: "glm-pro", status: "deprecated" });
    const res = await staffPlatform(request(buildApp()).put("/v1/content/models/glm-pro/status")).send({ status: "deprecated" });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${EMAILGEN_BASE}/internal/models/glm-pro/status`);
  });

  it.each([
    ["/v1/content/templates/cold-email-v59/status", "/internal/templates/cold-email-v59/status"],
    ["/v1/content/models/glm-pro/status", "/internal/models/glm-pro/status"],
  ] as const)("PUT %s carries the verified staff email as x-staff-email, body (reason) untouched", async (path, downstream) => {
    stubUpstream(200, { status: "deprecated" });
    const body = { status: "deprecated", reason: "Replies dropped after v59" };
    const res = await staffPlatform(request(buildApp()).put(path))
      .set("x-staff-email", "forged@evil.com")
      .send({ ...body });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${EMAILGEN_BASE}${downstream}`);
    expect(calls[0].options.headers["x-staff-email"]).toBe(STAFF);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it("a staff key's deprecation carries the key user's stored email, not a caller header", async () => {
    stubUpstream(200, { status: "deprecated" });
    const res = await request(buildApp())
      .put("/v1/content/templates/cold-email-v59/status")
      .set("authorization", "Bearer distrib.usr_x")
      .set("x-test-auth-type", "user_key")
      .set("x-test-key-staff", "true")
      .set("x-test-key-email", STAFF)
      .set("x-staff-email", "forged@evil.com")
      .set("x-email", "forged@evil.com")
      .send({ status: "deprecated", reason: "r" });
    expect(res.status).toBe(200);
    expect(calls[0].options.headers["x-staff-email"]).toBe(STAFF);
  });

  it("GET reads carry no x-staff-email", async () => {
    stubUpstream(200, { templates: [] });
    await staffPlatform(request(buildApp()).get("/v1/content/templates"));
    expect(calls[0].options.headers["x-staff-email"]).toBeUndefined();
  });

  it("GET /v1/content/templates/:type/outputs forwards the query string verbatim", async () => {
    stubUpstream(200, { type: "cold-email-v59", outputs: [] });
    const res = await staffPlatform(request(buildApp()).get("/v1/content/templates/cold-email-v59/outputs?limit=5"));
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${EMAILGEN_BASE}/internal/templates/cold-email-v59/outputs?limit=5`);
  });

  it("a staff member's own key passes", async () => {
    stubUpstream(200, { templates: [] });
    const res = await request(buildApp())
      .get("/v1/content/templates")
      .set("authorization", "Bearer distrib.usr_x")
      .set("x-test-auth-type", "user_key")
      .set("x-test-key-staff", "true")
      .set("x-test-key-email", STAFF);
    expect(res.status).toBe(200);
  });

  it.each([
    ["get", "/v1/content/templates"],
    ["get", "/v1/content/models"],
    ["put", "/v1/content/templates/cold-email-v59/status"],
    ["put", "/v1/content/models/glm-pro/status"],
    ["get", "/v1/content/templates/cold-email-v59/outputs"],
  ] as const)("%s %s refuses a client key and a non-staff platform caller, nothing reaches downstream", async (method, path) => {
    stubUpstream(200, {});
    const clientKey = await (request(buildApp()) as any)[method](path)
      .set("authorization", "Bearer distrib.usr_x")
      .set("x-test-auth-type", "user_key")
      .set("x-test-key-staff", "false")
      .set("x-test-key-email", "client@acme.com")
      .send({ status: "deprecated" });
    expect(clientKey.status).toBe(403);
    const nonStaff = await (request(buildApp()) as any)[method](path)
      .set("x-api-key", PLATFORM_KEY)
      .set("x-email", "client@acme.com")
      .send({ status: "deprecated" });
    expect(nonStaff.status).toBe(403);
    const noKey = await (request(buildApp()) as any)[method](path).send({ status: "deprecated" });
    expect(noKey.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("workflow retire-by-content + status routes (staff)", () => {
  it("POST /v1/workflows/retire-by-content forwards body + identity, returns the producer's body", async () => {
    const upstream = { dryRun: true, workflows: [{ workflowDynastySlug: "x" }] };
    stubUpstream(200, upstream);
    const body = { promptType: "cold-email-v59", dryRun: true };
    const res = await request(buildApp()).post("/v1/workflows/retire-by-content").set("x-email", STAFF).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstream);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/workflows/retire-by-content`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
    expect(calls[0].options.headers["x-org-id"]).toBe("org_test456");
    expect(calls[0].options.headers["x-user-id"]).toBe("user_test123");
  });

  it.each([
    ["post", "/v1/workflows/retire-by-content"],
    ["put", "/v1/workflows/dynasty/sales-email-cold-outreach-sienna/status"],
    ["put", "/v1/workflows/3fa85f64-5717-4562-b3fc-2c963f66afa6/status"],
  ] as const)("%s %s refuses a non-staff caller before workflow-service", async (method, path) => {
    stubUpstream(200, {});
    const nonStaff = await (request(buildApp()) as any)[method](path).set("x-email", "client@acme.com").send({ status: "deprecated" });
    expect(nonStaff.status).toBe(403);
    const clientKey = await (request(buildApp()) as any)[method](path)
      .set("x-test-auth-type", "user_key")
      .set("x-test-key-staff", "false")
      .set("x-test-key-email", "client@acme.com")
      .send({ status: "deprecated" });
    expect(clientKey.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("PUT /v1/workflows/dynasty/:slug/status still reaches workflow-service for staff", async () => {
    stubUpstream(200, { workflowDynastySlug: "sales-email-cold-outreach-sienna", status: "deprecated" });
    const res = await request(buildApp())
      .put("/v1/workflows/dynasty/sales-email-cold-outreach-sienna/status")
      .set("x-email", STAFF)
      .send({ status: "deprecated" });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${WORKFLOW_BASE}/workflows/dynasty/sales-email-cold-outreach-sienna/status`);
  });
});

describe("template dynasties + new template text (staff, TPL-DYNASTY-1021-CG)", () => {
  const dynasty = {
    slug: "staff-test-short-cold-email",
    name: "Staff test short cold email",
    description: "A short email for a staff test.",
    signature: "Staff test guideline.",
    identity: "named",
    featureSlug: "sales-email",
    legKey: "website-visit",
    versions: ["staff-test-short-v1"],
  };

  it("POST /v1/content/template-dynasties pipes the body and the producer's 201 byte-identical, with x-staff-email", async () => {
    const upstream = { ...dynasty, head: "staff-test-short-v1", fieldNobodyDeclared: 1 };
    stubUpstream(201, upstream);
    const res = await staffPlatform(request(buildApp()).post("/v1/content/template-dynasties")).send(dynasty);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstream);
    expect(calls[0].url).toBe(`${EMAILGEN_BASE}/internal/template-dynasties`);
    expect(calls[0].options.method).toBe("POST");
    expect(JSON.parse(calls[0].options.body)).toEqual(dynasty);
    expect(calls[0].options.headers["x-staff-email"]).toBe(STAFF);
  });

  it("a producer refusal (409) reaches the caller with status and body", async () => {
    const upstream = { error: "A dynasty already has that name", code: "DYNASTY_CONFLICT" };
    stubUpstream(409, upstream);
    const res = await staffPlatform(request(buildApp()).post("/v1/content/template-dynasties")).send(dynasty);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(upstream);
  });

  it("POST /v1/content/platform-prompts stores a new template text at POST /platform-prompts", async () => {
    const body = { type: "staff-test-short-v1", prompt: "Write to {{lead}}", variables: [{ name: "lead", description: "x" }] };
    stubUpstream(201, { type: body.type });
    const res = await staffPlatform(request(buildApp()).post("/v1/content/platform-prompts")).send(body);
    expect(res.status).toBe(201);
    expect(calls[0].url).toBe(`${EMAILGEN_BASE}/platform-prompts`);
    expect(JSON.parse(calls[0].options.body)).toEqual(body);
  });

  it.each([
    ["get", "/v1/content/template-dynasties?featureSlug=sales-email&legKey=website-visit", "/internal/template-dynasties?featureSlug=sales-email&legKey=website-visit"],
    ["get", "/v1/content/template-dynasties/a-b", "/internal/template-dynasties/a-b"],
    ["get", "/v1/content/template-dynasties/a-b/head", "/internal/template-dynasties/a-b/head"],
    ["post", "/v1/content/template-dynasties/a-b/versions", "/internal/template-dynasties/a-b/versions"],
  ] as const)("%s %s hits %s", async (method, path, downstream) => {
    stubUpstream(200, { ok: true });
    const res = await staffPlatform((request(buildApp()) as any)[method](path)).send(method === "post" ? { type: "x" } : undefined);
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${EMAILGEN_BASE}${downstream}`);
    expect(calls[0].options.method).toBe(method.toUpperCase());
  });

  it("a staff key's version add carries the key user's email as x-staff-email", async () => {
    stubUpstream(201, {});
    await request(buildApp())
      .post("/v1/content/template-dynasties/a-b/versions")
      .set("authorization", "Bearer distrib.usr_x")
      .set("x-test-auth-type", "user_key")
      .set("x-test-key-staff", "true")
      .set("x-test-key-email", STAFF)
      .set("x-staff-email", "forged@evil.com")
      .send({ type: "x" });
    expect(calls[0].options.headers["x-staff-email"]).toBe(STAFF);
  });

  it.each([
    ["get", "/v1/content/template-dynasties"],
    ["post", "/v1/content/template-dynasties"],
    ["get", "/v1/content/template-dynasties/a-b"],
    ["get", "/v1/content/template-dynasties/a-b/head"],
    ["post", "/v1/content/template-dynasties/a-b/versions"],
    ["post", "/v1/content/platform-prompts"],
  ] as const)("%s %s refuses a client key and a non-staff platform caller before content-generation", async (method, path) => {
    stubUpstream(200, {});
    const clientKey = await (request(buildApp()) as any)[method](path)
      .set("authorization", "Bearer distrib.usr_x")
      .set("x-test-auth-type", "user_key")
      .set("x-test-key-staff", "false")
      .set("x-test-key-email", "client@acme.com")
      .send({});
    expect(clientKey.status).toBe(403);
    const nonStaff = await (request(buildApp()) as any)[method](path).set("x-api-key", PLATFORM_KEY).set("x-email", "client@acme.com").send({});
    expect(nonStaff.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
