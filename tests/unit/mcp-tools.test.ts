import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock auth — let requests through
vi.mock("../../src/middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/middleware/auth.js")>();
  return {
    ...actual,
    authenticatePlatform: (_req: any, _res: any, next: any) => {
      next();
    },
  };
});

interface FetchCall {
  url: string;
  method?: string;
  body?: any;
  headers?: Record<string, string>;
}

let fetchCalls: FetchCall[] = [];
let fetchResponses: Record<string, unknown> = {};

import mcpToolsRoutes from "../../src/routes/mcp-tools.js";

const VALID_API_KEY = "test-admin-key-123";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/internal", mcpToolsRoutes);
  return app;
}

function mockFetch(responseOverrides: Record<string, unknown> = {}) {
  fetchResponses = responseOverrides;
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const rawHeaders = init?.headers as Record<string, string> | undefined;
    const headers = rawHeaders ? Object.fromEntries(Object.entries(rawHeaders)) : undefined;
    fetchCalls.push({ url, method: init?.method, body, headers });

    // Match response by URL pattern
    for (const [pattern, response] of Object.entries(fetchResponses)) {
      if (url.includes(pattern)) {
        return { ok: true, json: () => Promise.resolve(response) };
      }
    }

    return { ok: true, json: () => Promise.resolve({ ok: true }) };
  });
}

describe("POST /internal/mcp-tools — MCP JSON-RPC", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    process.env.ADMIN_DISTRIBUTE_API_KEY = VALID_API_KEY;
    mockFetch();
    app = createApp();
  });

  // ── Protocol ──────────────────────────────────────────────────────────────

  it("should return error for non-JSON-RPC request", async () => {
    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({ hello: "world" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(-32600);
  });

  it("should handle initialize", async () => {
    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({ jsonrpc: "2.0", id: 1, method: "initialize" });

    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe("2.0");
    expect(res.body.id).toBe(1);
    expect(res.body.result.protocolVersion).toBe("2025-03-26");
    expect(res.body.result.capabilities.tools).toBeDefined();
    expect(res.body.result.serverInfo.name).toBe("api-service-mcp-tools");
  });

  it("should return error for unknown method", async () => {
    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({ jsonrpc: "2.0", id: 2, method: "unknown/method" });

    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe(-32601);
  });

  // ── tools/list ────────────────────────────────────────────────────────────

  it("should list all 5 tools", async () => {
    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({ jsonrpc: "2.0", id: 3, method: "tools/list" });

    expect(res.status).toBe(200);
    const tools = res.body.result.tools;
    expect(tools).toHaveLength(5);

    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain("getWorkflowDetails");
    expect(names).toContain("getPrompt");
    expect(names).toContain("validateWorkflow");
    expect(names).toContain("updateWorkflow");
    expect(names).toContain("versionPrompt");
  });

  it("each tool should have name, description, and inputSchema", async () => {
    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({ jsonrpc: "2.0", id: 4, method: "tools/list" });

    for (const tool of res.body.result.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  // ── tools/call — getWorkflowDetails ───────────────────────────────────────

  it("should execute getWorkflowDetails and call workflow-service", async () => {
    const workflowData = {
      workflow: { id: "wf-123", name: "Test Workflow", dag: { nodes: [], edges: [] } },
    };
    mockFetch({ "/workflows/wf-123": workflowData });

    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .set("x-org-id", "org-abc")
      .set("x-user-id", "user-def")
      .set("x-run-id", "run-ghi")
      .send({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "getWorkflowDetails", arguments: { workflowId: "wf-123" } },
      });

    expect(res.status).toBe(200);
    expect(res.body.result.content).toHaveLength(1);
    expect(res.body.result.content[0].type).toBe("text");

    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.workflow.id).toBe("wf-123");

    // Verify downstream call includes identity headers
    const call = fetchCalls.find((c) => c.url.includes("/workflows/wf-123"));
    expect(call).toBeDefined();
    expect(call!.headers!["x-org-id"]).toBe("org-abc");
    expect(call!.headers!["x-user-id"]).toBe("user-def");
    expect(call!.headers!["x-run-id"]).toBe("run-ghi");
  });

  // ── tools/call — getPrompt ────────────────────────────────────────────────

  it("should execute getPrompt and call content-generation service", async () => {
    const promptData = {
      id: "p-1",
      type: "cold-email",
      prompt: "Hello {{name}}",
      variables: ["name"],
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
    };
    mockFetch({ "/prompts?type=cold-email": promptData });

    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "getPrompt", arguments: { type: "cold-email" } },
      });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.type).toBe("cold-email");
    expect(parsed.variables).toContain("name");
  });

  // ── tools/call — validateWorkflow ─────────────────────────────────────────

  it("should execute validateWorkflow with POST to workflow-service", async () => {
    const validationResult = { valid: true, errors: [] };
    mockFetch({ "/workflows/wf-123/validate": validationResult });

    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "validateWorkflow", arguments: { workflowId: "wf-123" } },
      });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.valid).toBe(true);

    const call = fetchCalls.find((c) => c.url.includes("/validate"));
    expect(call).toBeDefined();
    expect(call!.method).toBe("POST");
  });

  // ── tools/call — updateWorkflow ───────────────────────────────────────────

  it("should execute updateWorkflow with PUT to workflow-service", async () => {
    const updatedWorkflow = { workflow: { id: "wf-123", name: "Updated" } };
    mockFetch({ "/workflows/wf-123": updatedWorkflow });

    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "updateWorkflow",
          arguments: {
            workflowId: "wf-123",
            name: "Updated",
            dag: { nodes: [{ id: "step1", type: "http.call" }], edges: [] },
          },
        },
      });

    expect(res.status).toBe(200);

    const call = fetchCalls.find((c) => c.url.includes("/workflows/wf-123") && c.method === "PUT");
    expect(call).toBeDefined();
    expect(call!.body.name).toBe("Updated");
    expect(call!.body.dag.nodes).toHaveLength(1);
    // workflowId should NOT be in the body (stripped from args)
    expect(call!.body.workflowId).toBeUndefined();
  });

  // ── tools/call — versionPrompt ────────────────────────────────────────────

  it("should execute versionPrompt with PUT to content-generation service", async () => {
    const newVersion = {
      id: "p-2",
      type: "cold-email-v2",
      prompt: "Hi {{firstName}}",
      variables: ["firstName"],
      createdAt: "2025-01-02",
      updatedAt: "2025-01-02",
    };
    mockFetch({ "/prompts": newVersion });

    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: {
          name: "versionPrompt",
          arguments: {
            sourceType: "cold-email",
            prompt: "Hi {{firstName}}",
            variables: ["firstName"],
          },
        },
      });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.result.content[0].text);
    expect(parsed.type).toBe("cold-email-v2");

    const call = fetchCalls.find((c) => c.url.includes("/prompts") && c.method === "PUT");
    expect(call).toBeDefined();
    expect(call!.body.sourceType).toBe("cold-email");
    expect(call!.body.prompt).toBe("Hi {{firstName}}");
    expect(call!.body.variables).toEqual(["firstName"]);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("should return error for unknown tool name", async () => {
    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: { name: "nonExistentTool", arguments: {} },
      });

    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe(-32602);
    expect(res.body.error.message).toContain("Unknown tool");
  });

  it("should return error when tool name is missing", async () => {
    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: { arguments: {} },
      });

    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe(-32602);
  });

  it("should return isError when downstream service fails", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve(JSON.stringify({ error: "Workflow not found" })),
    }));

    const res = await request(app)
      .post("/internal/mcp-tools")
      .set("X-API-Key", VALID_API_KEY)
      .send({
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: { name: "getWorkflowDetails", arguments: { workflowId: "missing-id" } },
      });

    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].type).toBe("text");
  });
});

describe("MCP tools — startup integration", () => {
  it("startup.ts should reference mcpServerUrl and mcpKeyName", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const startupPath = path.join(__dirname, "../../src/startup.ts");
    const content = fs.readFileSync(startupPath, "utf-8");

    expect(content).toContain("mcpServerUrl");
    expect(content).toContain("mcpKeyName");
    expect(content).toContain("api-service-mcp");
    expect(content).toContain("/internal/mcp-tools");
  });

  it("startup.ts should register api-service-mcp platform key", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const startupPath = path.join(__dirname, "../../src/startup.ts");
    const content = fs.readFileSync(startupPath, "utf-8");

    expect(content).toContain('provider: "api-service-mcp"');
    expect(content).toContain('envVar: "ADMIN_DISTRIBUTE_API_KEY"');
  });

  it("index.ts should mount mcp-tools routes at /internal", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const indexPath = path.join(__dirname, "../../src/index.ts");
    const content = fs.readFileSync(indexPath, "utf-8");

    expect(content).toContain("mcpToolsRoutes");
    expect(content).toContain("./routes/mcp-tools");
    expect(content).toContain('"/internal", mcpToolsRoutes');
  });
});

describe("System prompt content", () => {
  it("should include DAG node types reference", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const startupPath = path.join(__dirname, "../../src/startup.ts");
    const content = fs.readFileSync(startupPath, "utf-8");

    expect(content).toContain("http.call");
    expect(content).toContain("condition");
    expect(content).toContain("wait");
    expect(content).toContain("for-each");
    expect(content).toContain("script");
    expect(content).toContain("inputMapping");
    expect(content).toContain("$ref:");
    expect(content).toContain("onError");
  });

  it("should include validation rule", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const startupPath = path.join(__dirname, "../../src/startup.ts");
    const content = fs.readFileSync(startupPath, "utf-8");

    expect(content).toContain("MUST");
    expect(content).toContain("validateWorkflow");
    expect(content).toContain("updateWorkflow");
  });

  it("should include available services for http.call", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const startupPath = path.join(__dirname, "../../src/startup.ts");
    const content = fs.readFileSync(startupPath, "utf-8");

    expect(content).toContain("apollo");
    expect(content).toContain("content-generation");
    expect(content).toContain("lead");
    expect(content).toContain("campaign");
    expect(content).toContain("instantly");
    expect(content).toContain("stripe");
  });
});
