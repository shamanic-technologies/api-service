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

import platformPromptsRoutes from "../../src/routes/platform-prompts.js";

const VALID_API_KEY = "test-admin-key-123";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/platform-prompts", platformPromptsRoutes);
  return app;
}

describe("PUT /platform-prompts", () => {
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

  it("should deploy a platform prompt with valid API key and no identity headers", async () => {
    const res = await request(app)
      .put("/platform-prompts")
      .set("X-API-Key", VALID_API_KEY)
      .send({
        type: "cold-email",
        prompt: "You are writing cold emails...",
        variables: ["leadFirstName", "leadLastName"],
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");

    const call = fetchCalls.find((c) => c.url.includes("/platform-prompts"));
    expect(call).toBeDefined();
    expect(call!.method).toBe("POST");
    expect(call!.body).toMatchObject({
      type: "cold-email",
      prompt: "You are writing cold emails...",
      variables: ["leadFirstName", "leadLastName"],
    });
    // No identity headers forwarded
    expect(call!.headers!["x-org-id"]).toBeUndefined();
    expect(call!.headers!["x-user-id"]).toBeUndefined();
    expect(call!.headers!["x-run-id"]).toBeUndefined();
  });

  it("should return 401 without API key", async () => {
    const res = await request(app)
      .put("/platform-prompts")
      .send({ type: "cold-email", prompt: "test", variables: [] });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or missing platform API key");
  });

  it("should return 401 with wrong API key", async () => {
    const res = await request(app)
      .put("/platform-prompts")
      .set("X-API-Key", "wrong-key")
      .send({ type: "cold-email", prompt: "test", variables: [] });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or missing platform API key");
  });

  it("should return 400 when type is missing", async () => {
    const res = await request(app)
      .put("/platform-prompts")
      .set("X-API-Key", VALID_API_KEY)
      .send({ prompt: "test", variables: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 400 when prompt is missing", async () => {
    const res = await request(app)
      .put("/platform-prompts")
      .set("X-API-Key", VALID_API_KEY)
      .send({ type: "cold-email", variables: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 400 when variables is missing", async () => {
    const res = await request(app)
      .put("/platform-prompts")
      .set("X-API-Key", VALID_API_KEY)
      .send({ type: "cold-email", prompt: "test" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 400 when type is empty", async () => {
    const res = await request(app)
      .put("/platform-prompts")
      .set("X-API-Key", VALID_API_KEY)
      .send({ type: "", prompt: "test", variables: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });
});
