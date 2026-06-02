import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import request from "supertest";
import express from "express";

// Behavioral tests mock the auth trio to pass-through (mirror platform-prompts.test.ts).
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.runId = "run_test789";
    req.brandId = "brand_testabc";
    req.authType = "admin";
    next();
  },
  requireOrg: (_req: any, _res: any, next: any) => next(),
  requireUser: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import promptsRoutes from "../../src/routes/prompts.js";

interface FetchCall {
  url: string;
  method?: string;
  body?: any;
}

let fetchCalls: FetchCall[] = [];

const upstreamResponse = {
  id: "prompt_abc123",
  type: "blind-discovery-email-v16",
  prompt: "You are writing a blind discovery email... {{senderName}}",
  variables: [
    { name: "senderName", description: "Sender's display name." },
    { name: "brands", description: "Array of brand profiles." },
  ],
  createdAt: "2026-06-02T10:00:00Z",
  updatedAt: "2026-06-02T10:00:00Z",
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", promptsRoutes);
  return app;
}

describe("PUT /v1/prompts — behavioral proxy", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls = [];
    app = buildApp();
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });
      return {
        ok: true,
        status: 201,
        json: () => Promise.resolve(upstreamResponse),
      };
    });
  });

  it("forwards object variables to content-generation PUT /prompts and returns 201", async () => {
    // The 11 variables of blind-discovery-email-v15 — the payload the chat tool sends.
    const variables = [
      { name: "senderName", description: "Sender's display name." },
      { name: "senderTitle", description: "Sender's job title." },
      { name: "senderCompany", description: "Sender's company name." },
      { name: "brands", description: "Array of brand profiles being represented." },
      { name: "recipientName", description: "Recipient's display name." },
      { name: "recipientCompany", description: "Recipient's company name." },
      { name: "recipientRole", description: "Recipient's role." },
      { name: "industry", description: "Recipient's industry." },
      { name: "painPoint", description: "Pain point the email addresses." },
      { name: "valueProp", description: "Value proposition to lead with." },
      { name: "callToAction", description: "Desired call to action." },
    ];

    const res = await request(app)
      .put("/v1/prompts")
      .send({ sourceType: "blind-discovery-email", prompt: "Hello {{senderName}}", variables });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstreamResponse);

    const call = fetchCalls.find((c) => c.url.includes("/prompts"));
    expect(call).toBeDefined();
    expect(call!.method).toBe("PUT");
    // Variables forwarded as objects, byte-for-byte — not stringified, not stripped.
    expect(call!.body).toMatchObject({
      sourceType: "blind-discovery-email",
      prompt: "Hello {{senderName}}",
      variables,
    });
  });

  it("rejects legacy string[] variables with 400 before any downstream call", async () => {
    const res = await request(app)
      .put("/v1/prompts")
      .send({ sourceType: "cold-email", prompt: "test", variables: ["leadFirstName", "leadLastName"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
    expect(fetchCalls.find((c) => c.url.includes("/prompts"))).toBeUndefined();
  });

  it("rejects a variable missing description with 400 before any downstream call", async () => {
    const res = await request(app)
      .put("/v1/prompts")
      .send({ sourceType: "cold-email", prompt: "test", variables: [{ name: "leadFirstName" }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
    expect(fetchCalls.find((c) => c.url.includes("/prompts"))).toBeUndefined();
  });

  it("rejects a variable missing name with 400 before any downstream call", async () => {
    const res = await request(app)
      .put("/v1/prompts")
      .send({ sourceType: "cold-email", prompt: "test", variables: [{ description: "Lead first name." }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
    expect(fetchCalls.find((c) => c.url.includes("/prompts"))).toBeUndefined();
  });
});

describe("Prompts proxy route — GET /prompts", () => {
  const routePath = path.join(__dirname, "../../src/routes/prompts.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should define GET /prompts", () => {
    expect(content).toContain('router.get("/prompts"');
  });

  it("should require type query parameter", () => {
    const getStart = content.indexOf('router.get("/prompts"');
    const getEnd = content.indexOf("router.", getStart + 10);
    const block = content.slice(getStart, getEnd);

    expect(block).toContain("req.query.type");
    expect(block).toContain("400");
    expect(block).toContain("Missing required query parameter: type");
  });

  it("should proxy to content-generation /prompts?type=", () => {
    expect(content).toContain("externalServices.emailgen");
    expect(content).toContain("/prompts?type=");
  });

  it("should URL-encode the type parameter", () => {
    expect(content).toContain("encodeURIComponent(type)");
  });

  it("should use authenticate, requireOrg, requireUser middleware", () => {
    const getLine = content.slice(
      content.indexOf('router.get("/prompts"'),
      content.indexOf('router.get("/prompts"') + 100
    );
    expect(getLine).toContain("authenticate");
    expect(getLine).toContain("requireOrg");
    expect(getLine).toContain("requireUser");
  });
});

describe("Prompts proxy route — PUT /prompts", () => {
  const routePath = path.join(__dirname, "../../src/routes/prompts.ts");
  const content = fs.readFileSync(routePath, "utf-8");

  it("should define PUT /prompts", () => {
    expect(content).toContain('router.put("/prompts"');
  });

  it("should validate body with VersionPromptRequestSchema", () => {
    const putStart = content.indexOf('router.put("/prompts"');
    const putEnd = content.length;
    const block = content.slice(putStart, putEnd);

    expect(block).toContain("VersionPromptRequestSchema");
    expect(block).toContain("safeParse");
  });

  it("should proxy to content-generation PUT /prompts", () => {
    const putStart = content.indexOf('router.put("/prompts"');
    const block = content.slice(putStart);

    expect(block).toContain("externalServices.emailgen");
    expect(block).toContain('method: "PUT"');
    expect(block).toContain('"/prompts"');
  });

  it("should return 201 on success", () => {
    const putStart = content.indexOf('router.put("/prompts"');
    const block = content.slice(putStart);

    expect(block).toContain("res.status(201)");
  });

  it("should return 400 on invalid body", () => {
    const putStart = content.indexOf('router.put("/prompts"');
    const block = content.slice(putStart);

    expect(block).toContain("400");
    expect(block).toContain("Invalid request");
  });
});

describe("Prompts OpenAPI schemas", () => {
  const schemaPath = path.join(__dirname, "../../src/schemas.ts");
  const content = fs.readFileSync(schemaPath, "utf-8");

  it("should register GET /v1/prompts path", () => {
    expect(content).toContain('path: "/v1/prompts"');
    expect(content).toContain('method: "get"');
  });

  it("should register PUT /v1/prompts path", () => {
    expect(content).toContain('path: "/v1/prompts"');
    expect(content).toContain('method: "put"');
  });

  it("should collapse PromptResponse schema to passthrough (CLAUDE.md #8)", () => {
    expect(content).toContain('z.object({}).passthrough().openapi("PromptResponse")');
  });

  it("should declare VersionPromptRequest variables as {name, description} objects", () => {
    const start = content.indexOf("export const VersionPromptRequestSchema");
    const block = content.slice(start, start + 1500);

    expect(block).toContain('"VersionPromptRequest"');
    expect(block).toContain("sourceType");
    expect(block).toContain("name: z.string()");
    expect(block).toContain("description: z");
    // No min on the variables array — mirror platform-prompts; downstream owns minItems.
    expect(block).not.toContain(".min(1).describe(\"List of expected variable names");
  });

  it("should export VersionPromptRequestSchema", () => {
    expect(content).toContain("export const VersionPromptRequestSchema");
  });
});

describe("Prompts routes mounted in index.ts", () => {
  const indexPath = path.join(__dirname, "../../src/index.ts");
  const content = fs.readFileSync(indexPath, "utf-8");

  it("should import prompts routes", () => {
    expect(content).toContain("promptsRoutes");
    expect(content).toContain("./routes/prompts");
  });

  it("should mount prompts routes under /v1", () => {
    expect(content).toContain('app.use("/v1", promptsRoutes)');
  });
});
