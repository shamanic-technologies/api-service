import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock auth (required by service-client transitive imports)
vi.mock("../../src/middleware/auth.js", () => ({
  authenticate: vi.fn(),
  requireOrg: vi.fn(),
  requireUser: vi.fn(),
  AuthenticatedRequest: {},
}));

vi.mock("@distribute/runs-client", () => ({
  getRunsBatch: vi.fn().mockResolvedValue(new Map()),
}));

import { registerPlatformKeys, deployEmailTemplates } from "../../src/startup.js";

function setAllEnvVars() {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.APOLLO_API_KEY = "apollo-test";
  process.env.INSTANTLY_API_KEY = "instantly-test";
  process.env.FIRECRAWL_API_KEY = "fc-test";
  process.env.GEMINI_API_KEY = "gemini-test";
  process.env.POSTMARK_API_KEY = "postmark-test";
  process.env.POSTMARK_BROADCAST_STREAM_ID = "broadcast";
  process.env.POSTMARK_INBOUND_STREAM_ID = "inbound";
  process.env.POSTMARK_TRANSACTIONAL_STREAM_ID = "outbound";
  process.env.POSTMARK_FROM_ADDRESS = "growth@distribute.you";
  process.env.STRIPE_SECRET_KEY = "sk_test_stripe";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
}

function deleteAllEnvVars() {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.APOLLO_API_KEY;
  delete process.env.INSTANTLY_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.POSTMARK_API_KEY;
  delete process.env.POSTMARK_BROADCAST_STREAM_ID;
  delete process.env.POSTMARK_INBOUND_STREAM_ID;
  delete process.env.POSTMARK_TRANSACTIONAL_STREAM_ID;
  delete process.env.POSTMARK_FROM_ADDRESS;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
}

describe("registerPlatformKeys", () => {
  let fetchCalls: Array<{ url: string; body?: Record<string, unknown> }>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, body });

      if (url.includes("/platform-keys")) {
        return new Response(JSON.stringify({ provider: body?.provider, maskedKey: "sk-...xxx", message: "Platform key saved" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should register all platform keys without appId or keySource", async () => {
    setAllEnvVars();

    await registerPlatformKeys();

    const platformKeyCalls = fetchCalls.filter((c) => c.url.includes("/platform-keys"));
    expect(platformKeyCalls).toHaveLength(12);

    const providers = platformKeyCalls.map((c) => c.body?.provider);
    expect(providers).toContain("anthropic");
    expect(providers).toContain("apollo");
    expect(providers).toContain("instantly");
    expect(providers).toContain("firecrawl");
    expect(providers).toContain("gemini");
    expect(providers).toContain("postmark");
    expect(providers).toContain("postmark-broadcast-stream");
    expect(providers).toContain("postmark-inbound-stream");
    expect(providers).toContain("postmark-transactional-stream");
    expect(providers).toContain("postmark-from-address");
    expect(providers).toContain("stripe");
    expect(providers).toContain("stripe-webhook");

    for (const call of platformKeyCalls) {
      expect(call.body).not.toHaveProperty("keySource");
      expect(call.body).not.toHaveProperty("appId");
      expect(call.body).toHaveProperty("provider");
      expect(call.body).toHaveProperty("apiKey");
    }
  });

  it("should throw when all env vars are missing", async () => {
    deleteAllEnvVars();
    await expect(registerPlatformKeys()).rejects.toThrow("Missing required env vars");
  });

  it("should throw when key-service returns an error", async () => {
    setAllEnvVars();

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, body });

      if (url.includes("/platform-keys")) {
        return new Response(JSON.stringify({ error: "Service unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await expect(registerPlatformKeys()).rejects.toThrow();
  });

  it("should throw when a single env var is missing", async () => {
    setAllEnvVars();
    delete process.env.STRIPE_SECRET_KEY;

    await expect(registerPlatformKeys()).rejects.toThrow("STRIPE_SECRET_KEY");
  });
});

describe("deployEmailTemplates", () => {
  let fetchCalls: Array<{ url: string; method?: string; body?: Record<string, unknown> }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      fetchCalls.push({ url, method: init?.method, body });

      if (url.includes("/templates")) {
        return new Response(
          JSON.stringify({
            templates: (body?.templates as unknown[])?.map((t: any) => ({ name: t.name, action: "updated" })) ?? [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  });

  it("should deploy campaign_created and campaign_stopped templates via PUT /templates", async () => {
    await deployEmailTemplates();

    const templateCalls = fetchCalls.filter((c) => c.url.includes("/templates"));
    expect(templateCalls).toHaveLength(1);

    const call = templateCalls[0]!;
    expect(call.method).toBe("PUT");

    const templates = call.body?.templates as Array<{ name: string; subject: string; htmlBody: string; textBody: string }>;
    expect(templates).toHaveLength(2);

    const names = templates.map((t) => t.name);
    expect(names).toContain("campaign_created");
    expect(names).toContain("campaign_stopped");
  });

  it("should use Distribute branding with working logo URL", async () => {
    await deployEmailTemplates();

    const call = fetchCalls.find((c) => c.url.includes("/templates"))!;
    const templates = call.body?.templates as Array<{ name: string; htmlBody: string }>;

    for (const tpl of templates) {
      expect(tpl.htmlBody).toContain("https://distribute.you/logo-horizontal.jpg");
      expect(tpl.htmlBody).toContain("Distribute");
      expect(tpl.htmlBody).toContain("https://dashboard.distribute.you");
      expect(tpl.htmlBody).not.toContain("mcpfactory");
      expect(tpl.htmlBody).not.toContain("MCP Factory");
    }
  });

  it("should include {{campaignName}} interpolation variable", async () => {
    await deployEmailTemplates();

    const call = fetchCalls.find((c) => c.url.includes("/templates"))!;
    const templates = call.body?.templates as Array<{ name: string; htmlBody: string; subject: string }>;

    for (const tpl of templates) {
      expect(tpl.subject).toContain("{{campaignName}}");
      expect(tpl.htmlBody).toContain("{{campaignName}}");
    }
  });

  it("should throw when transactional-email-service returns an error", async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(deployEmailTemplates()).rejects.toThrow();
  });
});
