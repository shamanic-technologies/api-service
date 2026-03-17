import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Do NOT mock auth — we test the real authenticatePlatform middleware
vi.mock("../../src/middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/middleware/auth.js")>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      next();
    },
    requireOrg: (_req: any, _res: any, next: any) => {
      next();
    },
    requireUser: (_req: any, _res: any, next: any) => {
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

import platformKeysRoutes from "../../src/routes/platform-keys.js";

const VALID_API_KEY = "test-admin-key-123";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/platform-keys", platformKeysRoutes);
  return app;
}

describe("POST /platform-keys", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    process.env.ADMIN_DISTRIBUTE_API_KEY = VALID_API_KEY;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = init?.headers ? Object.fromEntries(Object.entries(init.headers)) : undefined;
      fetchCalls.push({ url, method: init?.method, body, headers });
      return {
        ok: true,
        json: () => Promise.resolve({ status: "ok" }),
      };
    });
    app = createApp();
  });

  it("should register a platform key with valid API key and no identity headers", async () => {
    const res = await request(app)
      .post("/platform-keys")
      .set("X-API-Key", VALID_API_KEY)
      .send({ provider: "anthropic", apiKey: "sk-ant-123" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");

    const call = fetchCalls.find((c) => c.url.includes("/platform-keys"));
    expect(call).toBeDefined();
    expect(call!.method).toBe("POST");
    expect(call!.body).toMatchObject({
      provider: "anthropic",
      apiKey: "sk-ant-123",
    });
    // No identity headers forwarded
    expect(call!.headers!["x-org-id"]).toBeUndefined();
    expect(call!.headers!["x-user-id"]).toBeUndefined();
    expect(call!.headers!["x-run-id"]).toBeUndefined();
  });

  it("should return 401 without API key", async () => {
    const res = await request(app)
      .post("/platform-keys")
      .send({ provider: "anthropic", apiKey: "sk-ant-123" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or missing platform API key");
  });

  it("should return 401 with wrong API key", async () => {
    const res = await request(app)
      .post("/platform-keys")
      .set("X-API-Key", "wrong-key")
      .send({ provider: "anthropic", apiKey: "sk-ant-123" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or missing platform API key");
  });

  it("should return 400 when provider is missing", async () => {
    const res = await request(app)
      .post("/platform-keys")
      .set("X-API-Key", VALID_API_KEY)
      .send({ apiKey: "sk-ant-123" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 400 when apiKey is missing", async () => {
    const res = await request(app)
      .post("/platform-keys")
      .set("X-API-Key", VALID_API_KEY)
      .send({ provider: "anthropic" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 400 when provider is empty", async () => {
    const res = await request(app)
      .post("/platform-keys")
      .set("X-API-Key", VALID_API_KEY)
      .send({ provider: "", apiKey: "sk-ant-123" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });
});
