import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock auth middleware
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user_test123";
    req.orgId = "org_test456";
    req.appId = "distribute-frontend";
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

import emailsRoutes from "../../src/routes/emails.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/v1", emailsRoutes);
  return app;
}

describe("POST /v1/emails/send", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });
      return {
        ok: true,
        json: () => Promise.resolve({ results: [{ email: "test@example.com", sent: true }] }),
      };
    });
    app = createApp();
  });

  it("should forward email send request to transactional-email service", async () => {
    const res = await request(app)
      .post("/v1/emails/send")
      .send({
        eventType: "webinar_welcome",
        recipientEmail: "user@polarity.com",
        productId: "webinar-123",
        metadata: { name: "Kevin" },
      });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);

    const sendCall = fetchCalls.find((c) => c.url.includes("/send"));
    expect(sendCall).toBeDefined();
    expect(sendCall!.method).toBe("POST");
    expect(sendCall!.body).toMatchObject({
      appId: "distribute-frontend",
      orgId: "org_test456",
      userId: "user_test123",
      eventType: "webinar_welcome",
      recipientEmail: "user@polarity.com",
      productId: "webinar-123",
      metadata: { name: "Kevin" },
    });
  });

  it("should return 400 when eventType is missing", async () => {
    const res = await request(app)
      .post("/v1/emails/send")
      .send({ recipientEmail: "user@polarity.com" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 500 when transactional-email service fails", async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Service unavailable" }),
      text: () => Promise.resolve('{"error":"Service unavailable"}'),
    }));
    app = createApp();

    const res = await request(app)
      .post("/v1/emails/send")
      .send({ eventType: "webinar_welcome" });

    expect(res.status).toBe(500);
  });
});

describe("POST /v1/emails/stats", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });
      return {
        ok: true,
        json: () => Promise.resolve({ stats: { totalEmails: 42, sent: 40, failed: 2 } }),
      };
    });
    app = createApp();
  });

  it("should forward stats request with appId and orgId", async () => {
    const res = await request(app)
      .post("/v1/emails/stats")
      .send({ eventType: "webinar_welcome" });

    expect(res.status).toBe(200);
    expect(res.body.stats.totalEmails).toBe(42);

    const statsCall = fetchCalls.find((c) => c.url.includes("/stats"));
    expect(statsCall).toBeDefined();
    expect(statsCall!.body).toMatchObject({
      appId: "distribute-frontend",
      orgId: "org_test456",
      eventType: "webinar_welcome",
    });
  });

  it("should allow empty body for unfiltered stats", async () => {
    const res = await request(app)
      .post("/v1/emails/stats")
      .send({});

    expect(res.status).toBe(200);
  });
});

describe("PUT /v1/emails/templates", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });
      return {
        ok: true,
        json: () => Promise.resolve({ templates: [{ name: "webinar_welcome", action: "created" }] }),
      };
    });
    app = createApp();
  });

  it("should forward template deployment with appId", async () => {
    const res = await request(app)
      .put("/v1/emails/templates")
      .send({
        templates: [
          {
            name: "webinar_welcome",
            subject: "Welcome to the webinar!",
            htmlBody: "<h1>Welcome {{name}}</h1>",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);

    const deployCall = fetchCalls.find((c) => c.url.includes("/templates"));
    expect(deployCall).toBeDefined();
    expect(deployCall!.method).toBe("PUT");
    expect(deployCall!.body).toMatchObject({
      appId: "distribute-frontend",
      templates: [
        {
          name: "webinar_welcome",
          subject: "Welcome to the webinar!",
          htmlBody: "<h1>Welcome {{name}}</h1>",
        },
      ],
    });
  });

  it("should return 400 when templates array is empty", async () => {
    const res = await request(app)
      .put("/v1/emails/templates")
      .send({ templates: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("should return 400 when templates is missing", async () => {
    const res = await request(app)
      .put("/v1/emails/templates")
      .send({});

    expect(res.status).toBe(400);
  });
});
