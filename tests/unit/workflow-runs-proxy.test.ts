import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

interface FetchCall {
  url: string;
  method?: string;
  body?: any;
}

let fetchCalls: FetchCall[] = [];

let mockAuth = {
  userId: "user_test123",
  orgId: "org_test456",
  authType: "user_key" as "user_key" | "admin",
};

vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = mockAuth.userId;
    req.orgId = mockAuth.orgId;
    req.authType = mockAuth.authType;
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

import workflowsRoutes from "../../src/routes/workflows.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", workflowsRoutes);
  return app;
}

function mockFetchWith(response: any, status = 200) {
  global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    fetchCalls.push({ url, method: init?.method, body });
    return { ok: status < 400, status, json: () => Promise.resolve(response) };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  fetchCalls = [];
  mockAuth = { userId: "user_test123", orgId: "org_test456", authType: "user_key" };
  mockFetchWith({});
});

// -----------------------------------------------------------------------
// POST /v1/workflows — create workflow
// -----------------------------------------------------------------------

describe("POST /v1/workflows", () => {
  it("should proxy to workflow-service POST /workflows", async () => {
    mockFetchWith({ id: "wf-123", name: "test-flow" });
    const app = createApp();
    const res = await request(app)
      .post("/v1/workflows")
      .send({ name: "test-flow", featureSlug: "pr-outreach", dag: { nodes: [], edges: [] } });

    expect(res.status).toBe(201);
    const call = fetchCalls.find((c) => c.method === "POST" && c.url.includes("/workflows"));
    expect(call).toBeDefined();
    expect(call!.body.name).toBe("test-flow");
  });
});

// -----------------------------------------------------------------------
// DELETE /v1/workflows/:id — intentionally NOT exposed (no ownership check)
// -----------------------------------------------------------------------

describe("DELETE /v1/workflows/:id", () => {
  it("should NOT be exposed — returns 404", async () => {
    const app = createApp();
    const res = await request(app).delete("/v1/workflows/wf-123");
    expect(res.status).toBe(404);
  });
});

// -----------------------------------------------------------------------
// POST /v1/workflows/:id/execute
// -----------------------------------------------------------------------

describe("POST /v1/workflows/:id/execute", () => {
  it("should proxy to workflow-service POST /workflows/:id/execute", async () => {
    mockFetchWith({ id: "run-456", status: "queued" });
    const app = createApp();
    const res = await request(app)
      .post("/v1/workflows/wf-123/execute")
      .send({ inputs: { email: "test@example.com" } });

    expect(res.status).toBe(201);
    const call = fetchCalls.find((c) => c.method === "POST" && c.url.includes("/execute"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("/workflows/wf-123/execute");
    expect(call!.body.inputs.email).toBe("test@example.com");
  });
});

// -----------------------------------------------------------------------
// GET /v1/workflow-runs
// -----------------------------------------------------------------------

describe("GET /v1/workflow-runs", () => {
  it("should proxy to workflow-service GET /workflow-runs", async () => {
    mockFetchWith({ workflowRuns: [{ id: "run-1", status: "completed" }] });
    const app = createApp();
    const res = await request(app).get("/v1/workflow-runs");

    expect(res.status).toBe(200);
    expect(res.body.workflowRuns).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/workflow-runs");
  });

  it("should forward query params", async () => {
    mockFetchWith({ workflowRuns: [] });
    const app = createApp();
    await request(app).get("/v1/workflow-runs?workflowId=wf-123&status=failed&featureSlug=pr-outreach");

    const call = fetchCalls[0];
    expect(call.url).toContain("workflowId=wf-123");
    expect(call.url).toContain("status=failed");
    expect(call.url).toContain("featureSlug=pr-outreach");
  });
});

// -----------------------------------------------------------------------
// GET /v1/workflow-runs/:id
// -----------------------------------------------------------------------

describe("GET /v1/workflow-runs/:id", () => {
  it("should proxy to workflow-service GET /workflow-runs/:id", async () => {
    mockFetchWith({ id: "run-456", status: "completed", result: { ok: true } });
    const app = createApp();
    const res = await request(app).get("/v1/workflow-runs/run-456");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(fetchCalls[0].url).toContain("/workflow-runs/run-456");
  });
});

// -----------------------------------------------------------------------
// GET /v1/workflow-runs/:id/debug — intentionally NOT exposed (leaks PII/secrets)
// -----------------------------------------------------------------------

describe("GET /v1/workflow-runs/:id/debug", () => {
  it("should NOT be exposed — returns 404", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/workflow-runs/run-456/debug");
    expect(res.status).toBe(404);
  });
});

// -----------------------------------------------------------------------
// POST /v1/workflow-runs/:id/cancel
// -----------------------------------------------------------------------

describe("POST /v1/workflow-runs/:id/cancel", () => {
  it("should proxy to workflow-service POST /workflow-runs/:id/cancel", async () => {
    mockFetchWith({ id: "run-456", status: "cancelled" });
    const app = createApp();
    const res = await request(app).post("/v1/workflow-runs/run-456/cancel");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    const call = fetchCalls.find((c) => c.method === "POST" && c.url.includes("/cancel"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("/workflow-runs/run-456/cancel");
  });
});
