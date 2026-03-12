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

import { registerPlatformKeys, registerPrompts } from "../../src/startup.js";

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

describe("registerPrompts", () => {
  let fetchCalls: Array<{ url: string; method?: string; body?: Record<string, unknown>; headers?: Record<string, string> }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const headers = init?.headers as Record<string, string> | undefined;
      fetchCalls.push({ url, method: init?.method, body, headers });

      return new Response(JSON.stringify({ type: "cold-email", message: "Prompt registered" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  it("should call PUT /prompts on content-generation-service with cold-email prompt", async () => {
    await registerPrompts();

    const promptCalls = fetchCalls.filter((c) => c.url.includes("/prompts"));
    expect(promptCalls).toHaveLength(1);

    const call = promptCalls[0];
    expect(call.method).toBe("PUT");
    expect(call.body).toHaveProperty("type", "cold-email");
    expect(call.body).toHaveProperty("prompt");
    expect(call.body).toHaveProperty("variables");
    expect(call.body!.variables).toEqual([
      "leadFirstName",
      "leadLastName",
      "leadTitle",
      "leadCompanyName",
      "leadCompanyIndustry",
      "clientCompanyName",
    ]);
  });

  it("should include identity headers for startup context", async () => {
    await registerPrompts();

    const call = fetchCalls.find((c) => c.url.includes("/prompts"));
    expect(call?.headers).toMatchObject({
      "x-org-id": "system",
      "x-user-id": "system",
      "x-run-id": "startup",
    });
  });

  it("should include prompt template variables as mustache placeholders", async () => {
    await registerPrompts();

    const call = fetchCalls.find((c) => c.url.includes("/prompts"));
    const prompt = call?.body?.prompt as string;
    expect(prompt).toContain("{{leadFirstName}}");
    expect(prompt).toContain("{{leadLastName}}");
    expect(prompt).toContain("{{leadTitle}}");
    expect(prompt).toContain("{{leadCompanyName}}");
    expect(prompt).toContain("{{leadCompanyIndustry}}");
    expect(prompt).toContain("{{clientCompanyName}}");
  });

  it("should include a resolved date (not a template literal)", async () => {
    await registerPrompts();

    const call = fetchCalls.find((c) => c.url.includes("/prompts"));
    const prompt = call?.body?.prompt as string;
    // Date should be resolved (e.g. "2026-03-12"), not the raw template expression
    expect(prompt).toMatch(/Today is \d{4}-\d{2}-\d{2}\./);
    expect(prompt).not.toContain("${");
  });

  it("should throw when content-generation-service returns an error", async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(registerPrompts()).rejects.toThrow();
  });
});
