import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock auth middleware
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
}

let fetchCalls: FetchCall[] = [];

import workflowRouter from "../../src/routes/workflows.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", workflowRouter);
  return app;
}

// ---------------------------------------------------------------------------
// GET /v1/workflows — enrichment with requiredProviders
// ---------------------------------------------------------------------------
describe("GET /v1/workflows — enrichment with requiredProviders", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });

      // Route responses based on URL
      if (url.includes("/required-providers")) {
        return {
          ok: true,
          json: () => Promise.resolve({ providers: ["apollo", "anthropic"], endpoints: [] }),
        };
      }
      if (url.includes("/workflows?") || (url.includes("/workflows") && !url.includes("/"))) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              workflows: [
                { id: "wf-1", name: "cold-outreach-v1", category: "sales" },
                { id: "wf-2", name: "pr-outreach-v1", category: "pr" },
              ],
            }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
  });

  it("should enrich each workflow with requiredProviders", async () => {
    const res = await request(app).get("/v1/workflows");

    expect(res.status).toBe(200);
    expect(res.body.workflows).toHaveLength(2);
    expect(res.body.workflows[0].requiredProviders).toEqual(["apollo", "anthropic"]);
    expect(res.body.workflows[1].requiredProviders).toEqual(["apollo", "anthropic"]);
  });

  it("should call required-providers for each workflow", async () => {
    await request(app).get("/v1/workflows");

    const providerCalls = fetchCalls.filter((c) => c.url.includes("/required-providers"));
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0].url).toContain("/workflows/wf-1/required-providers");
    expect(providerCalls[1].url).toContain("/workflows/wf-2/required-providers");
  });

  it("should return empty requiredProviders if provider call fails", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/required-providers")) {
        callCount++;
        if (callCount === 1) {
          return { ok: false, text: () => Promise.resolve("Internal error") };
        }
        return { ok: true, json: () => Promise.resolve({ providers: ["firecrawl"] }) };
      }
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            workflows: [
              { id: "wf-1", name: "flow-1" },
              { id: "wf-2", name: "flow-2" },
            ],
          }),
      };
    });

    app = createApp();
    const res = await request(app).get("/v1/workflows");

    expect(res.status).toBe(200);
    expect(res.body.workflows[0].requiredProviders).toEqual([]);
    expect(res.body.workflows[1].requiredProviders).toEqual(["firecrawl"]);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/workflows/:id — enrichment with requiredProviders
// ---------------------------------------------------------------------------
describe("GET /v1/workflows/:id — enrichment with requiredProviders", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, method: init?.method });

      if (url.includes("/required-providers")) {
        return {
          ok: true,
          json: () => Promise.resolve({ providers: ["instantly", "anthropic"] }),
        };
      }
      if (url.match(/\/workflows\/wf-\d+$/)) {
        return {
          ok: true,
          json: () => Promise.resolve({ workflow: { id: "wf-1", name: "cold-outreach-v1" } }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
  });

  it("should enrich single workflow with requiredProviders", async () => {
    const res = await request(app).get("/v1/workflows/wf-1");

    expect(res.status).toBe(200);
    expect(res.body.workflow.requiredProviders).toEqual(["instantly", "anthropic"]);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/workflows/:id/summary
// ---------------------------------------------------------------------------
describe("GET /v1/workflows/:id/summary", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/required-providers")) {
        return {
          ok: true,
          json: () => Promise.resolve({ providers: ["apollo", "anthropic", "instantly"] }),
        };
      }
      if (url.match(/\/workflows\/wf-1$/)) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: "wf-1",
              name: "sales-email-cold-outreach-v1",
              dag: {
                nodes: [
                  { id: "find-leads", type: "http.call", config: { service: "apollo", method: "POST", path: "/search" }, inputMapping: {} },
                  { id: "enrich-profiles", type: "http.call", config: { service: "apollo", method: "POST", path: "/enrich" }, inputMapping: {} },
                  { id: "generate-email", type: "http.call", config: { service: "content-generation", method: "POST", path: "/generate" }, inputMapping: {} },
                  { id: "send-email", type: "http.call", config: { service: "instantly", method: "POST", path: "/send" }, inputMapping: {} },
                ],
                edges: [
                  { from: "find-leads", to: "enrich-profiles" },
                  { from: "enrich-profiles", to: "generate-email" },
                  { from: "generate-email", to: "send-email" },
                ],
              },
            }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });

    app = createApp();
  });

  it("should return a structured summary with steps", async () => {
    const res = await request(app).get("/v1/workflows/wf-1/summary");

    expect(res.status).toBe(200);
    expect(res.body.workflowName).toBe("sales-email-cold-outreach-v1");
    expect(res.body.requiredProviders).toEqual(["apollo", "anthropic", "instantly"]);
    expect(res.body.steps).toHaveLength(4);
    expect(res.body.steps[0]).toContain("1.");
    expect(res.body.steps[0]).toContain("find leads");
    expect(res.body.steps[0]).toContain("Apollo");
    expect(res.body.summary).toContain("4 steps");
  });

  it("should not 404 when workflow-service returns workflow at top level (not nested)", async () => {
    // Regression: workflow-service returns { id, name, dag, ... } directly,
    // NOT { workflow: { id, name, dag } }. Previously the code did .then(r => r.workflow)
    // which yielded undefined and caused a false 404.
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/required-providers")) {
        return { ok: true, json: () => Promise.resolve({ providers: ["apollo"] }) };
      }
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            id: "wf-regression",
            name: "regression-flow",
            dag: {
              nodes: [{ id: "step-1", type: "http.call", config: { service: "apollo", method: "GET", path: "/test" } }],
              edges: [],
            },
          }),
      };
    });
    app = createApp();

    const res = await request(app).get("/v1/workflows/wf-regression/summary");

    expect(res.status).toBe(200);
    expect(res.body.workflowName).toBe("regression-flow");
    expect(res.body.steps).toHaveLength(1);
  });

  it("should handle workflow with no DAG", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/required-providers")) {
        return { ok: true, json: () => Promise.resolve({ providers: [] }) };
      }
      return {
        ok: true,
        json: () => Promise.resolve({ id: "wf-1", name: "empty-flow", dag: null }),
      };
    });
    app = createApp();

    const res = await request(app).get("/v1/workflows/wf-1/summary");

    expect(res.status).toBe(200);
    expect(res.body.steps).toEqual([]);
    expect(res.body.summary).toContain("no steps");
  });
});

// ---------------------------------------------------------------------------
// GET /v1/workflows/:id/key-status
// ---------------------------------------------------------------------------
describe("GET /v1/workflows/:id/key-status", () => {
  let app: express.Express;

  /** Helper to build a fetch mock with configurable key sources */
  function buildFetchMock(opts: {
    requiredProviders?: string[];
    orgKeys?: Array<{ provider: string; maskedKey: string }>;
    keySources?: Array<{ provider: string; keySource: "org" | "platform" }>;
    workflowName?: string;
  } = {}) {
    const {
      requiredProviders = ["apollo", "anthropic", "instantly"],
      orgKeys = [
        { provider: "apollo", maskedKey: "apol...123" },
        { provider: "anthropic", maskedKey: "sk-...abc" },
      ],
      keySources = [],
      workflowName = "sales-email-cold-outreach-v1",
    } = opts;

    return vi.fn().mockImplementation(async (url: string) => {
      fetchCalls.push({ url });

      if (url.includes("/required-providers")) {
        return { ok: true, json: () => Promise.resolve({ providers: requiredProviders }) };
      }
      if (url.includes("/keys/sources")) {
        return { ok: true, json: () => Promise.resolve({ sources: keySources }) };
      }
      if (url.match(/\/keys$/) || url.includes("/keys?")) {
        return { ok: true, json: () => Promise.resolve({ keys: orgKeys }) };
      }
      if (url.match(/\/workflows\/wf-1$/)) {
        return { ok: true, json: () => Promise.resolve({ workflow: { name: workflowName } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = buildFetchMock();
    app = createApp();
  });

  it("should return key status with missing providers (org source, no key)", async () => {
    // All providers use org keys, but instantly has no key configured
    global.fetch = buildFetchMock({
      keySources: [
        { provider: "apollo", keySource: "org" },
        { provider: "anthropic", keySource: "org" },
        { provider: "instantly", keySource: "org" },
      ],
    });
    app = createApp();

    const res = await request(app).get("/v1/workflows/wf-1/key-status");

    expect(res.status).toBe(200);
    expect(res.body.workflowName).toBe("sales-email-cold-outreach-v1");
    expect(res.body.ready).toBe(false);
    expect(res.body.keys).toHaveLength(3);
    expect(res.body.keys).toContainEqual({ provider: "apollo", configured: true, maskedKey: "apol...123", keySource: "org" });
    expect(res.body.keys).toContainEqual({ provider: "anthropic", configured: true, maskedKey: "sk-...abc", keySource: "org" });
    expect(res.body.keys).toContainEqual({ provider: "instantly", configured: false, maskedKey: null, keySource: "org" });
    expect(res.body.missing).toEqual(["instantly"]);
  });

  it("should return ready=true when all providers use platform keys (default)", async () => {
    // No key sources set → all default to platform → always ready
    global.fetch = buildFetchMock({
      requiredProviders: ["anthropic", "apollo"],
      orgKeys: [], // No org keys configured
      keySources: [], // Defaults to platform
    });
    app = createApp();

    const res = await request(app).get("/v1/workflows/wf-1/key-status");

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.missing).toEqual([]);
    expect(res.body.keys).toContainEqual({ provider: "anthropic", configured: true, maskedKey: null, keySource: "platform" });
    expect(res.body.keys).toContainEqual({ provider: "apollo", configured: true, maskedKey: null, keySource: "platform" });
  });

  it("should return ready=true when all org-source keys are configured", async () => {
    global.fetch = buildFetchMock({
      requiredProviders: ["apollo"],
      orgKeys: [{ provider: "apollo", maskedKey: "apol...123" }],
      keySources: [{ provider: "apollo", keySource: "org" }],
      workflowName: "simple-flow",
    });
    app = createApp();

    const res = await request(app).get("/v1/workflows/wf-1/key-status");

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.missing).toEqual([]);
  });

  it("should handle mixed key sources correctly", async () => {
    // anthropic uses platform (ready), instantly uses org but has no key (missing)
    global.fetch = buildFetchMock({
      requiredProviders: ["anthropic", "instantly"],
      orgKeys: [],
      keySources: [
        { provider: "instantly", keySource: "org" },
        // anthropic not listed → defaults to platform
      ],
    });
    app = createApp();

    const res = await request(app).get("/v1/workflows/wf-1/key-status");

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(false);
    expect(res.body.keys).toContainEqual({ provider: "anthropic", configured: true, maskedKey: null, keySource: "platform" });
    expect(res.body.keys).toContainEqual({ provider: "instantly", configured: false, maskedKey: null, keySource: "org" });
    expect(res.body.missing).toEqual(["instantly"]);
  });

  it("should fetch key sources from /keys/sources", async () => {
    await request(app).get("/v1/workflows/wf-1/key-status");

    const sourcesCall = fetchCalls.find((c) => c.url.includes("/keys/sources"));
    expect(sourcesCall).toBeDefined();
  });

  it("should fetch org keys via /keys without orgId in query (uses headers)", async () => {
    await request(app).get("/v1/workflows/wf-1/key-status");

    const keysCall = fetchCalls.find((c) => c.url.match(/\/keys$/) && !c.url.includes("/keys/sources"));
    expect(keysCall).toBeDefined();
    expect(keysCall!.url).not.toContain("keySource");
    expect(keysCall!.url).not.toContain("orgId");
  });

  it("should gracefully handle key sources fetch failure (default to platform)", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchCalls.push({ url });

      if (url.includes("/required-providers")) {
        return { ok: true, json: () => Promise.resolve({ providers: ["anthropic"] }) };
      }
      if (url.includes("/keys/sources")) {
        return { ok: false, text: () => Promise.resolve("Internal error") };
      }
      if (url.match(/\/keys$/) || url.includes("/keys?")) {
        return { ok: true, json: () => Promise.resolve({ keys: [] }) };
      }
      if (url.match(/\/workflows\/wf-1$/)) {
        return { ok: true, json: () => Promise.resolve({ workflow: { name: "test-flow" } }) };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    });
    app = createApp();

    const res = await request(app).get("/v1/workflows/wf-1/key-status");

    // Should default to platform → configured = true
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.keys).toContainEqual({ provider: "anthropic", configured: true, maskedKey: null, keySource: "platform" });
  });
});
