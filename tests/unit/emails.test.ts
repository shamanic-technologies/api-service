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
      const headers = init?.headers ? Object.fromEntries(Object.entries(init.headers)) : undefined;
      fetchCalls.push({ url, method: init?.method, body, headers });
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
      orgId: "org_test456",
      userId: "user_test123",
      eventType: "webinar_welcome",
      recipientEmail: "user@polarity.com",
      productId: "webinar-123",
      metadata: { name: "Kevin" },
    });
    expect(sendCall!.headers!["x-org-id"]).toBe("org_test456");
    expect(sendCall!.headers!["x-user-id"]).toBe("user_test123");
  });

  it("should forward bccEmails recipients top-level, not inside metadata (matches transactional-email-service contract)", async () => {
    const res = await request(app)
      .post("/v1/emails/send")
      .send({
        eventType: "welcome",
        recipientEmail: "user@polarity.com",
        bccEmails: ["alpha1@team.com", "alpha2@team.com"],
        metadata: { name: "Kevin" },
      });

    expect(res.status).toBe(200);

    const sendCall = fetchCalls.find((c) => c.url.includes("/send"));
    expect(sendCall).toBeDefined();
    // bccEmails forwarded as a top-level field (downstream reads `bccEmails`)
    expect(sendCall!.body.bccEmails).toEqual(["alpha1@team.com", "alpha2@team.com"]);
    // bccEmails must NOT leak into template metadata
    expect(sendCall!.body.metadata).toEqual({ name: "Kevin" });
    expect(sendCall!.body.metadata.bccEmails).toBeUndefined();
  });

  it("should omit bccEmails entirely when caller does not provide it (no behavior change)", async () => {
    const res = await request(app)
      .post("/v1/emails/send")
      .send({ eventType: "welcome", recipientEmail: "user@polarity.com" });

    expect(res.status).toBe(200);

    const sendCall = fetchCalls.find((c) => c.url.includes("/send"));
    expect(sendCall).toBeDefined();
    expect("bccEmails" in sendCall!.body).toBe(false);
  });

  it("should return 400 when bccEmails contains an invalid email", async () => {
    const res = await request(app)
      .post("/v1/emails/send")
      .send({ eventType: "welcome", bccEmails: ["not-an-email"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
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

describe("GET /v1/emails/stats", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = init?.headers ? Object.fromEntries(Object.entries(init.headers)) : undefined;
      fetchCalls.push({ url, method: init?.method, body, headers });
      return {
        ok: true,
        json: () => Promise.resolve({ stats: { totalEmails: 42, sent: 40, failed: 2 } }),
      };
    });
    app = createApp();
  });

  it("should forward stats request with filters as query params and identity in headers", async () => {
    const res = await request(app)
      .get("/v1/emails/stats?eventType=webinar_welcome");

    expect(res.status).toBe(200);
    expect(res.body.stats.totalEmails).toBe(42);

    const statsCall = fetchCalls.find((c) => c.url.includes("/stats"));
    expect(statsCall).toBeDefined();
    // Now uses GET with query params — orgId and eventType in the URL
    expect(statsCall!.url).toContain("orgId=org_test456");
    expect(statsCall!.url).toContain("eventType=webinar_welcome");
    expect(statsCall!.headers!["x-org-id"]).toBe("org_test456");
    expect(statsCall!.headers!["x-user-id"]).toBe("user_test123");
  });

  it("should allow no query params for unfiltered stats", async () => {
    const res = await request(app)
      .get("/v1/emails/stats");

    expect(res.status).toBe(200);
  });
});

describe("GET /v1/emails/by-lead/:leadId", () => {
  let app: express.Express;

  function mockFetch(impl: (url: string, init?: RequestInit) => any) {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const headers = init?.headers ? Object.fromEntries(Object.entries(init.headers)) : undefined;
      fetchCalls.push({ url, method: init?.method, headers });
      return impl(url, init);
    });
    app = createApp();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
  });

  it("proxies to content-gen /generations/by-lead/:leadId and forwards the generation byte-identical", async () => {
    const generation = {
      id: "gen_1",
      campaignId: "camp_1",
      subject: "Hi Kevin",
      bodyHtml: "<p>Hi</p>",
      bodyText: "Hi",
      sequence: [{ step: 1, subject: "Follow up" }],
      leadId: "lead_abc",
      createdAt: "2026-06-28T00:00:00.000Z",
    };
    mockFetch(() => ({ ok: true, json: () => Promise.resolve({ generation }) }));

    const res = await request(app).get("/v1/emails/by-lead/lead_abc");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ generation });

    const call = fetchCalls.find((c) => c.url.includes("/generations/by-lead/"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("/generations/by-lead/lead_abc");
    // Unscoped call (no brandId) must carry NO query string — byte-unchanged from before.
    expect(call!.url).not.toContain("?");
    expect(call!.headers!["x-org-id"]).toBe("org_test456");
    expect(call!.headers!["x-user-id"]).toBe("user_test123");
  });

  it("forwards ?brandId brand scope through to content-gen by-lead read", async () => {
    mockFetch(() => ({ ok: true, json: () => Promise.resolve({ generation: { id: "gen_2" } }) }));

    const res = await request(app).get(
      "/v1/emails/by-lead/lead_abc?brandId=11111111-2222-3333-4444-555555555555",
    );

    expect(res.status).toBe(200);
    const call = fetchCalls.find((c) => c.url.includes("/generations/by-lead/"));
    expect(call).toBeDefined();
    expect(call!.url).toContain("/generations/by-lead/lead_abc");
    expect(call!.url).toContain("brandId=11111111-2222-3333-4444-555555555555");
    expect(call!.headers!["x-org-id"]).toBe("org_test456");
    expect(call!.headers!["x-user-id"]).toBe("user_test123");
  });

  it("maps upstream 404 (no generation yet) to 200 { generation: null }", async () => {
    mockFetch(() => ({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"Generation not found"}'),
    }));

    const res = await request(app).get("/v1/emails/by-lead/lead_none");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ generation: null });
  });

  it("propagates non-404 upstream errors (fail loud)", async () => {
    mockFetch(() => ({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"boom"}'),
    }));

    const res = await request(app).get("/v1/emails/by-lead/lead_err");

    expect(res.status).toBe(500);
  });
});

describe("PUT /v1/emails/templates", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = init?.headers ? Object.fromEntries(Object.entries(init.headers)) : undefined;
      fetchCalls.push({ url, method: init?.method, body, headers });
      return {
        ok: true,
        json: () => Promise.resolve({ templates: [{ name: "webinar_welcome", action: "created" }] }),
      };
    });
    app = createApp();
  });

  it("should forward template deployment with identity in headers", async () => {
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
      templates: [
        {
          name: "webinar_welcome",
          subject: "Welcome to the webinar!",
          htmlBody: "<h1>Welcome {{name}}</h1>",
        },
      ],
    });
    expect(deployCall!.body.appId).toBeUndefined();
    expect(deployCall!.body.orgId).toBeUndefined();
    expect(deployCall!.body.userId).toBeUndefined();
    expect(deployCall!.headers!["x-org-id"]).toBe("org_test456");
    expect(deployCall!.headers!["x-user-id"]).toBe("user_test123");
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
