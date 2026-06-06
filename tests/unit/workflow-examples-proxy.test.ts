import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";

// Mock auth middleware — mirrors emails.test.ts
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "user_key";
    next();
  },
  requireOrg: (req: any, res: any, next: any) => {
    if (!req.orgId) return res.status(400).json({ error: "Organization context required" });
    next();
  },
  requireUser: (req: any, res: any, next: any) => {
    if (!req.userId) return res.status(401).json({ error: "User identity required" });
    next();
  },
  AuthenticatedRequest: {},
}));

interface FetchCall {
  url: string;
  method?: string;
  body?: any;
  headers?: Record<string, string>;
}

let fetchCalls: FetchCall[] = [];

import emailsRoutes from "../../src/routes/emails.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", emailsRoutes);
  return app;
}

// Passthrough body content-gen would return — email fields + scope + brandName
const UPSTREAM_BODY = {
  examples: [
    {
      id: "gen_1",
      subject: "Intro to Polarity",
      bodyHtml: "<p>Hi {{name}}</p>",
      bodyText: "Hi {{name}}",
      scope: "brand",
      brandName: "Polarity",
    },
    {
      id: "gen_2",
      subject: "Org-level example",
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      scope: "org",
      brandName: null,
    },
    {
      id: "gen_3",
      subject: "Global example",
      bodyHtml: "<p>Generic</p>",
      bodyText: "Generic",
      scope: "global",
      brandName: null,
    },
  ],
};

describe("GET /v1/workflow-examples (runtime proxy)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = init?.headers ? Object.fromEntries(Object.entries(init.headers)) : undefined;
      fetchCalls.push({ url, method: init?.method, body, headers });
      return {
        ok: true,
        json: () => Promise.resolve(UPSTREAM_BODY),
      };
    });
    app = createApp();
  });

  it("forwards workflowSlug + brandId + limit to content-gen /generations/examples", async () => {
    const res = await request(app).get(
      "/v1/workflow-examples?workflowSlug=sales-cold-email&brandId=11111111-1111-4111-8111-111111111111&limit=3",
    );

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/generations/examples"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("workflowSlug=sales-cold-email");
    expect(call!.url).toContain("brandId=11111111-1111-4111-8111-111111111111");
    expect(call!.url).toContain("limit=3");
  });

  it("forwards identity via buildInternalHeaders (x-org-id reaches content-gen)", async () => {
    await request(app).get("/v1/workflow-examples?workflowSlug=sales-cold-email");

    const call = fetchCalls.find((c) => c.url.includes("/generations/examples"));
    expect(call).toBeDefined();
    expect(call!.headers!["x-org-id"]).toBe("org_test456");
    expect(call!.headers!["x-user-id"]).toBe("user_test123");
  });

  it("returns content-gen body verbatim (passthrough, scope + brandName preserved)", async () => {
    const res = await request(app).get("/v1/workflow-examples?workflowSlug=sales-cold-email");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(UPSTREAM_BODY);
    expect(res.body.examples[0].scope).toBe("brand");
    expect(res.body.examples[0].brandName).toBe("Polarity");
    expect(res.body.examples[2].scope).toBe("global");
  });

  it("works with only workflowSlug (brandId + limit optional → not forwarded)", async () => {
    const res = await request(app).get("/v1/workflow-examples?workflowSlug=sales-cold-email");

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.url.includes("/generations/examples"));
    expect(call!.url).toContain("workflowSlug=sales-cold-email");
    expect(call!.url).not.toContain("brandId=");
    expect(call!.url).not.toContain("limit=");
  });

  it("returns 400 when workflowSlug is missing", async () => {
    const res = await request(app).get("/v1/workflow-examples?brandId=11111111-1111-4111-8111-111111111111");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("workflowSlug");
    // Must not call downstream
    expect(fetchCalls.find((c) => c.url.includes("/generations/examples"))).toBeUndefined();
  });

  it("surfaces upstream error status + body verbatim", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: "content-gen down" }),
      text: () => Promise.resolve('{"error":"content-gen down"}'),
    }));
    app = createApp();

    const res = await request(app).get("/v1/workflow-examples?workflowSlug=sales-cold-email");
    expect(res.status).toBe(502);
  });
});

describe("GET /v1/workflow-examples (source + OpenAPI)", () => {
  const routePath = path.join(__dirname, "../../src/routes/emails.ts");
  const content = fs.readFileSync(routePath, "utf-8");
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const schemaContent = fs.readFileSync(schemaPath, "utf-8");
  const openapi = JSON.parse(fs.readFileSync(path.join(__dirname, "../../openapi.json"), "utf-8"));

  it("route has authenticate + requireOrg + requireUser", () => {
    const line = content.split("\n").find((l) => l.includes("router.get") && l.includes('"/workflow-examples"'));
    expect(line).toBeDefined();
    expect(line).toContain("authenticate");
    expect(line).toContain("requireOrg");
    expect(line).toContain("requireUser");
  });

  it("proxies to content-gen /generations/examples via emailgen", () => {
    expect(content).toContain("externalServices.emailgen");
    expect(content).toContain("`/generations/examples?${params}`");
  });

  it("uses buildInternalHeaders", () => {
    expect(content).toContain("buildInternalHeaders(req)");
  });

  it("does NOT enrich with getRunsBatch (pure passthrough)", () => {
    const section = content.slice(content.indexOf('router.get("/workflow-examples"'));
    expect(section).not.toContain("getRunsBatch");
  });

  it("registers /v1/workflow-examples in schemas.ts with passthrough response", () => {
    expect(schemaContent).toContain('path: "/v1/workflow-examples"');
    expect(schemaContent).toContain("WorkflowExamplesResponse");
  });

  it("OpenAPI has /v1/workflow-examples GET with required workflowSlug query param", () => {
    const op = openapi.paths["/v1/workflow-examples"]?.get;
    expect(op).toBeDefined();
    const params = op.parameters || [];
    const slug = params.find((p: { name: string; in: string }) => p.name === "workflowSlug" && p.in === "query");
    expect(slug).toBeDefined();
    expect(slug.required).toBe(true);
  });

  it("OpenAPI has 200/400/401/500 responses", () => {
    const op = openapi.paths["/v1/workflow-examples"]?.get;
    expect(op).toBeDefined();
    expect(op.responses["200"]).toBeDefined();
    expect(op.responses["400"]).toBeDefined();
    expect(op.responses["401"]).toBeDefined();
    expect(op.responses["500"]).toBeDefined();
  });
});
