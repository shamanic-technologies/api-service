import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock auth middleware. `authenticateUser` (GET/DELETE /api-keys) leaves the
// org unset when `mockUserAuth.orgId` is undefined, like a multi-org user key
// that names no target.
const mockUserAuth: { userId?: string; orgId?: string } = vi.hoisted(() => ({}));
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.authType = "user_key";
    next();
  },
  authenticateUser: (req: any, _res: any, next: any) => {
    if (mockUserAuth.userId) req.userId = mockUserAuth.userId;
    if (mockUserAuth.orgId) req.orgId = mockUserAuth.orgId;
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

describe("GET/DELETE /v1/api-keys — the caller's own keys, across every org", () => {
  const KEVIN = "cfe148ed-e3d8-40a2-8920-f8c040a81934";
  let app: express.Express;
  let upstream: { ok: boolean; status: number; body: unknown };

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    mockUserAuth.userId = KEVIN;
    mockUserAuth.orgId = undefined;
    upstream = { ok: true, status: 200, body: { keys: [] } };
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
      );
      fetchCalls.push({ url, method: init?.method, headers });
      return {
        ok: upstream.ok,
        status: upstream.status,
        json: () => Promise.resolve(upstream.body),
        text: () => Promise.resolve(JSON.stringify(upstream.body)),
      };
    });
    app = createApp();
  });

  it("lists by the AUTHENTICATED user on key-service's user route, with no org", async () => {
    upstream.body = {
      keys: [
        { id: "k1", orgId: "org-a", userId: KEVIN },
        { id: "k2", orgId: "org-b", userId: KEVIN },
      ],
    };
    const res = await request(app).get("/v1/api-keys");

    expect(res.status).toBe(200);
    expect(res.body.keys.map((k: { orgId: string }) => k.orgId)).toEqual(["org-a", "org-b"]);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toMatch(new RegExp(`/internal/user-api-keys/by-user/${KEVIN}$`));
    expect(fetchCalls[0].method ?? "GET").toBe("GET");
    expect(fetchCalls[0].headers).not.toHaveProperty("x-org-id");
  });

  it("never lets a client pick whose keys are listed", async () => {
    const res = await request(app)
      .get("/v1/api-keys?userId=someone-else")
      .set("x-user-id", "someone-else");
    expect(res.status).toBe(200);
    expect(fetchCalls[0].url).toMatch(new RegExp(`/by-user/${KEVIN}$`));
    expect(fetchCalls[0].url).not.toContain("someone-else");
  });

  it("still lists by user when an org IS active (never the org's keys)", async () => {
    mockUserAuth.orgId = "org-active";
    await request(app).get("/v1/api-keys");
    expect(fetchCalls[0].url).toMatch(new RegExp(`/internal/user-api-keys/by-user/${KEVIN}$`));
    expect(fetchCalls[0].url).not.toMatch(/\/api-keys(\?|$)/);
  });

  it("revokes by (authenticated user, key id) with no org", async () => {
    upstream.body = { message: "User auth key deleted successfully", id: "key-1", orgId: "org-b" };
    const res = await request(app).delete("/v1/api-keys/key-1");

    expect(res.status).toBe(200);
    expect(fetchCalls[0].method).toBe("DELETE");
    expect(fetchCalls[0].url).toMatch(new RegExp(`/internal/user-api-keys/by-user/${KEVIN}/key-1$`));
  });

  it("forwards key-service's 404 for someone else's key instead of a 500", async () => {
    upstream = { ok: false, status: 404, body: { error: "User auth key not found" } };
    const res = await request(app).delete("/v1/api-keys/not-mine");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "User auth key not found" });
  });

  it("refuses without a resolved user", async () => {
    mockUserAuth.userId = undefined;
    const list = await request(app).get("/v1/api-keys");
    const del = await request(app).delete("/v1/api-keys/x");
    expect(list.status).toBe(401);
    expect(del.status).toBe(401);
    expect(fetchCalls).toHaveLength(0);
  });
});
