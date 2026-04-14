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
  headers?: Record<string, string>;
}

let fetchCalls: FetchCall[] = [];

import keysRoutes from "../../src/routes/keys.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", keysRoutes);
  return app;
}

describe("POST /v1/api-keys — identity forwarding via headers", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}).filter(([_, v]) => v)
      ) as Record<string, string>;
      fetchCalls.push({ url, method: init?.method, body, headers });
      return {
        ok: true,
        json: () => Promise.resolve({
          id: "key-uuid-123",
          key: "mcpf_usr_abc123",
          name: "Polarity Course",
          orgId: "org_test456",
          userId: "user_test123",
          createdBy: "user_test123",
          createdAt: "2026-03-01T00:00:00Z",
        }),
      };
    });
    app = createApp();
  });

  it("should pass userId, createdBy and name in body, orgId only in headers", async () => {
    const res = await request(app)
      .post("/v1/api-keys")
      .send({ name: "Polarity Course" });

    expect(res.status).toBe(200);
    expect(res.body.key).toBe("mcpf_usr_abc123");

    const createCall = fetchCalls.find(
      (c) => c.url.includes("/api-keys") && c.method === "POST" && !c.url.includes("session")
    );
    expect(createCall).toBeDefined();
    expect(createCall!.body).toEqual({
      userId: "user_test123",
      createdBy: "user_test123",
      name: "Polarity Course",
    });
    // orgId should NOT be in the body — it goes via x-org-id header
    expect(createCall!.body).not.toHaveProperty("orgId");
  });
});

describe("POST /v1/api-keys/session — identity forwarding via headers only", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });
      return {
        ok: true,
        json: () => Promise.resolve({
          id: "session-uuid",
          key: "mcpf_usr_session",
          keyPrefix: "mcpf_usr_ses",
          name: "Default",
        }),
      };
    });
    app = createApp();
  });

  it("should not pass any body to key-service session endpoint", async () => {
    const res = await request(app)
      .post("/v1/api-keys/session")
      .send({});

    expect(res.status).toBe(200);

    const sessionCall = fetchCalls.find(
      (c) => c.url.includes("/api-keys/session") && c.method === "POST"
    );
    expect(sessionCall).toBeDefined();
    // No body should be sent — orgId and userId come from headers
    expect(sessionCall!.body).toBeUndefined();
  });
});
