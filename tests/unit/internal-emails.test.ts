import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Do NOT mock auth — we test the real authenticatePlatform middleware
vi.mock("../../src/middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/middleware/auth.js")>();
  return {
    ...actual,
    // Only keep authenticatePlatform real; stub the others to avoid import issues
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

import internalEmailsRoutes from "../../src/routes/internal-emails.js";

const VALID_API_KEY = "test-admin-key-123";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/internal", internalEmailsRoutes);
  return app;
}

describe("PUT /internal/emails/templates", () => {
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
        json: () => Promise.resolve({ templates: [{ name: "campaign_created", action: "created" }] }),
      };
    });
    app = createApp();
  });

  it("should deploy templates with valid API key and no identity headers", async () => {
    const res = await request(app)
      .put("/internal/emails/templates")
      .set("X-API-Key", VALID_API_KEY)
      .send({
        templates: [
          {
            name: "campaign_created",
            subject: "Campaign Created",
            htmlBody: "<h1>Campaign {{campaignName}} created</h1>",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);

    const deployCall = fetchCalls.find((c) => c.url.includes("/templates"));
    expect(deployCall).toBeDefined();
    expect(deployCall!.method).toBe("PUT");
    expect(deployCall!.body).toMatchObject({
      templates: [
        {
          name: "campaign_created",
          subject: "Campaign Created",
          htmlBody: "<h1>Campaign {{campaignName}} created</h1>",
        },
      ],
    });
    // No identity headers forwarded when caller doesn't send them
    expect(deployCall!.headers!["x-org-id"]).toBeUndefined();
    expect(deployCall!.headers!["x-user-id"]).toBeUndefined();
    expect(deployCall!.headers!["x-run-id"]).toBeUndefined();
  });

  it("should forward identity headers to transactional-email-service when present", async () => {
    const res = await request(app)
      .put("/internal/emails/templates")
      .set("X-API-Key", VALID_API_KEY)
      .set("x-org-id", "org-uuid-123")
      .set("x-user-id", "user-uuid-456")
      .set("x-run-id", "run-uuid-789")
      .send({
        templates: [
          { name: "campaign_created", subject: "Campaign Created", htmlBody: "<h1>Created</h1>" },
        ],
      });

    expect(res.status).toBe(200);

    const deployCall = fetchCalls.find((c) => c.url.includes("/templates"));
    expect(deployCall).toBeDefined();
    expect(deployCall!.headers!["x-org-id"]).toBe("org-uuid-123");
    expect(deployCall!.headers!["x-user-id"]).toBe("user-uuid-456");
    expect(deployCall!.headers!["x-run-id"]).toBe("run-uuid-789");
  });

  it("should return 401 without API key", async () => {
    const res = await request(app)
      .put("/internal/emails/templates")
      .send({
        templates: [
          { name: "test", subject: "Test", htmlBody: "<p>test</p>" },
        ],
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or missing platform API key");
  });

  it("should return 401 with wrong API key", async () => {
    const res = await request(app)
      .put("/internal/emails/templates")
      .set("X-API-Key", "wrong-key")
      .send({
        templates: [
          { name: "test", subject: "Test", htmlBody: "<p>test</p>" },
        ],
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or missing platform API key");
  });

  it("should return 400 when templates array is empty", async () => {
    const res = await request(app)
      .put("/internal/emails/templates")
      .set("X-API-Key", VALID_API_KEY)
      .send({ templates: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 400 when templates is missing", async () => {
    const res = await request(app)
      .put("/internal/emails/templates")
      .set("X-API-Key", VALID_API_KEY)
      .send({});

    expect(res.status).toBe(400);
  });

  it("should deploy multiple templates at once", async () => {
    const templates = [
      { name: "campaign_created", subject: "Campaign Created", htmlBody: "<h1>Created</h1>" },
      { name: "campaign_stopped", subject: "Campaign Stopped", htmlBody: "<h1>Stopped</h1>" },
      { name: "waitlist_welcome", subject: "Welcome", htmlBody: "<h1>Welcome</h1>" },
    ];

    const res = await request(app)
      .put("/internal/emails/templates")
      .set("X-API-Key", VALID_API_KEY)
      .send({ templates });

    expect(res.status).toBe(200);

    const deployCall = fetchCalls.find((c) => c.url.includes("/templates"));
    expect(deployCall!.body.templates).toHaveLength(3);
  });
});
